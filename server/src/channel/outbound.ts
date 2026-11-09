import type { Db } from '../db/client.js';
import { outboundMessages } from '../db/schema.js';
import type { OutboundContext } from './types.js';

/**
 * Meta pricing (4.1 cost note): free-form messages inside the 24 h customer service window are
 * «service» conversations and are not billed. Templates (outside the window) arrive in Fase 10.
 */
export const SERVICE_PRICING = { pricingCategory: 'service', billable: false } as const;

/**
 * Every adapter records what it sent in `outbound_messages` (catalog id, wa id, pricing). Never
 * the content: the text lives in the catalog templates (12.1) and her data in the ledger.
 */
export async function recordOutbound(
  db: Db,
  ctx: OutboundContext,
  waMessageId: string,
): Promise<string> {
  const [row] = await db
    .insert(outboundMessages)
    .values({ userId: ctx.userId, type: ctx.catalogId, waMessageId, ...SERVICE_PRICING })
    .returning({ id: outboundMessages.id });
  if (!row) throw new Error('insert returned no row');
  return row.id;
}
