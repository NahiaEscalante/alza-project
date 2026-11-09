/**
 * Big rewards in review (13.3, 4.7, RF-AD-02). The team approves (the code is released and she
 * sees it in Premios) or rejects (her points come back as an `adjustment` entry). Each decision
 * is one transaction with the row locked, so two people clicking at once never decide twice, and
 * the audit row goes in the same transaction.
 *
 * The list shows ids, points, the reward and context for the review (her active weeks and open
 * alerts), never money amounts or names. The code itself is not shown here nor logged.
 */
import { and, count, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { getActiveWeeks } from '../account/points.js';
import { demoRedemptionCode } from '../account/rewards.js';
import type { Db } from '../db/client.js';
import {
  adminUsers,
  alerts,
  pointsEntries,
  type RedemptionStatus,
  redemptions,
  rewards,
  users,
} from '../db/schema.js';
import { REQUIRED_ACTIVE_WEEKS, rejectedRedemptionRefund } from '../domain/index.js';
import { inTransaction } from '../ledger/types.js';
import type { AdminIdentity } from './accounts.js';
import { recordAdminAction } from './audit.js';
import { maskPhone } from './mask.js';

export interface RedemptionReviewItem {
  id: string;
  userId: string;
  phone: string;
  rewardName: string;
  points: number;
  status: RedemptionStatus;
  createdAt: string;
  /** PR18 weeks with ≥ 3 closes, re-counted now (13.3 asks for 8). */
  activeWeeks: number;
  requiredActiveWeeks: number;
  /** Antifraud alerts still open for her (13.4). */
  openAlerts: number;
  /** Who decided (reviewed list only). */
  reviewedBy: { username: string; name: string } | null;
}

export interface RedemptionsView {
  inReview: RedemptionReviewItem[];
  /** Latest decisions taken in the panel. */
  reviewed: RedemptionReviewItem[];
}

export async function listRedemptionsForReview(db: Db): Promise<RedemptionsView> {
  const select = {
    id: redemptions.id,
    userId: redemptions.userId,
    phoneE164: users.phoneE164,
    rewardName: rewards.name,
    points: redemptions.points,
    status: redemptions.status,
    createdAt: redemptions.createdAt,
    reviewerUsername: adminUsers.email,
    reviewerName: adminUsers.name,
  };
  const base = () =>
    db
      .select(select)
      .from(redemptions)
      .innerJoin(rewards, eq(rewards.id, redemptions.rewardId))
      .innerJoin(users, eq(users.id, redemptions.userId))
      .leftJoin(adminUsers, sql`${adminUsers.id}::text = ${redemptions.reviewedBy}`);
  const [pending, decided] = await Promise.all([
    base().where(eq(redemptions.status, 'in_review')).orderBy(redemptions.createdAt),
    base()
      .where(and(isNotNull(redemptions.reviewedBy), ne(redemptions.status, 'in_review')))
      .orderBy(desc(redemptions.createdAt))
      .limit(20),
  ]);

  const userIds = [...new Set(pending.map((row) => row.userId))];
  const [weeks, openAlerts] = await Promise.all([
    Promise.all(userIds.map(async (id) => [id, await getActiveWeeks(db, id)] as const)),
    userIds.length === 0
      ? Promise.resolve([])
      : db
          .select({ userId: alerts.userId, n: count() })
          .from(alerts)
          .where(and(inArray(alerts.userId, userIds), eq(alerts.status, 'open')))
          .groupBy(alerts.userId),
  ]);
  const weeksOf = new Map(weeks);

  const item = (row: (typeof pending)[number]): RedemptionReviewItem => ({
    id: row.id,
    userId: row.userId,
    phone: maskPhone(row.phoneE164),
    rewardName: row.rewardName,
    points: row.points,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    activeWeeks: weeksOf.get(row.userId) ?? 0,
    requiredActiveWeeks: REQUIRED_ACTIVE_WEEKS,
    openAlerts: openAlerts.find((a) => a.userId === row.userId)?.n ?? 0,
    reviewedBy: row.reviewerUsername
      ? { username: row.reviewerUsername, name: row.reviewerName ?? row.reviewerUsername }
      : null,
  });
  return { inReview: pending.map(item), reviewed: decided.map(item) };
}

export type ReviewResult =
  | { ok: true; status: 'delivered' | 'rejected'; pointsReturned: number }
  | { ok: false; error: 'not_found' | 'not_in_review' };

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  return (e?.code ?? e?.cause?.code) === '23505';
}

/** Approve: `in_review → delivered` with a new `DEMO-XXXX` code (13.3). */
export async function approveRedemption(
  db: Db,
  admin: AdminIdentity,
  redemptionId: string,
  now: Date,
): Promise<ReviewResult> {
  return inTransaction(db, async (tx): Promise<ReviewResult> => {
    const [row] = await tx
      .select({ status: redemptions.status, userId: redemptions.userId })
      .from(redemptions)
      .where(eq(redemptions.id, redemptionId))
      .for('update');
    if (!row) return { ok: false, error: 'not_found' };
    if (row.status !== 'in_review') return { ok: false, error: 'not_in_review' };

    let done = false;
    for (let attempt = 0; attempt < 5 && !done; attempt++) {
      try {
        // Savepoint: a code collision retries without aborting the transaction.
        await tx.transaction((sp) =>
          sp
            .update(redemptions)
            .set({ status: 'delivered', code: demoRedemptionCode(), reviewedBy: admin.id })
            .where(eq(redemptions.id, redemptionId)),
        );
        done = true;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    if (!done) throw new Error('could not generate a unique redemption code');

    await recordAdminAction(tx, {
      adminUserId: admin.id,
      action: 'redemption.approve',
      targetType: 'redemption',
      targetId: redemptionId,
      detail: { userId: row.userId },
      at: now,
    });
    return { ok: true, status: 'delivered', pointsReturned: 0 };
  });
}

/** Reject: `in_review → rejected` and «los puntos vuelven» (13.3) as an `adjustment` entry. */
export async function rejectRedemption(
  db: Db,
  admin: AdminIdentity,
  redemptionId: string,
  now: Date,
): Promise<ReviewResult> {
  return inTransaction(db, async (tx): Promise<ReviewResult> => {
    const [row] = await tx
      .select({
        status: redemptions.status,
        userId: redemptions.userId,
        points: redemptions.points,
      })
      .from(redemptions)
      .where(eq(redemptions.id, redemptionId))
      .for('update');
    if (!row) return { ok: false, error: 'not_found' };
    if (row.status !== 'in_review') return { ok: false, error: 'not_in_review' };

    await tx
      .update(redemptions)
      .set({ status: 'rejected', reviewedBy: admin.id })
      .where(eq(redemptions.id, redemptionId));
    const refund = rejectedRedemptionRefund(row.points);
    await tx.insert(pointsEntries).values({
      userId: row.userId,
      type: refund.type,
      points: refund.points,
      referenceId: redemptionId,
      createdAt: now,
    });
    await recordAdminAction(tx, {
      adminUserId: admin.id,
      action: 'redemption.reject',
      targetType: 'redemption',
      targetId: redemptionId,
      detail: { userId: row.userId, pointsReturned: refund.points },
      at: now,
    });
    return { ok: true, status: 'rejected', pointsReturned: refund.points };
  });
}
