/**
 * Onboarding (4.3, RF-ON-01..07, HU-01, D48), driven by `users.onboarding_status`:
 *
 *   new ─► awaiting_consent ─(Acepto)─► business_name ─► account_holder ─► close_time ─► complete
 *                 └──────(No, gracias)─► declined ─(she writes again)─► awaiting_consent
 *
 * - Before «Acepto» nothing she sends is used (RF-ON-02): the pipeline already erased the text;
 *   here only the button id is read, and the media id is dropped too. Every other message gets
 *   WA-01 again. «No, gracias» keeps only her number and the refusal (WA-02).
 * - «Acepto» stores the consent with the text version and time (RF-ON-03, 14.1) → WA-03.
 * - WA-03 business name → WA-04 holder, written (D48), normalized and checked for another
 *   account with the same holder (13.4, case 22) → WA-05 close time (buttons or free text up to
 *   2:00 a. m.) → WA-06 with the 1-hour activation link (RF-ON-07, D13). Day 1 is open.
 * - RF-ON-06: if the pending question is more than an hour old (or was never delivered), her next
 *   message resumes: the question is asked again instead of reading her text as the answer.
 *   Small talk («Hola ALZA») or an invalid answer gets the question again too.
 * - Screenshots and audios after «Acepto» are recorded as usual (`process`, she consented) and
 *   the pending question is repeated (at most once every 10 minutes).
 * - «borra mis datos» works at any step (RF-PV-01).
 *
 * Retry safety (hooks contract): each step sends its message first and then commits the new
 * state together with the message's final state (`commitMessage`). A send that fails leaves
 * nothing changed and the retry starts over; once committed, the job is finished and the
 * pipeline's own commit sees it and stops (NOT_PROCESSING). At worst a message is repeated.
 */
import { eq } from 'drizzle-orm';
import { checkHolderConflict } from '../../antifraud/index.js';
import { createActivationLink } from '../../auth/index.js';
import { consents, inboundMessages, type OnboardingStatus, users } from '../../db/schema.js';
import { HOUR_MS, MINUTE_MS } from '../../domain/index.js';
import type { Tx } from '../../ledger/types.js';
import {
  accountHolderQuestion,
  BUTTONS,
  businessNameQuestion,
  type CatalogMessage,
  CLOSE_TIME_BUTTON_PREFIX,
  closeTimeQuestion,
  declinedMessage,
  habitMessage,
  recipientOf,
  sendCatalogMessage,
  welcomeMessage,
} from '../../messages/catalog.js';
import { CONSENT_TEXT_VERSION } from '../../messages/consent.js';
import { lastSentAt } from '../../messages/outbound-log.js';
import { commitMessage, type TerminalStatus } from '../../pipeline/commit.js';
import type { FlowMessage, OnboardingEvent, OnboardingOutcome } from '../hooks.js';
import { askDeletion, confirmDeletion } from '../requests/requests.js';
import {
  businessNameAnswer,
  firstNameOf,
  holderNameAnswer,
  isDeleteDataRequest,
} from './answers.js';
import { parseCloseTimeAnswer } from './close-time.js';
import { type FlowDeps, nowOf, privacyUrl } from './deps.js';

export { CONSENT_TEXT_VERSION } from '../../messages/consent.js';

/** RF-ON-06: a pending question older than this is asked again before reading an answer. */
export const RESUME_AFTER_MS = HOUR_MS;

/** A question she has right above is not repeated for media or stray buttons. */
export const REPEAT_WINDOW_MS = 10 * MINUTE_MS;

/** Meta timestamps have whole seconds; our clock and theirs may differ a little. */
const CLOCK_TOLERANCE_MS = 2_000;

type Step = Extract<OnboardingStatus, 'business_name' | 'account_holder' | 'close_time'>;

const QUESTION: Record<Step, () => CatalogMessage> = {
  business_name: businessNameQuestion,
  account_holder: accountHolderQuestion,
  close_time: closeTimeQuestion,
};

interface StepContext {
  deps: FlowDeps;
  event: OnboardingEvent;
  now: Date;
}

export async function handleOnboarding(
  deps: FlowDeps,
  event: OnboardingEvent,
): Promise<OnboardingOutcome> {
  const context: StepContext = { deps, event, now: nowOf(deps) };
  return event.consented ? afterConsent(context) : beforeConsent(context);
}

