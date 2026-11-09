import { sql } from 'drizzle-orm';
import type { Tx } from '../ledger/types.js';

/**
 * Serializes the writers of one user's points and streak (12:00 finalization, 04:00 expiry) for
 * the rest of the transaction, so overlapping runs (a retry, a manual run from the panel) cannot
 * award twice or apply days out of order.
 */
export async function lockUserPoints(tx: Tx, userId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`alza:points:${userId}`}, 0))`,
  );
}
