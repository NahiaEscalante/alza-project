/**
 * Flagged patterns (13.4, D22, RF-AD-02) and PIN lockouts (D28), for the team to review. Alerts
 * never block anything by themselves, with one exception: while a `duplicate_account_holder`
 * alert is `open` her days close without points (D62). Reviewing it («Resolver») turns points
 * back on from the next 12:00 run; points withheld before are not paid afterwards (D62).
 *
 * Reviewing only changes `status` (and adds who and when to `detail`): the PIN line of the close
 * (`detail.closeNotice`, D28) and the antifraud scan's own bookkeeping are left untouched.
 */
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { type AlertStatus, alerts, users } from '../db/schema.js';
import { inTransaction } from '../ledger/types.js';
import type { AdminIdentity } from './accounts.js';
import { recordAdminAction } from './audit.js';
import { maskPhone } from './mask.js';

export type AlertFilter = 'open' | 'closed';
export type ReviewOutcome = Exclude<AlertStatus, 'open'>;

export interface AlertItem {
  id: string;
  type: string;
  status: string;
  createdAt: string;
  userId: string | null;
  phone: string | null;
  /** Ids, counts and dates only (see `safeDetail`). */
  detail: Record<string, string | number | boolean | string[]>;
  /** Holder conflict: points are withheld while it is open (D62). */
  withholdsPoints: boolean;
}

const MAX_STRING = 80;
const MAX_LIST = 10;

/**
 * The producers only write ids, counts and hashes, but the panel passes on primitives only, as a
 * second guard: nothing nested, no long strings.
 */
export function safeDetail(detail: unknown): AlertItem['detail'] {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return {};
  const out: AlertItem['detail'] = {};
  for (const [key, value] of Object.entries(detail)) {
    if (typeof value === 'number' || typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'string' && value.length <= MAX_STRING) out[key] = value;
    else if (Array.isArray(value) && value.every((v) => typeof v === 'string' && v.length <= 64)) {
      out[key] = (value as string[]).slice(0, MAX_LIST);
    }
  }
  return out;
}

export async function listAlerts(
  db: Db,
  options: { filter?: AlertFilter; limit?: number; userId?: string } = {},
): Promise<{ items: AlertItem[]; openCount: number }> {
  const filter = options.filter ?? 'open';
  const ofUser = options.userId ? eq(alerts.userId, options.userId) : undefined;
  const [rows, [open]] = await Promise.all([
    db
      .select({
        id: alerts.id,
        type: alerts.type,
        status: alerts.status,
        createdAt: alerts.createdAt,
        userId: alerts.userId,
        detail: alerts.detail,
        phoneE164: users.phoneE164,
      })
      .from(alerts)
      .leftJoin(users, eq(users.id, alerts.userId))
      .where(and(filter === 'open' ? eq(alerts.status, 'open') : ne(alerts.status, 'open'), ofUser))
      .orderBy(desc(alerts.createdAt), desc(alerts.id))
      .limit(options.limit ?? 100),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(alerts)
      .where(and(eq(alerts.status, 'open'), ofUser)),
  ]);
  return {
    items: rows.map((row) => ({
      id: row.id,
      type: row.type,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      userId: row.userId,
      phone: row.phoneE164 ? maskPhone(row.phoneE164) : null,
      detail: safeDetail(row.detail),
      withholdsPoints: row.type === 'duplicate_account_holder' && row.status === 'open',
    })),
    openCount: open?.n ?? 0,
  };
}

export type AlertReviewResult =
  | { ok: true; status: ReviewOutcome }
  | { ok: false; error: 'not_found' | 'not_open' };

export async function reviewAlert(
  db: Db,
  admin: AdminIdentity,
  alertId: string,
  outcome: ReviewOutcome,
  now: Date,
): Promise<AlertReviewResult> {
  return inTransaction(db, async (tx): Promise<AlertReviewResult> => {
    const [row] = await tx
      .select({ status: alerts.status, type: alerts.type, userId: alerts.userId })
      .from(alerts)
      .where(eq(alerts.id, alertId))
      .for('update');
    if (!row) return { ok: false, error: 'not_found' };
    if (row.status !== 'open') return { ok: false, error: 'not_open' };
    await tx
      .update(alerts)
      .set({
        status: outcome,
        detail: sql`coalesce(${alerts.detail}, '{}'::jsonb) || jsonb_build_object('reviewedBy', ${admin.id}::text, 'reviewedAt', ${now.toISOString()}::text)`,
      })
      .where(and(eq(alerts.id, alertId), inArray(alerts.status, ['open'])));
    await recordAdminAction(tx, {
      adminUserId: admin.id,
      action: 'alert.review',
      targetType: 'alert',
      targetId: alertId,
      detail: { type: row.type, outcome, userId: row.userId },
      at: now,
    });
    return { ok: true, status: outcome };
  });
}
