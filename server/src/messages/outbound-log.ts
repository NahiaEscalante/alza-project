/**
 * What ALZA already sent her, from `outbound_messages` (catalog id and time only, never content).
 * Used to keep the «once» rules of 12.1: WA-07 once ever (PR01), WA-20 once a day (D28), WA-17
 * once per incident, and to avoid repeating an onboarding question she has right above.
 */
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { outboundMessages } from '../db/schema.js';
import type { DbOrTx } from '../ledger/types.js';
import type { CatalogId } from './catalog.js';

/** When one of these was last sent to her (optionally only at or after `since`). */
export async function lastSentAt(
  db: DbOrTx,
  userId: string,
  catalogIds: readonly CatalogId[],
  since?: Date,
): Promise<Date | null> {
  const [row] = await db
    .select({ createdAt: outboundMessages.createdAt })
    .from(outboundMessages)
    .where(
      and(
        eq(outboundMessages.userId, userId),
        inArray(outboundMessages.type, [...catalogIds]),
        ...(since ? [gte(outboundMessages.createdAt, since)] : []),
      ),
    )
    .orderBy(desc(outboundMessages.createdAt))
    .limit(1);
  return row?.createdAt ?? null;
}

export async function wasSent(
  db: DbOrTx,
  userId: string,
  catalogId: CatalogId,
  since?: Date,
): Promise<boolean> {
  return (await lastSentAt(db, userId, [catalogId], since)) !== null;
}
