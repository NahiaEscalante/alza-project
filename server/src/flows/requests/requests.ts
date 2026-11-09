/**
 * Exceptions to the silence (D05, D27, D28): what she asks for and the two safety messages.
 *
 * - «web» (case 15) → WA-13 with a 7-day link. Without a usable PIN (none yet, or 10 failures
 *   that require a new activation, 14.3) the 7-day link would only show «crea tu PIN», so she
 *   gets WA-14 with a 1-hour activation link instead (Fase 7a note).
 * - «olvidé mi PIN» (case 16) → WA-14 with a 1-hour activation link (D13).
 * - «borra mis datos» (case 17, HU-15) → WA-15 with «Sí, borrar todo» / «Cancelar». «Sí» →
 *   WA-16 first, then the account is deleted right away (RF-PV-01, D57): the notice goes while
 *   her phone still exists and inside the 24 h window; the deletion then removes that outbound
 *   row too and leaves only the anonymous user row. «Cancelar» → silence (12.1 has no message).
 * - «sin imagen» / «con imagen» (case 27, D27) → the preference changes silently; the next close
 *   says it in one line (Fase 5).
 * - Danger (case 29, RF-IN-08) → WA-20, at most once per business day, never a follow-up.
 * - Unreadable screenshots (case 28, D28, D42) → WA-19; the pipeline already applied the gating.
 *
 * Retries: a hook that throws is retried with the message. Links are cheap to issue again, and
 * the «once» rules read `outbound_messages`, so a retry never sends WA-16 or WA-20 twice.
 */
import { eq } from 'drizzle-orm';
import { deleteAccount } from '../../account/index.js';
import { createAccessLink, createActivationLink } from '../../auth/index.js';
import { pins, type User, users } from '../../db/schema.js';
import { businessDayOf, businessDayStart, MAX_TOTAL_FAILURES } from '../../domain/index.js';
import {
  accessLinkMessage,
  activationLinkMessage,
  BUTTONS,
  dangerMessage,
  dataDeletedMessage,
  deleteConfirmationQuestion,
  recipientOf,
  screenshotTipMessage,
  sendCatalogMessage,
} from '../../messages/catalog.js';
import { wasSent } from '../../messages/outbound-log.js';
import type { DangerEvent, RequestEvent, UnreadableTipEvent } from '../hooks.js';
import { type FlowDeps, nowOf } from '../onboarding/deps.js';

type SomeUser = Pick<User, 'id' | 'phoneE164'>;

export async function handleRequest(deps: FlowDeps, event: RequestEvent): Promise<void> {
  const { user, buttonReplyId, request } = event;
  if (buttonReplyId !== null) {
    // Only the WA-15 buttons mean something here; old onboarding buttons are ignored.
    if (buttonReplyId === BUTTONS.deleteConfirm.id) await confirmDeletion(deps, user);
    return;
  }
  switch (request) {
    case 'web_link':
      return sendWebLink(deps, user);
    case 'forgot_pin':
      return sendActivationLink(deps, user);
    case 'delete_data':
      return askDeletion(deps, user);
    case 'text_only':
    case 'with_image':
      // Case 27: no answer now; the next close confirms it (Fase 5).
      await deps.db
        .update(users)
        .set({ summaryImage: request === 'with_image' })
        .where(eq(users.id, user.id));
      return;
    default:
      return;
  }
}

/** Case 15 (and the Fase 7a note for her without a PIN). */
export async function sendWebLink(deps: FlowDeps, user: SomeUser): Promise<void> {
  const [pin] = await deps.db
    .select({ totalFailedAttempts: pins.totalFailedAttempts })
    .from(pins)
    .where(eq(pins.userId, user.id));
  if (!pin || pin.totalFailedAttempts >= MAX_TOTAL_FAILURES) {
    return sendActivationLink(deps, user);
  }
  const link = await createAccessLink(deps.db, user.id, {
    baseUrl: deps.appBaseUrl,
    now: nowOf(deps),
  });
  await sendCatalogMessage(deps.channel, recipientOf(user), accessLinkMessage(link.url));
}

/** Case 16, D13: a new 1-hour activation link (earlier unused ones stop working). */
export async function sendActivationLink(deps: FlowDeps, user: SomeUser): Promise<void> {
  const link = await createActivationLink(deps.db, user.id, {
    baseUrl: deps.appBaseUrl,
    now: nowOf(deps),
  });
  await sendCatalogMessage(deps.channel, recipientOf(user), activationLinkMessage(link.url));
}

/** Case 17: WA-15 with its two buttons. */
export async function askDeletion(deps: FlowDeps, user: SomeUser): Promise<void> {
  await sendCatalogMessage(deps.channel, recipientOf(user), deleteConfirmationQuestion());
}

/**
 * «Sí, borrar todo» (HU-15, RF-PV-01): WA-16, then the deletion, now. Only after a WA-15 (a
 * stray button id deletes nothing). Idempotent: a retry after a failed deletion does not send
 * WA-16 again; once deleted, the pipeline finds no user and stops.
 */
export async function confirmDeletion(deps: FlowDeps, user: SomeUser): Promise<void> {
  const { db, logger } = deps;
  if (!(await wasSent(db, user.id, 'WA-15'))) {
    logger.warn({ userId: user.id }, 'delete confirmation without WA-15 ignored');
    return;
  }
  if (!(await wasSent(db, user.id, 'WA-16'))) {
    await sendCatalogMessage(deps.channel, recipientOf(user), dataDeletedMessage());
  }
  const result = await deleteAccount({ db, storage: deps.storage }, user.id, { now: nowOf(deps) });
  logger.info({ userId: user.id, status: result.status }, 'account deleted on request');
}

/** Case 29, RF-IN-08: one WA-20 a day at most; no follow-up, no questions. */
export async function handleDanger(deps: FlowDeps, event: DangerEvent): Promise<void> {
  const now = nowOf(deps);
  const dayStart = businessDayStart(businessDayOf(now));
  if (await wasSent(deps.db, event.user.id, 'WA-20', dayStart)) return;
  await sendCatalogMessage(deps.channel, recipientOf(event.user), dangerMessage());
}

/** Case 28: WA-19 (the pipeline checked D28/D42: 3 in a row, first 2 weeks, once a day). */
export async function sendScreenshotTip(deps: FlowDeps, event: UnreadableTipEvent): Promise<void> {
  await sendCatalogMessage(deps.channel, recipientOf(event.user), screenshotTipMessage());
}
