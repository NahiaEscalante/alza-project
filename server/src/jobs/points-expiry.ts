/**
 * Daily 04:00, when the business day starts (8.4, D29, 13.2): if 6 months pass without any close,
 * her whole balance expires as one `expiration` points entry (RF-PT-04 keeps it auditable). Any
 * close restarts the term: a day whose final level is complete or partial, or that reached one
 * later as `improved_level` (a late reply is still her closing the day). If she never closed, the
 * term runs from her first accepted consent (or the account's creation).
 *
 * Idempotent: after expiring, the balance is 0 and nothing else expires. Runs under the same
 * per-user lock as the 12:00 job, and recomputes the balance inside it.
 */
import { and, eq, gt, inArray, isNull, max, min, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { consents, dailyCloses, pointsEntries, users } from '../db/schema.js';
import { businessDayOf, type IsoDate, pointsBalance, pointsExpiration } from '../domain/index.js';
import { inTransaction } from '../ledger/types.js';
import type { Logger } from '../lib/logger.js';
import { userScope } from './active-users.js';
import { lockUserPoints } from './locks.js';
import type { JobScope } from './types.js';

const CLOSED_LEVELS = ['complete', 'partial'] as const;

export interface ExpiryRunSummary {
  usersChecked: number;
  usersExpired: number;
  pointsExpired: number;
  failedUsers: number;
}

/** Users (not deleted) with a positive balance. */
async function usersWithBalance(db: Db, scope?: JobScope): Promise<string[]> {
  const rows = await db
    .select({ userId: pointsEntries.userId })
    .from(pointsEntries)
    .innerJoin(users, eq(users.id, pointsEntries.userId))
    .where(and(isNull(users.deletedAt), userScope(pointsEntries.userId, scope)))
    .groupBy(pointsEntries.userId)
    .having(gt(sql`sum(${pointsEntries.points})`, 0))
    .orderBy(pointsEntries.userId);
  return rows.map((row) => row.userId);
}

/** Expires her balance if D29 applies at `now`. Returns the points expired (0 if none). */
export async function expireUserPoints(db: Db, userId: string, now: Date): Promise<number> {
  return inTransaction(db, async (tx) => {
    await lockUserPoints(tx, userId);
    // Sequential: one connection inside the transaction.
    const entries = await tx
      .select({ points: pointsEntries.points })
      .from(pointsEntries)
      .where(eq(pointsEntries.userId, userId));
    const [lastClose] = await tx
      .select({ day: max(dailyCloses.businessDay) })
      .from(dailyCloses)
      .where(
        and(
          eq(dailyCloses.userId, userId),
          or(
            inArray(dailyCloses.level, [...CLOSED_LEVELS]),
            inArray(dailyCloses.improvedLevel, [...CLOSED_LEVELS]),
          ),
        ),
      );
    const [consent] = await tx
      .select({ at: min(consents.createdAt) })
      .from(consents)
      .where(and(eq(consents.userId, userId), eq(consents.accepted, true)));
    const [user] = await tx
      .select({ createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, userId));
    if (!user) return 0;
    const sinceDay: IsoDate = businessDayOf(consent?.at ?? user.createdAt);
    const expiration = pointsExpiration({
      balance: pointsBalance(entries),
      lastCloseDay: lastClose?.day ?? null,
      sinceDay,
      today: businessDayOf(now),
    });
    if (!expiration) return 0;
    await tx.insert(pointsEntries).values({
      userId,
      type: expiration.type,
      points: expiration.points,
      referenceId: null,
      createdAt: now,
    });
    return -expiration.points;
  });
}

/** The 04:00 task. */
export async function expireInactivePoints(
  deps: { db: Db; logger: Logger },
  now: Date,
  scope?: JobScope,
): Promise<ExpiryRunSummary> {
  const summary: ExpiryRunSummary = {
    usersChecked: 0,
    usersExpired: 0,
    pointsExpired: 0,
    failedUsers: 0,
  };
  for (const userId of await usersWithBalance(deps.db, scope)) {
    summary.usersChecked += 1;
    try {
      const expired = await expireUserPoints(deps.db, userId, now);
      if (expired > 0) {
        summary.usersExpired += 1;
        summary.pointsExpired += expired;
      }
    } catch (err) {
      summary.failedUsers += 1;
      deps.logger.error({ err, userId }, 'points expiry failed for user');
    }
  }
  return summary;
}
