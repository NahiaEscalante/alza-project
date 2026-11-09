/**
 * PR01, D41, RF-ON-08: the first screenshot recorded after the onboarding is confirmed with WA-07
 * («✅ Así lo anoté: venta por Yape de S/12,50…»). It is the only record ever confirmed.
 *
 * Counts: an image message, onboarding complete, that created a screenshot entry whose type and
 * medium are known: confirmed, or pending only for its date or a possible duplicate. An unreadable
 * screenshot, an exact duplicate, an activity list (it records nothing) or an entry waiting for
 * its direction (11.2: «venta» or «pago» is not known yet) do not count, so the first one that
 * is read is the one confirmed (D41). Once WA-07 is in `outbound_messages` it is never sent again.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { clarifications, users } from '../../db/schema.js';
import {
  canConfirmMethod,
  firstScreenshotMessage,
  recipientOf,
  sendCatalogMessage,
} from '../../messages/catalog.js';
import { wasSent } from '../../messages/outbound-log.js';
import type { AfterProcessedEvent } from '../hooks.js';
import type { FlowDeps } from './deps.js';

export async function confirmFirstScreenshot(
  deps: FlowDeps,
  event: AfterProcessedEvent,
): Promise<void> {
  const { db } = deps;
  const { message, status, entries } = event;
  if (message.type !== 'image' || (status !== 'recorded' && status !== 'pending')) return;
  const candidates = entries.filter(
    (entry) =>
      entry.source === 'screenshot' &&
      (entry.status === 'confirmed' || entry.status === 'pending') &&
      canConfirmMethod(entry.paymentMethod),
  );
  if (candidates.length === 0) return;

  const [user] = await db.select().from(users).where(eq(users.id, event.user.id));
  if (!user || user.deletedAt || user.onboardingStatus !== 'complete') return;
  if (await wasSent(db, user.id, 'WA-07')) return;

  const waitingForDirection = await db
    .select({ entryId: clarifications.ledgerEntryId })
    .from(clarifications)
    .where(
      and(
        inArray(
          clarifications.ledgerEntryId,
          candidates.map((entry) => entry.id),
        ),
        eq(clarifications.type, 'direction'),
      ),
    );
  const unknownDirection = new Set(waitingForDirection.map((row) => row.entryId));
  const entry = candidates.find((candidate) => !unknownDirection.has(candidate.id));
  if (!entry) return;
  await sendCatalogMessage(deps.channel, recipientOf(user), firstScreenshotMessage(entry));
}