function send(context: StepContext, message: CatalogMessage) {
  return sendCatalogMessage(context.deps.channel, recipientOf(context.event.user), message);
}

/** Commits the step's writes with the message's final state, atomically. */
async function commitStep(
  context: StepContext,
  status: TerminalStatus,
  work: (tx: Tx) => Promise<void>,
): Promise<void> {
  await commitMessage(context.deps.db, context.event.message.inboundMessageId, async (tx) => {
    await work(tx);
    return status;
  });
}

async function setStatus(tx: Tx, userId: string, status: OnboardingStatus): Promise<void> {
  await tx.update(users).set({ onboardingStatus: status }).where(eq(users.id, userId));
}

/** RF-ON-02: the media id of something sent before consent is dropped with the text. */
async function forgetContent(tx: Tx, message: FlowMessage): Promise<void> {
  if (message.type !== 'image' && message.type !== 'audio') return;
  await tx
    .update(inboundMessages)
    .set({ waMediaId: null })
    .where(eq(inboundMessages.id, message.inboundMessageId));
}

// ---------------------------------------------------------------------------
// Before consent
// ---------------------------------------------------------------------------

async function beforeConsent(context: StepContext): Promise<OnboardingOutcome> {
  const { deps, event, now } = context;
  const { user, message } = event;
  const button = message.type === 'interactive' ? message.buttonReplyId : null;

  if (button === BUTTONS.consentAccept.id) {
    const returning = Boolean(user.businessName && user.accountHolderName && user.closeTime);
    if (!returning) await send(context, businessNameQuestion());
    await commitStep(context, 'discarded_no_consent', async (tx) => {
      await tx.insert(consents).values({
        userId: user.id,
        textVersion: CONSENT_TEXT_VERSION,
        accepted: true,
        createdAt: now,
      });
      await setStatus(tx, user.id, returning ? 'complete' : 'business_name');
    });
    return 'handled';
  }

  if (button === BUTTONS.consentDecline.id) {
    const repeated =
      user.onboardingStatus === 'declined' &&
      (await sentWithin(context, 'WA-02', REPEAT_WINDOW_MS)) !== null;
    if (!repeated) await send(context, declinedMessage());
    await commitStep(context, 'discarded_no_consent', async (tx) => {
      // HU-01: only her number and the refusal stay.
      if (user.onboardingStatus !== 'declined') {
        await tx.insert(consents).values({
          userId: user.id,
          textVersion: CONSENT_TEXT_VERSION,
          accepted: false,
          createdAt: now,
        });
      }
      await setStatus(tx, user.id, 'declined');
    });
    return 'handled';
  }

  // Anything else (her «Hola», a screenshot, a stray button): the welcome, again if needed.
  const repeated =
    user.onboardingStatus === 'awaiting_consent' &&
    (await sentWithin(context, 'WA-01', REPEAT_WINDOW_MS)) !== null;
  if (!repeated) await send(context, welcomeMessage(privacyUrl(deps.appBaseUrl)));
  await commitStep(context, 'discarded_no_consent', async (tx) => {
    await forgetContent(tx, message);
    if (user.onboardingStatus !== 'complete') {
      await setStatus(tx, user.id, 'awaiting_consent');
    }
  });
  return 'handled';
}

async function sentWithin(
  context: StepContext,
  catalogId: CatalogMessage['catalogId'],
  windowMs: number,
): Promise<Date | null> {
  return lastSentAt(
    context.deps.db,
    context.event.user.id,
    [catalogId],
    new Date(context.now.getTime() - windowMs),
  );
}

// ---------------------------------------------------------------------------
// After consent
// ---------------------------------------------------------------------------

function pendingStep(status: OnboardingStatus): Step {
  // A consent without the state that follows it (should not happen) restarts at the first step.
  return status === 'account_holder' || status === 'close_time' ? status : 'business_name';
}

