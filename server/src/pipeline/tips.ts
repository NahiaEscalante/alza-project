/**
 * Screenshot tip (WA-19, D28, D42, RF-IN-07, case 28): after 3 unreadable screenshots in a row in
 * her first 2 weeks, at most once per business day. The counters come from what is already
 * stored: the state of her processed images and the WA-19 rows of `outbound_messages`.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { inboundMessages, outboundMessages } from '../db/schema.js';
import { shouldSendUnreadableTip, UNREADABLE_STREAK_FOR_TIP } from '../domain/index.js';

export const UNREADABLE_TIP_CATALOG_ID = 'WA-19';

/**
 * States of a processed image that count for the streak: anything readable breaks it. Failed
 * images (AI down) are neither readable nor unreadable and are skipped.
 */
const PROCESSED_IMAGE_STATUSES = [
  'recorded',
  'pending',
  'unreadable',
  'duplicate',
  'non_financial',
] as const;

/** Unreadable screenshots in a row, newest first, among her processed images. */
export async function consecutiveUnreadableImages(db: Db, userId: string): Promise<number> {
  const rows = await db
    .select({ status: inboundMessages.status })
    .from(inboundMessages)
    .where(
      and(
        eq(inboundMessages.userId, userId),
        eq(inboundMessages.type, 'image'),
        inArray(inboundMessages.status, PROCESSED_IMAGE_STATUSES),
      ),
    )
    .orderBy(desc(inboundMessages.receivedAt))
    .limit(20);
  let streak = 0;
  for (const row of rows) {
    if (row.status !== 'unreadable') break;
    streak += 1;
  }
  return streak;
}

export async function lastUnreadableTipAt(db: Db, userId: string): Promise<Date | null> {
  const [row] = await db
    .select({ createdAt: outboundMessages.createdAt })
    .from(outboundMessages)
    .where(
      and(
        eq(outboundMessages.userId, userId),
        eq(outboundMessages.type, UNREADABLE_TIP_CATALOG_ID),
      ),
    )
    .orderBy(desc(outboundMessages.createdAt))
    .limit(1);
  return row?.createdAt ?? null;
}

/** Returns the streak when the tip is due now, else null. */
export async function unreadableTipDue(
  db: Db,
  user: { id: string; createdAt: Date },
  now: Date,
): Promise<number | null> {
  const consecutiveUnreadable = await consecutiveUnreadableImages(db, user.id);
  if (consecutiveUnreadable < UNREADABLE_STREAK_FOR_TIP) return null;
  const due = shouldSendUnreadableTip({
    consecutiveUnreadable,
    userCreatedAt: user.createdAt,
    lastTipSentAt: await lastUnreadableTipAt(db, user.id),
    now,
  });
  return due ? consecutiveUnreadable : null;
}
