/**
 * The message worker (4.4, 9.2, RF-IN-04/05, RF-ON-02): one job per inbound message.
 *
 * States (9.2): received → processing → recorded | pending | unreadable | duplicate |
 * non_financial | request_handled | discarded_no_consent; on failure → error (retried up to 3
 * times with growing delay by pg-boss) → failed, with `error_code` for the admin panel.
 *
 * Order of work for a message:
 * 1. Consent gating: without an accepted consent nothing is processed or kept — the text is
 *    erased, media is never downloaded — and the onboarding hook gets the message. With consent
 *    but onboarding unfinished, the onboarding hook decides.
 * 2. Images and audios are downloaded and stored encrypted with their SHA-256.
 * 3. Reading (OCR/vision), transcription and interpretation, each saved in `extractions`.
 * 4. Domain rules and ledger writes, in one transaction with the final state (`commitMessage`).
 * 5. After the commit, `afterProcessed` (PR01: the first screenshot is confirmed, Fase 4).
 * Every recording branch is silent (D04); hand-offs go to `FlowHooks` (Fases 4–5).
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  type InboundMessage,
  type InboundMessageStatus,
  inboundMessages,
  ledgerEntries,
  users,
} from '../db/schema.js';
import { businessDayOf } from '../domain/index.js';
import type { FlowMessage } from '../flows/hooks.js';
import { createClarification } from '../ledger/index.js';
import { consentTextVersion } from '../messages/consent.js';
import { commitMessage, FINISHED_STATUSES, NOT_PROCESSING, type TerminalStatus } from './commit.js';
import { closeRepliedTo, hasAcceptedConsent } from './context.js';
import type { InboundQueue, PipelineDeps } from './deps.js';
import { aiFailure, errorCodeOf, PipelineError } from './errors.js';
import { saveAiResult, saveScreenshotReading } from './extractions.js';
import { ensureMedia } from './media.js';
import { applyScreenshot } from './screenshot.js';
import type { MessageWork } from './shared.js';
import { handleText, type TextSource } from './text.js';
import { unreadableTipDue } from './tips.js';

/** RF-IN-05: retries after the first attempt. Also the pg-boss `retryLimit`. */
export const MAX_RETRIES = 3;

export interface ProcessResult {
  status: InboundMessageStatus | 'missing';
  /** Already finished (repeated job): nothing was done. */
  skipped?: boolean;
  errorCode?: string;
}

export function toFlowMessage(message: InboundMessage, text = message.text): FlowMessage {
  return {
    inboundMessageId: message.id,
    waMessageId: message.waMessageId,
    type: message.type,
    text,
    buttonReplyId: message.type === 'interactive' ? message.text : null,
    replyToWaMessageId: message.replyToWaMessageId,
    receivedAt: message.receivedAt,
  };
}

/**
 * Processes one job. Throws (so pg-boss retries) while retries remain; on the last attempt, or a
 * failure retrying cannot fix, the message ends `failed` and the job completes.
 */
