/**
 * WA-17 (12.1, case 24): «Estamos con un problema técnico…», only when a problem affects many
 * users, once per user per incident. For the admin panel (Fase 8): the team starts it by hand.
 *
 * - An incident is identified by when it started (`startedAt`): a user who already got WA-17 at
 *   or after that moment is skipped, so running the broadcast again is harmless.
 * - Recipients: the given users, or by default everyone with a message still waiting since the
 *   incident started (received, processing, error or failed) — the ones the text talks to.
 * - Only live accounts that finished the onboarding, and only inside WhatsApp's 24 h service
 *   window (outside it Meta requires a paid template, Fase 10).
 */
import { and, gte, inArray, isNull } from 'drizzle-orm';
import { inboundMessages, users } from '../../db/schema.js';
import { isWithinLast24Hours } from '../../domain/index.js';
import { recipientOf, sendCatalogMessage, technicalIssueMessage } from '../../messages/catalog.js';
import { wasSent } from '../../messages/outbound-log.js';
import { type FlowDeps, nowOf } from '../onboarding/deps.js';

export interface TechnicalIssueBroadcast {
  /** Start of the incident: also its identity for «once per user». */
  startedAt: Date;
  /** Default: users with messages still waiting since `startedAt`. */
  userIds?: readonly string[];
}

export interface BroadcastResult {
  sent: number;
  /** Already notified for this incident, outside the 24 h window, or not an active account. */
  skipped: number;
  failed: number;
}

const WAITING = ['received', 'processing', 'error', 'failed'] as const;

export async function broadcastTechnicalIssue(
  deps: FlowDeps,
  incident: TechnicalIssueBroadcast,
): Promise<BroadcastResult> {
  const { db, logger } = deps;
  const now = nowOf(deps);
  const ids =
    incident.userIds ??
    (
      await db
        .selectDistinct({ userId: inboundMessages.userId })
        .from(inboundMessages)
        .where(
          and(
            inArray(inboundMessages.status, [...WAITING]),
            gte(inboundMessages.receivedAt, incident.startedAt),
          ),
        )
    ).map((row) => row.userId);
  const result: BroadcastResult = { sent: 0, skipped: 0, failed: 0 };
  if (ids.length === 0) return result;

  const candidates = await db
    .select()
    .from(users)
    .where(and(inArray(users.id, [...new Set(ids)]), isNull(users.deletedAt)));
  result.skipped += new Set(ids).size - candidates.length;
  for (const user of candidates) {
    if (
      user.onboardingStatus !== 'complete' ||
      !isWithinLast24Hours(user.lastMessageAt, now) ||
      (await wasSent(db, user.id, 'WA-17', incident.startedAt))
    ) {
      result.skipped += 1;
      continue;
    }
    try {
      await sendCatalogMessage(deps.channel, recipientOf(user), technicalIssueMessage());
      result.sent += 1;
    } catch (err) {
      result.failed += 1;
      logger.warn({ err, userId: user.id }, 'technical issue notice failed');
    }
  }
  logger.info({ ...result }, 'technical issue broadcast');
  return result;
}
