/**
 * One account per Yape/Plin account holder (13.4, D22, case 22). When an account declares a holder
 * (main one in the onboarding, additional ones in the web, D31) that another live account already
 * has, an alert goes to the panel and *the declaring account* earns no points while that alert is
 * `open`: the 12:00 job (jobs/finalize-closes.ts) still finalizes her days and keeps her streak,
 * but writes no points entries. Nothing else is blocked; the team reviews it in the panel.
 *
 * Callers: Fase 4 (onboarding, main holder) and Fase 7 (Ajustes, additional holders), right after
 * saving the holder. The alert keeps only account ids and a hash of the holder, never the name.
 */
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { accountHolders, alerts, users } from '../db/schema.js';
import { normalizeName } from '../domain/index.js';
import type { DbOrTx } from '../ledger/types.js';
import { HOLDER_CONFLICT_ALERT, holderKey } from './rules.js';

export type HolderConflictResult =
  | { conflict: false }
  | {
      conflict: true;
      alertId: string;
      /** False when an open alert for the same holder already existed (idempotent). */
      created: boolean;
      /** Other live accounts that already have this holder. */
      conflictingUserIds: string[];
    };

/** Other live accounts (not deleted) with this normalized holder, main or additional. */
async function accountsWithHolder(
  db: DbOrTx,
  userId: string,
  normalized: string,
): Promise<string[]> {
  // Sequential: callers may pass a transaction (one connection).
  const main = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.accountHolderNormalized, normalized),
        ne(users.id, userId),
        isNull(users.deletedAt),
      ),
    );
  const extra = await db
    .select({ id: accountHolders.userId })
    .from(accountHolders)
    .innerJoin(users, eq(users.id, accountHolders.userId))
    .where(
      and(
        eq(accountHolders.nameNormalized, normalized),
        ne(accountHolders.userId, userId),
        isNull(users.deletedAt),
      ),
    );
  return [...new Set([...main, ...extra].map((row) => row.id))].sort();
}

/**
 * Checks a holder `userId` just declared. Creates (once) an open `duplicate_account_holder` alert
 * for `userId` when another account already has it. Re-checking the same holder while the alert
 * is open returns that alert.
 */
export async function checkHolderConflict(
  db: DbOrTx,
  userId: string,
  holderNameNormalized: string,
  options: { now?: Date } = {},
): Promise<HolderConflictResult> {
  // Callers pass the normalized name; normalizing again is harmless and guards raw input.
  const normalized = normalizeName(holderNameNormalized);
  if (normalized === '') return { conflict: false };
  const conflictingUserIds = await accountsWithHolder(db, userId, normalized);
  if (conflictingUserIds.length === 0) return { conflict: false };

  const key = holderKey(normalized);
  const [existing] = await db
    .select({ id: alerts.id })
    .from(alerts)
    .where(
      and(
        eq(alerts.userId, userId),
        eq(alerts.type, HOLDER_CONFLICT_ALERT),
        eq(alerts.status, 'open'),
        sql`${alerts.detail}->>'holderKey' = ${key}`,
      ),
    )
    .limit(1);
  if (existing) return { conflict: true, alertId: existing.id, created: false, conflictingUserIds };

  const now = options.now ?? new Date();
  const [alert] = await db
    .insert(alerts)
    .values({
      userId,
      type: HOLDER_CONFLICT_ALERT,
      status: 'open',
      detail: { holderKey: key, conflictingUserIds, at: now.toISOString() },
      createdAt: now,
    })
    .returning({ id: alerts.id });
  if (!alert) throw new Error('alert insert returned no row');
  return { conflict: true, alertId: alert.id, created: true, conflictingUserIds };
}

/** While true, the 12:00 job gives her no points (13.4: «no suma puntos hasta la revisión»). */
export async function hasOpenHolderConflict(db: DbOrTx, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: alerts.id })
    .from(alerts)
    .where(
      and(
        eq(alerts.userId, userId),
        eq(alerts.type, HOLDER_CONFLICT_ALERT),
        eq(alerts.status, 'open'),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
