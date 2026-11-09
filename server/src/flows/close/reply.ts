/**
 * Her answer to the close (10.3, RF-CI-06..08, HU-07, 11.7, 11.9, D07, D17, PR10, cases 19–21).
 *
 * 1. Questions: the numbered doubts of the message (`message_number`) and the cash check after
 *    them (PR08). A first reply is read against all of them; after WA-11, only against the points
 *    asked again; a later «responder» against what is still open.
 * 2. Interpretation with `ai.interpretCloseReply`, saved in `extractions` and reused when the job
 *    is retried, so a retry never asks the model twice for the same message.
 * 3. In one transaction, under the close lock: each answer resolves its doubt through the ledger
 *    (source `close_reply`), every movement she explains is recorded «Lo contaste tú», the cash
 *    check follows 11.7, the points not understood or missing are asked again (WA-11, at most 2
 *    rounds), and the level follows 11.9. Then ONE answer: WA-11, WA-12 (with the points of the
 *    day, provisional until 12:00) or WA-18 when it came after the deadline (no points, D17).
 * 4. `reply_log` keeps the inbound message id: a retried job never applies it twice.
 */
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { amountToCents } from '../../ai/amount.js';
import { INTERPRET_CLOSE_REPLY_PROMPT_VERSION } from '../../ai/prompts/close-reply.js';
import {
  type CloseAnswerValue,
  type CloseQuestion,
  type CloseQuestionType,
  type CloseReplyInterpretation,
  closeReplyInterpretationSchema,
} from '../../ai/schemas.js';
import {
  type Category,
  type CloseLevel,
  clarifications,
  type DailyClose,
  dailyCloses,
  extractions,
} from '../../db/schema.js';
import {
  type CashCheckAnswer,
  cashCheckQuestion,
  closeLevelAfterReply,
  closeReplyFollowUp,
  type Direction,
  improvedLevel,
  isBetterLevel,
  isCashVerified,
  isCategoryValidFor,
  resolveCashCheck,
} from '../../domain/index.js';
import {
  type Actor,
  type ClarificationDetail,
  type ClarificationResolution,
  createClarification,
  createEntry,
  LedgerError,
  type ResolveClarificationResult,
  resolveClarification,
  weekdayName,
} from '../../ledger/index.js';
import { inTransaction, type Tx } from '../../ledger/types.js';
import {
  CLOSE_CATALOG,
  clarifyText,
  confirmationText,
  LATE_REPLY_TEXT,
} from '../../messages/close.js';
import { aiFailure } from '../../pipeline/errors.js';
import { saveExtraction } from '../../pipeline/extractions.js';
import type { CloseReplyEvent } from '../hooks.js';
import { type DoubtRow, doubtQuestion, doubtsOfDay, lockCloseDay } from './data.js';
import { previewClosePoints } from './points-preview.js';
import type { CloseFlowDeps, CloseReplyLogEntry } from './types.js';

/** Her answer, by WhatsApp. */
export const CLOSE_REPLY_ACTOR: Actor = { kind: 'user', channel: 'whatsapp' };
/** Rows written by her answer belong to the close itself (not «agregado después del cierre»). */
const CLOSE_REPLY_ORIGIN = { source: 'close_reply', afterClose: false } as const;
const RESOLVED = ['resolved', 'resolved_web'] as const;

interface Question extends CloseQuestion {
  /** Null for the cash check. */
  doubt: DoubtRow | null;
}

export function replyLogOf(close: Pick<DailyClose, 'replyLog'>): CloseReplyLogEntry[] {
  return Array.isArray(close.replyLog) ? (close.replyLog as CloseReplyLogEntry[]) : [];
}

const isResolved = (row: DoubtRow) =>
  (RESOLVED as readonly string[]).includes(row.clarification.status);

/** The numbered questions of the close message as they read now (texts are not stored). */
async function closeQuestions(
  db: CloseFlowDeps['db'] | Tx,
  close: DailyClose,
): Promise<Question[]> {
  const rows = (await doubtsOfDay(db, close.userId, close.businessDay))
    .filter((row) => row.clarification.messageNumber !== null)
    .sort((a, b) => (a.clarification.messageNumber ?? 0) - (b.clarification.messageNumber ?? 0));
  const questions: Question[] = rows.map((row) => ({
    number: row.clarification.messageNumber as number,
    type: row.clarification.type as CloseQuestionType,
    text: doubtQuestion(row),
    doubt: row,
  }));
  const last = questions.at(-1)?.number ?? 0;
  questions.push({
    number: last + 1,
    type: 'cash_check',
    text: cashCheckQuestion(close.expectedCashChangeCents ?? 0).text,
    doubt: null,
  });
  return questions;
}