async function afterConsent(context: StepContext): Promise<OnboardingOutcome> {
  const { event } = context;
  const { message } = event;
  const step = pendingStep(event.user.onboardingStatus);
  const button = message.type === 'interactive' ? message.buttonReplyId : null;

  // RF-PV-01: deleting her data is possible at any step.
  if (button === BUTTONS.deleteConfirm.id) {
    await confirmDeletion(context.deps, event.user);
    return 'handled';
  }
  if (button === BUTTONS.deleteCancel.id) return 'handled';
  if (message.type === 'text' && isDeleteDataRequest(message.text)) {
    await askDeletion(context.deps, event.user);
    return 'handled';
  }

  if (message.type === 'image' || message.type === 'audio') {
    await repeatQuestion(context, step);
    return 'process';
  }

  if (message.type === 'interactive') {
    if (step === 'close_time' && button?.startsWith(CLOSE_TIME_BUTTON_PREFIX)) {
      const answer = parseCloseTimeAnswer(button.slice(CLOSE_TIME_BUTTON_PREFIX.length));
      if (answer.ok) {
        await finishOnboarding(context, answer.closeTime);
        return 'handled';
      }
    }
    // A double tap on «Acepto», an old button: the pending question, if not right above.
    await repeatQuestion(context, step);
    return 'handled';
  }

  // A text: is it the answer to the pending question?
  const askedAt = await lastSentAt(context.deps.db, event.user.id, [QUESTION[step]().catalogId]);
  const receivedAt = message.receivedAt.getTime();
  if (askedAt === null || askedAt.getTime() < receivedAt - RESUME_AFTER_MS) {
    // RF-ON-06: she comes back to an old question (or never got it): ask it again.
    await send(context, QUESTION[step]());
    return 'handled';
  }
  // She wrote before the question reached her: it is not the answer; the question is right there.
  if (askedAt.getTime() > receivedAt + CLOCK_TOLERANCE_MS) return 'handled';

  switch (step) {
    case 'business_name': {
      const name = businessNameAnswer(message.text);
      if (!name) return askAgain(context, step);
      await send(context, accountHolderQuestion());
      await commitStep(context, 'request_handled', async (tx) => {
        await tx
          .update(users)
          .set({ businessName: name, onboardingStatus: 'account_holder' })
          .where(eq(users.id, event.user.id));
      });
      return 'handled';
    }
    case 'account_holder': {
      const holder = holderNameAnswer(message.text);
      if (!holder) return askAgain(context, step);
      await send(context, closeTimeQuestion());
      await commitStep(context, 'request_handled', async (tx) => {
        await tx
          .update(users)
          .set({
            accountHolderName: holder.name,
            accountHolderNormalized: holder.normalized,
            onboardingStatus: 'close_time',
          })
          .where(eq(users.id, event.user.id));
        // 13.4, case 22: another account with this holder → alert, no points until reviewed.
        await checkHolderConflict(tx, event.user.id, holder.normalized, { now: context.now });
      });
      return 'handled';
    }
    case 'close_time': {
      const answer = parseCloseTimeAnswer(message.text ?? '');
      if (!answer.ok) {
        await send(context, closeTimeQuestion(answer.error === 'too_late'));
        return 'handled';
      }
      await finishOnboarding(context, answer.closeTime);
      return 'handled';
    }
  }
}

async function askAgain(context: StepContext, step: Step): Promise<OnboardingOutcome> {
  await send(context, QUESTION[step]());
  return 'handled';
}

/** The pending question, unless it was sent in the last 10 minutes. */
async function repeatQuestion(context: StepContext, step: Step): Promise<void> {
  const question = QUESTION[step]();
  if ((await sentWithin(context, question.catalogId, REPEAT_WINDOW_MS)) !== null) return;
  await send(context, question);
}

/** WA-06 with the 1-hour activation link (RF-ON-07, D13); onboarding complete, day 1 open. */
async function finishOnboarding(context: StepContext, closeTime: string): Promise<void> {
  const { deps, event, now } = context;
  const [user] = await deps.db.select().from(users).where(eq(users.id, event.user.id));
  const link = await createActivationLink(deps.db, event.user.id, {
    baseUrl: deps.appBaseUrl,
    now,
  });
  const name = firstNameOf(user?.accountHolderName ?? null, user?.businessName ?? '');
  await send(context, habitMessage({ name, closeTime, activationUrl: link.url }));
  await commitStep(context, 'request_handled', async (tx) => {
    await tx
      .update(users)
      .set({ closeTime, onboardingStatus: 'complete' })
      .where(eq(users.id, event.user.id));
  });
}