export async function processInboundJob(
  deps: PipelineDeps,
  job: { inboundMessageId: string; retryCount: number; jobId?: string },
): Promise<ProcessResult> {
  const { db, logger } = deps;
  const ids = { inboundMessageId: job.inboundMessageId, jobId: job.jobId };
  const [message] = await db
    .select()
    .from(inboundMessages)
    .where(eq(inboundMessages.id, job.inboundMessageId));
  if (!message) return { status: 'missing' };
  if (FINISHED_STATUSES.includes(message.status)) return { status: message.status, skipped: true };
  const [user] = await db.select().from(users).where(eq(users.id, message.userId));
  if (!user || user.deletedAt) return { status: 'missing' };

  const [started] = await db
    .update(inboundMessages)
    .set({ status: 'processing', attempts: sql`${inboundMessages.attempts} + 1` })
    .where(
      and(
        eq(inboundMessages.id, message.id),
        inArray(inboundMessages.status, ['received', 'processing', 'error']),
      ),
    )
    .returning();
  if (!started) return { status: message.status, skipped: true };

  let status: TerminalStatus;
  try {
    status = await processMessage({ deps, message: started, user });
    logger.info(
      { ...ids, userId: user.id, status, attempt: started.attempts },
      'inbound processed',
    );
  } catch (err) {
    const { code, retryable } = errorCodeOf(err);
    if (code === NOT_PROCESSING) return { status: message.status, skipped: true };
    const last = !retryable || job.retryCount >= MAX_RETRIES;
    await db
      .update(inboundMessages)
      .set({ status: last ? 'failed' : 'error', errorCode: code })
      .where(eq(inboundMessages.id, message.id));
    const entry = { ...ids, userId: user.id, code, attempt: started.attempts, err };
    if (last) {
      logger.error(entry, 'inbound failed');
      return { status: 'failed', errorCode: code };
    }
    logger.warn(entry, 'inbound error, will retry');
    // A sanitized error: pg-boss stores it in the job row.
    throw new PipelineError(code, { retryable });
  }
  await notifyAfterProcessed({ deps, message: started, user }, status);
  return { status };
}

/**
 * PR01 (Fase 4): the committed message and the entries it created go to `afterProcessed`. Runs
 * once per message (a finished job is skipped); a failing hook is logged, never retried.
 */
async function notifyAfterProcessed(work: MessageWork, status: TerminalStatus): Promise<void> {
  const { deps, message, user } = work;
  if (status === 'discarded_no_consent') return;
  try {
    const entries =
      status === 'recorded' || status === 'pending'
        ? await deps.db
            .select()
            .from(ledgerEntries)
            .where(eq(ledgerEntries.inboundMessageId, message.id))
            .orderBy(asc(ledgerEntries.createdAt))
        : [];
    await deps.hooks.afterProcessed({ user, message: toFlowMessage(message), status, entries });
  } catch (err) {
    deps.logger.warn(
      { err, inboundMessageId: message.id, userId: user.id },
      'after processed hook failed',
    );
  }
}

async function processMessage(work: MessageWork): Promise<TerminalStatus> {
  const { deps, message, user } = work;
  const { db, hooks } = deps;

  // RF-ON-02, HU-01: nothing is processed or kept before «Acepto».
  if (!(await hasAcceptedConsent(db, user.id, consentTextVersion(deps.messagingApp)))) {
    const flow = toFlowMessage(message);
    if (message.type !== 'interactive' && message.text !== null) {
      await db
        .update(inboundMessages)
        .set({ text: null })
        .where(eq(inboundMessages.id, message.id));
    }
    await hooks.onboarding({ user, message: flow, consented: false });
    return commitMessage(db, message.id, async () => 'discarded_no_consent');
  }
  if (user.onboardingStatus !== 'complete') {
    const outcome = await hooks.onboarding({
      user,
      message: toFlowMessage(message),
      consented: true,
    });
    if (outcome !== 'process') return commitMessage(db, message.id, async () => 'request_handled');
  }

  switch (message.type) {
    case 'image':
      return processImage(work);
    case 'audio':
      return processAudio(work);
    case 'text': {
      const text = message.text?.trim() ?? '';
      if (text === '') return commitMessage(db, message.id, async () => 'non_financial');
      return processText(work, text, 'text');
    }
    case 'interactive':
      await hooks.request({
        user,
        message: toFlowMessage(message),
        request: null,
        buttonReplyId: message.text,
      });
      return commitMessage(db, message.id, async () => 'request_handled');
  }
}

async function processImage(work: MessageWork): Promise<TerminalStatus> {
  const { deps, message } = work;
  const media = await ensureMedia(deps, message);
  // Case 1: the same file again → exact duplicate, no reading, no doubt.
  if (media.duplicateOfEarlierFile) {
    return commitMessage(deps.db, message.id, async () => 'duplicate');
  }
  const reading = await deps.readScreenshot(
    { data: media.bytes, mimeType: media.file.mimeType },
    deps.now(),
  );
  await saveScreenshotReading(deps.db, message.id, reading);
  // The vision fallback was down: retry later instead of asking her (RF-IN-05).
  if (reading.aiFailure) throw aiFailure(reading.aiFailure);
  const status = await applyScreenshot(work, reading);
  if (status === 'unreadable') await maybeUnreadableTip(work);
  return status;
}