/** What this reply is read against. */
function questionsToRead(close: DailyClose, all: readonly Question[]): Question[] {
  const lastAsked = replyLogOf(close).at(-1)?.asked;
  if (close.status === 'awaiting_clarification' && lastAsked && lastAsked.length > 0) {
    return all.filter((q) => lastAsked.includes(q.number));
  }
  const open = all.filter((q) =>
    q.doubt ? !isResolved(q.doubt) : !isCashVerified(close.cashCheck),
  );
  // Nothing left to ask: the cash question still gives the model its context.
  return open.length > 0 ? open : all.filter((q) => q.doubt === null);
}

async function interpret(
  deps: CloseFlowDeps,
  event: CloseReplyEvent,
  questions: readonly Question[],
): Promise<CloseReplyInterpretation> {
  const messageId = event.message.inboundMessageId;
  const [saved] = await deps.db
    .select({ result: extractions.result })
    .from(extractions)
    .where(
      and(
        eq(extractions.inboundMessageId, messageId),
        eq(extractions.function, 'interpret_close_reply'),
        eq(extractions.isValid, true),
      ),
    )
    .orderBy(desc(extractions.createdAt))
    .limit(1);
  if (saved) {
    const parsed = closeReplyInterpretationSchema.safeParse(saved.result);
    if (parsed.success) return parsed.data;
  }
  const result = await deps.ai.interpretCloseReply(
    event.text,
    questions.map(({ number, type, text }) => ({ number, type, text })),
  );
  await saveExtraction(deps.db, {
    inboundMessageId: messageId,
    fn: 'interpret_close_reply',
    model: result.ok ? result.meta.model : 'none',
    promptVersion: result.ok ? result.meta.promptVersion : INTERPRET_CLOSE_REPLY_PROMPT_VERSION,
    result: result.ok ? result.value : { error: result.error, attempts: result.attempts },
    isValid: result.ok,
  });
  if (!result.ok) throw aiFailure(result.error);
  return result.value;
}

function categoryFor(direction: Direction, stated: Category | null | undefined): Category {
  if (stated && isCategoryValidFor(stated, direction)) return stated;
  return direction === 'in' ? 'sale' : 'unclassified';
}

/** How one answer resolves its doubt; `stays` = understood, but nothing to apply here. */
function resolutionFor(
  doubt: DoubtRow,
  value: CloseAnswerValue,
): ClarificationResolution | 'stays' | null {
  const detail = (doubt.clarification.detail ?? {}) as ClarificationDetail;
  switch (doubt.clarification.type) {
    case 'unreadable': {
      const cents = value.amount ? amountToCents(value.amount) : null;
      if (cents === null) return null;
      // D66: the method the screenshot showed stays (`detail.paymentMethod`, kept by
      // `set_amount`); only when the screen did not show it, the one she names («12 por Plin»).
      const said = value.payment_method ?? null;
      const paymentMethod =
        !detail.paymentMethod && !doubt.entry && said !== null && said !== 'unknown'
          ? said
          : undefined;
      return {
        action: 'set_amount',
        amountCents: cents,
        ...(paymentMethod ? { paymentMethod } : {}),
      };
    }
    case 'ambiguous_total': {
      // «¿Cuál es correcto?» (11.5 row 3): any answer keeps what is recorded; fixes go to the web.
      if (detail.variant === 'cash_below_recorded') return { action: 'dismiss' };
      const method = value.payment_method ?? null;
      if (method === 'cash') return { action: 'cash_only' };
      if (method === 'unknown' || (method === null && value.scope === 'day_total')) {
        return { action: 'whole_day' };
      }
      // «Solo Yape»: a digital total never adds on top of the screenshots (11.5, D03).
      if (method === 'yape' || method === 'plin' || method === 'bank_transfer') {
        return { action: 'dismiss' };
      }
      return null;
    }
    case 'possible_duplicate':
      if (value.is_duplicate === true) return { action: 'mark_duplicate' };
      if (value.is_duplicate === false) return { action: 'confirm' };
      return null;
    case 'direction': {
      const direction = value.direction ?? null;
      if (direction === null) return null;
      return {
        action: 'set_direction',
        direction,
        category: categoryFor(direction, value.category),
      };
    }
    case 'date':
      if (value.is_today === true) return { action: 'confirm' };
      // «Es de otro día»: which day is chosen in Pendientes (the web asks for it).
      if (value.is_today === false) return 'stays';
      return null;
    case 'category': {
      const direction = doubt.entry?.direction ?? 'out';
      const category = value.category ?? null;
      return category && isCategoryValidFor(category, direction)
        ? { action: 'set_category', category }
        : null;
    }
    case 'missing_from_list':
      return null;
  }
}

function cashAnswerOf(
  value: CloseAnswerValue | undefined,
  explainedMovements: number,
): CashCheckAnswer {
  switch (value?.cash_check) {
    case 'balanced':
      return 'yes';
    case 'not_balanced':
      return explainedMovements > 0 ? 'no_explained' : 'no_unexplained';
    case 'unsure':
      return 'unsure';
    default:
      return 'missing';
  }
}

/** PR15: an outgoing payment that ends without type gets its low-priority doubt (to the web). */
async function categoryDoubtIfUnclassified(
  tx: Tx,
  entry: ResolveClarificationResult['entry'],
  inboundMessageId: string,
): Promise<void> {
  if (entry?.direction !== 'out' || entry.category !== 'unclassified') return;
  if (entry.status !== 'confirmed') return;
  await createClarification(tx, {
    userId: entry.userId,
    businessDay: entry.businessDay,
    type: 'category',
    ledgerEntryId: entry.id,
    inboundMessageId,
  });
}

/** Applies her reply and answers it (WA-11, WA-12 or WA-18). Idempotent per inbound message. */
export async function applyCloseReply(deps: CloseFlowDeps, event: CloseReplyEvent): Promise<void> {
  const { db, logger, channel } = deps;
  const { user, message, businessDay: day } = event;
  const log = { userId: user.id, businessDay: day, inboundMessageId: message.inboundMessageId };

  const [initial] = await db
    .select()
    .from(dailyCloses)
    .where(and(eq(dailyCloses.userId, user.id), eq(dailyCloses.businessDay, day)));
  if (!initial || initial.sentAt === null) {
    logger.warn(log, 'close reply without a sent close: ignored');
    return;
  }
  if (replyLogOf(initial).some((e) => e.inboundMessageId === message.inboundMessageId)) return;

  const asked = questionsToRead(initial, await closeQuestions(db, initial));
  const interpretation = await interpret(deps, event, asked);

  const outcome = await inTransaction(db, async (tx) => {
    await lockCloseDay(tx, user.id, day);
    const [close] = await tx
      .select()
      .from(dailyCloses)
      .where(eq(dailyCloses.id, initial.id))
      .for('update');
    if (!close) throw new Error('daily close vanished');
    const replyLog = replyLogOf(close);
    if (replyLog.some((e) => e.inboundMessageId === message.inboundMessageId)) return null;

    const now = deps.now();
    // The day became final while this reply waited (12:00 job): no points anymore (D17).
    const timing = close.finalAt !== null ? 'late' : event.timing;
    const current = await closeQuestions(tx, close);
    const toAsk: number[] = [];
    let cashQuestion: Question | null = null;

    // --- Each numbered doubt ---------------------------------------------------------------
    for (const q of asked) {
      const now_q = current.find((c) => c.number === q.number);
      if (!now_q) continue;
      if (now_q.doubt === null) {
        cashQuestion = now_q;
        continue;
      }
      const doubt = now_q.doubt;
      if (isResolved(doubt)) continue;
      const answer = interpretation.answers.find((a) => a.number === q.number);
      if (!answer || interpretation.not_understood.includes(q.number)) {
        toAsk.push(q.number);
        continue;
      }
      // «No sé», «no me acuerdo»: understood; not asked again (it stays for the web).
      if (!answer.resolved) continue;
      const resolution = resolutionFor(doubt, answer.value);
      if (resolution === 'stays') continue;
      if (resolution === null) {
        toAsk.push(q.number);
        continue;
      }
      try {
        const result = await resolveClarification(tx, {
          userId: user.id,
          clarificationId: doubt.clarification.id,
          resolution,
          actor: CLOSE_REPLY_ACTOR,
          now,
          origin: CLOSE_REPLY_ORIGIN,
        });
        await categoryDoubtIfUnclassified(tx, result.entry, message.inboundMessageId);
      } catch (err) {
        if (!(err instanceof LedgerError)) throw err;
        if (err.code !== 'already_resolved') toAsk.push(q.number);
      }
    }

    // --- Movements she explains (11.7: «saqué 40 para la casa») ----------------------------------
    let explained = 0;
    for (const item of interpretation.new_entries) {
      const amountCents = amountToCents(item.amount);
      if (amountCents === null) continue;
      const entry = await createEntry(
        tx,
        {
          userId: user.id,
          businessDay: day,
          amountCents,
          direction: item.direction,
          paymentMethod: item.payment_method,
          category: categoryFor(item.direction, item.category),
          label: 'self_reported',
          source: 'close_reply',
          inboundMessageId: message.inboundMessageId,
          afterClose: false,
        },
        CLOSE_REPLY_ACTOR,
        'close_reply',
      );
      explained += 1;
      await categoryDoubtIfUnclassified(tx, entry, message.inboundMessageId);
    }

    // --- Cash check (11.7) ----------------------------------------------------------------------
    let cashCheck = close.cashCheck;
    // Verified stays verified: a later message only adds movements.
    if (cashQuestion && !isCashVerified(cashCheck)) {
      const answer = interpretation.answers.find((a) => a.number === cashQuestion?.number);
      const understood = answer && !interpretation.not_understood.includes(cashQuestion.number);
      const said = cashAnswerOf(understood ? answer.value : undefined, explained);
      if (said === 'missing' && cashCheck !== null) {
        // Already answered «no sé» (or no answer at 12:00): not asked again.
      } else {
        const result = resolveCashCheck(said, close.clarificationRounds);
        if (result.kind === 'resolved') cashCheck = result.result;
        else toAsk.push(cashQuestion.number);
      }
    }

    // --- Follow-up (WA-11, RF-CI-07) and level (11.9) --------------------------------------------
    const followUp =
      timing === 'late'
        ? ({ kind: 'finish' } as const)
        : closeReplyFollowUp({ unresolvedNumbers: toAsk, roundsUsed: close.clarificationRounds });
    const inMessage = await tx
      .select({ status: clarifications.status })
      .from(clarifications)
      .where(
        and(
          eq(clarifications.userId, user.id),
          eq(clarifications.businessDay, day),
          isNotNull(clarifications.messageNumber),
        ),
      );
    const level = closeLevelAfterReply({
      messageClarificationsResolved: inMessage.every((row) =>
        (RESOLVED as readonly string[]).includes(row.status),
      ),
      cashCheck,
    });

    const askAgain = followUp.kind === 'ask_again';
    const response: CloseReplyLogEntry['response'] = askAgain
      ? 'WA-11'
      : timing === 'late'
        ? 'WA-18'
        : 'WA-12';
    const entry: CloseReplyLogEntry = {
      inboundMessageId: message.inboundMessageId,
      receivedAt: message.receivedAt.toISOString(),
      timing,
      response,
      level,
      ...(askAgain ? { asked: followUp.numbers } : {}),
    };
    const update: Partial<typeof dailyCloses.$inferInsert> = {
      repliedAt: close.repliedAt ?? message.receivedAt,
      cashCheck,
      clarificationRounds: close.clarificationRounds + (askAgain ? 1 : 0),
      replyLog: [...replyLog, entry],
    };
    // The ledger may have raised the level while resolving (refreshDayLevel): read it again.
    const [fresh] = await tx.select().from(dailyCloses).where(eq(dailyCloses.id, close.id));
    const stored = fresh ?? close;
    if (stored.finalAt !== null) {
      const improved = improvedLevel({
        finalLevel: stored.level ?? 'no_close',
        currentImprovedLevel: stored.improvedLevel,
        newLevel: level,
      });
      if (improved) update.improvedLevel = improved;
    } else {
      update.level = stored.level && isBetterLevel(stored.level, level) ? stored.level : level;
      update.status = askAgain ? 'awaiting_clarification' : 'replied';
    }

    // --- One answer ------------------------------------------------------------------------------
    const ctx = (catalogId: string) => ({ userId: user.id, to: user.phoneE164, catalogId });
    if (askAgain) {
      const points = followUp.numbers.map((number) => ({
        number,
        question: current.find((q) => q.number === number)?.text ?? '',
      }));
      await channel.sendText(ctx(CLOSE_CATALOG.clarify), { body: clarifyText(points) });
    } else if (timing === 'late') {
      await channel.sendText(ctx(CLOSE_CATALOG.late), { body: LATE_REPLY_TEXT });
    } else {
      const finalLevel = (update.level ?? level) as Exclude<CloseLevel, 'no_close'>;
      const preview = await previewClosePoints(tx, user.id, day, finalLevel);
      const missing = (await doubtsOfDay(tx, user.id, day, ['open', 'in_web'])).filter(
        (row) =>
          row.clarification.type === 'missing_from_list' &&
          ((row.clarification.detail ?? {}) as ClarificationDetail).row?.direction !== 'out',
      ).length;
      await channel.sendText(ctx(CLOSE_CATALOG.confirm), {
        body: confirmationText({
          weekday: weekdayName(day),
          level: finalLevel,
          points: preview.points,
          balance: preview.balance,
          nextReward: preview.nextReward,
          missingFromListCount: missing,
        }),
      });
    }
    await tx.update(dailyCloses).set(update).where(eq(dailyCloses.id, close.id));
    return { response, level, timing, asked: entry.asked?.length ?? 0 };
  });

  logger.info({ ...log, via: event.via, ...(outcome ?? { skipped: true }) }, 'close reply');
}