async function processAudio(work: MessageWork): Promise<TerminalStatus> {
  const { deps, message, user } = work;
  const media = await ensureMedia(deps, message);
  if (media.duplicateOfEarlierFile) {
    return commitMessage(deps.db, message.id, async () => 'duplicate');
  }
  const result = await deps.ai.transcribeAudio({
    data: media.bytes,
    mimeType: media.file.mimeType,
  });
  await saveAiResult(deps.db, message.id, 'transcribe_audio', result);
  if (!result.ok) throw aiFailure(result.error);
  const transcript = result.value.text.trim();
  if (result.value.lowConfidence || transcript === '') {
    // «Un audio de las … no se entendió. ¿De cuánto era?» — never a guess (RF-EX-06).
    return commitMessage(deps.db, message.id, async (tx) => {
      await createClarification(tx, {
        userId: user.id,
        businessDay: businessDayOf(message.receivedAt),
        type: 'unreadable',
        inboundMessageId: message.id,
        detail: { at: message.receivedAt.toISOString(), direction: 'in', paymentMethod: 'cash' },
      });
      return 'unreadable';
    });
  }
  return processText(work, transcript, 'audio');
}

async function processText(
  work: MessageWork,
  text: string,
  source: TextSource,
): Promise<TerminalStatus> {
  const { deps, message, user } = work;
  const replied = await closeRepliedTo(deps.db, user.id, message.replyToWaMessageId);
  const outcome = await handleText(work, text, source, replied);
  if (outcome.kind === 'done') return outcome.status;

  const { handoff } = outcome;
  const flow = toFlowMessage(message, text);
  switch (handoff.kind) {
    case 'close_reply':
      if (handoff.close) {
        await deps.hooks.closeReply({ user, message: flow, text, ...handoff.close });
      }
      break;
    case 'close_now':
      await deps.hooks.closeNow({
        user,
        message: flow,
        businessDay: businessDayOf(message.receivedAt),
      });
      break;
    case 'request':
      await deps.hooks.request({
        user,
        message: flow,
        request: handoff.interpretation?.request ?? null,
        buttonReplyId: null,
      });
      break;
    case 'danger':
      await deps.hooks.danger({ user, message: flow });
      break;
  }
  return commitMessage(deps.db, message.id, async () => 'request_handled');
}

/** D28: runs after the message is committed; a failing hook is logged, never retried. */
async function maybeUnreadableTip(work: MessageWork): Promise<void> {
  const { deps, message, user } = work;
  try {
    const streak = await unreadableTipDue(deps.db, user, deps.now());
    if (streak === null) return;
    await deps.hooks.unreadableTip({
      user,
      message: toFlowMessage(message),
      consecutiveUnreadable: streak,
      businessDay: businessDayOf(message.receivedAt),
    });
  } catch (err) {
    deps.logger.warn(
      { err, inboundMessageId: message.id, userId: user.id },
      'unreadable tip hook failed',
    );
  }
}

/** RF-AD-01 (admin panel, Fase 8): a `failed` message goes back to the queue. */
export async function retryInboundMessage(
  deps: { db: PipelineDeps['db']; queue: InboundQueue },
  inboundMessageId: string,
): Promise<boolean> {
  const [row] = await deps.db
    .update(inboundMessages)
    .set({ status: 'received', errorCode: null })
    .where(and(eq(inboundMessages.id, inboundMessageId), eq(inboundMessages.status, 'failed')))
    .returning({ id: inboundMessages.id, userId: inboundMessages.userId });
  if (!row) return false;
  await deps.queue.enqueue({ inboundMessageId: row.id, userId: row.userId }, { fresh: true });
  return true;
}
