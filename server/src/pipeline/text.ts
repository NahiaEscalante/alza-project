/**
 * Texts and transcribed audios (RF-EX-03..06, 11.4, 11.5, case 9, case 13).
 *
 * Intent (PR17) → branch:
 * - record: each operation separately (RF-EX-04). Single operations are «Lo contaste tú»; a sale
 *   without method is cash (D58). No amount, or an amount the model was not sure of → `unreadable`
 *   doubt with her words (case 9), never a guess. A digital mention that a screenshot already
 *   covers is linked and adds nothing (11.4). Day totals follow 11.5 (PR09, D40).
 * - correct: her last entry of the last 15 minutes (case 13): corrected (new row, the old one
 *   `superseded`) or voided; several candidates → a doubt.
 * - close_reply, close_now, request, danger: handed to Fases 4–5 (`FlowHooks`).
 * - other: ignored (case 14).
 * Silent in every recording branch (D04).
 */
import { amountToCents, centsToAmount, confidentTextAmount } from '../ai/index.js';
import type { RecentEntry } from '../ai/prompts/text.js';
import type { Correction, TextInterpretation, TextOperation } from '../ai/schemas.js';
import type { LedgerEntry, LedgerEntrySource } from '../db/schema.js';
import {
  type Category,
  CORRECTION_WINDOW_MS,
  closeForReply,
  closeReplyTiming,
  type DeclaredTotalMethod,
  type Direction,
  decideCategory,
  evaluateDeclaredTotal,
  findCorrectionTarget,
  findScreenshotForMention,
  type IsoDate,
  isCategoryValidFor,
  isDigitalMethod,
  normalizeName,
  type PaymentMethod,
} from '../domain/index.js';
import {
  type ClarificationDetail,
  correctEntry,
  createClarification,
  createEntry,
  voidEntry,
} from '../ledger/index.js';
import type { Tx } from '../ledger/types.js';
import {
  combineStatuses,
  commitMessage,
  PIPELINE_ACTOR,
  type TerminalStatus,
  WHATSAPP_USER_ACTOR,
} from './commit.js';
import {
  type CloseInfo,
  liveEntriesOfDays,
  loadCloses,
  loadCounterpartyRules,
  recentEntries,
} from './context.js';
import { aiFailure } from './errors.js';
import { saveAiResult } from './extractions.js';
import { entryAttribution, type MessageWork } from './shared.js';

/** «Dijiste «…»» quotes stay short (the web cuts at 80 too). */
function quoteOf(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 200 ? `${clean.slice(0, 199)}…` : clean;
}

export type TextSource = Extract<LedgerEntrySource, 'text' | 'audio'>;

/** What the hand-off branches need besides the text. */
export interface TextHandoff {
  kind: 'close_reply' | 'close_now' | 'request' | 'danger';
  interpretation: TextInterpretation | null;
  /** close_reply only. */
  close?: { businessDay: IsoDate; timing: 'on_time' | 'late'; via: 'reply_context' | 'intent' };
}

export type TextOutcome =
  | { kind: 'done'; status: TerminalStatus }
  | { kind: 'handoff'; handoff: TextHandoff };

/** Interprets a text (or transcription) and applies it; returns hand-offs for the caller. */
export async function handleText(
  work: MessageWork,
  text: string,
  source: TextSource,
  repliedClose: CloseInfo | null,
): Promise<TextOutcome> {
  const { deps, message, user } = work;
  const receivedAt = message.receivedAt;

  // 11.1: «responder» on the close message is always an answer to that close.
  if (repliedClose) {
    return {
      kind: 'handoff',
      handoff: {
        kind: 'close_reply',
        interpretation: null,
        close: {
          businessDay: repliedClose.businessDay,
          timing: closeReplyTiming(repliedClose.businessDay, receivedAt),
          via: 'reply_context',
        },
      },
    };
  }

  const now = deps.now();
  const closes = await loadCloses(deps.db, user.id, receivedAt);
  const recent = await recentEntries(
    deps.db,
    user.id,
    new Date(now.getTime() - CORRECTION_WINDOW_MS),
  );
  const recentContext: RecentEntry[] = recent.map((entry) => ({
    amount: centsToAmount(entry.amountCents),
    payment_method: entry.paymentMethod,
    direction: entry.direction,
    minutes_ago: Math.max(0, Math.round((now.getTime() - entry.createdAt.getTime()) / 60_000)),
  }));
  const pendingClose = closeForReply(closes, receivedAt);

  const result = await deps.ai.interpretText(text, {
    now: receivedAt,
    closePending: pendingClose !== null,
    recentEntries: recentContext,
  });
  await saveAiResult(deps.db, message.id, 'interpret_text', result);
  if (!result.ok) throw aiFailure(result.error);
  const interpretation = result.value;

  switch (interpretation.intent) {
    case 'record':
      return {
        kind: 'done',
        status: await recordOperations(work, text, source, interpretation.operations, closes),
      };
    case 'correct':
      return {
        kind: 'done',
        status: await applyCorrection(work, text, source, interpretation.correction, recent, now),
      };
    case 'close_reply': {
      if (!pendingClose) return { kind: 'done', status: await nothing(work) };
      return {
        kind: 'handoff',
        handoff: {
          kind: 'close_reply',
          interpretation,
          close: {
            businessDay: pendingClose.businessDay,
            timing: closeReplyTiming(pendingClose.businessDay, receivedAt),
            via: 'intent',
          },
        },
      };
    }
    case 'close_now':
    case 'request':
    case 'danger':
      return { kind: 'handoff', handoff: { kind: interpretation.intent, interpretation } };
    default:
      return { kind: 'done', status: await nothing(work) };
  }
}

function nothing(work: MessageWork): Promise<TerminalStatus> {
  return commitMessage(work.deps.db, work.message.id, async () => 'non_financial');
}

// ---------------------------------------------------------------------------
// record
// ---------------------------------------------------------------------------

/** D58: a single sale or payment by message without method is cash. */
function singleMethod(op: TextOperation): PaymentMethod {
  return op.payment_method === 'unknown' ? 'cash' : op.payment_method;
}

function totalMethod(op: TextOperation): DeclaredTotalMethod {
  return op.payment_method === 'cash' ? 'cash' : op.payment_method;
}

async function recordOperations(
  work: MessageWork,
  text: string,
  source: TextSource,
  operations: readonly TextOperation[],
  closes: readonly CloseInfo[],
): Promise<TerminalStatus> {
  const { deps, message, user } = work;
  const attribution = entryAttribution(message.receivedAt, null, closes);
  const businessDay = attribution.businessDay;
  const rules = await loadCounterpartyRules(deps.db, user.id);
  const quote = quoteOf(text);
  const receivedAtIso = message.receivedAt.toISOString();

  return commitMessage(deps.db, message.id, async (tx) => {
    const unreadable = async (detail: ClarificationDetail): Promise<TerminalStatus> => {
      await createClarification(tx, {
        userId: user.id,
        businessDay,
        type: 'unreadable',
        inboundMessageId: message.id,
        detail: { quote, at: receivedAtIso, ...detail },
      });
      return 'unreadable';
    };

    // «vendí» / «me yapearon» with nothing to record: ask, never guess.
    if (operations.length === 0) return unreadable({ direction: 'in', paymentMethod: 'cash' });

    const dayEntries = await liveEntriesOfDays(tx, user.id, [businessDay]);
    const linkedScreenshots = new Set<string>();
    const statuses: TerminalStatus[] = [];

    for (const op of operations) {
      const amount = confidentTextAmount(op);
      const amountCents = amount === null ? null : amountToCents(amount);
      const isTotal = op.scope !== 'single' && op.direction !== 'out';

      if (amountCents === null) {
        statuses.push(
          await unreadable({
            direction: op.direction ?? 'in',
            paymentMethod: isTotal ? op.payment_method : singleMethod(op),
          }),
        );
        continue;
      }

      if (isTotal) {
        statuses.push(
          await recordDeclaredTotal(tx, work, {
            amountCents,
            method: totalMethod(op),
            businessDay,
            afterClose: attribution.afterClose,
            source,
            quote,
            dayEntries,
          }),
        );
        continue;
      }

      const paymentMethod = singleMethod(op);
      const directionDoubt = op.direction === null;
      const direction: Direction = op.direction ?? 'in';

      // 11.4: «me yapearon 20 de Rosa» when the screenshot is already there.
      if (!directionDoubt && isDigitalMethod(paymentMethod)) {
        const screenshot = findScreenshotForMention(
          {
            amountCents,
            direction,
            paymentMethod,
            counterpartyName: op.counterparty_name,
            businessDay,
            at: message.receivedAt,
          },
          dayEntries,
          linkedScreenshots,
        );
        if (screenshot) {
          linkedScreenshots.add(screenshot.id);
          statuses.push('duplicate');
          continue;
        }
      }

      const counterpartyNormalized = normalizeName(op.counterparty_name) || null;
      const category = directionDoubt
        ? { category: 'sale' as Category, needsCategoryDoubt: false }
        : decideCategory({
            direction,
            counterpartyNormalized,
            stated: op.suggested_category,
            rules,
          });
      const entry = await createEntry(
        tx,
        {
          userId: user.id,
          businessDay,
          amountCents,
          direction,
          paymentMethod,
          category: category.category,
          label: 'self_reported',
          status: directionDoubt ? 'pending' : 'confirmed',
          source,
          inboundMessageId: message.id,
          counterparty: op.counterparty_name,
          afterClose: attribution.afterClose,
        },
        PIPELINE_ACTOR,
        `whatsapp_${source}`,
      );
      dayEntries.push(entry);
      if (directionDoubt || category.needsCategoryDoubt) {
        await createClarification(tx, {
          userId: user.id,
          businessDay,
          type: directionDoubt ? 'direction' : 'category',
          ledgerEntryId: entry.id,
          inboundMessageId: message.id,
          detail: { quote },
        });
      }
      statuses.push(directionDoubt ? 'pending' : 'recorded');
    }
    return combineStatuses(statuses);
  });
}

/** 11.5: a declared total is never added on top (D03). */
async function recordDeclaredTotal(
  tx: Tx,
  work: MessageWork,
  input: {
    amountCents: number;
    method: DeclaredTotalMethod;
    businessDay: IsoDate;
    afterClose: boolean;
    source: TextSource;
    quote: string;
    dayEntries: LedgerEntry[];
  },
): Promise<TerminalStatus> {
  const { message, user } = work;
  const outcome = evaluateDeclaredTotal(
    { amountCents: input.amountCents, method: input.method },
    input.dayEntries,
  );
  const doubt = (detail: ClarificationDetail) =>
    createClarification(tx, {
      userId: user.id,
      businessDay: input.businessDay,
      type: 'ambiguous_total',
      inboundMessageId: message.id,
      detail: { quote: input.quote, declaredTotalCents: input.amountCents, ...detail },
    });

  switch (outcome.kind) {
    case 'ambiguous_total':
      // Case 10: «hoy vendí 150» → «¿Es todo el día o solo efectivo?».
      await doubt({ variant: 'no_method' });
      return 'pending';
    case 'cash_total_below_recorded':
      // Case 12: «Anotaste S/A en efectivo pero dijiste S/T. ¿Cuál es correcto?».
      await doubt({ variant: 'cash_below_recorded', recordedCents: outcome.recordedCents });
      return 'pending';
    case 'record_unitemized': {
      // PR09, case 11: the difference as an unitemized cash sale; the close mentions it.
      const entry = await createEntry(
        tx,
        {
          userId: user.id,
          businessDay: input.businessDay,
          amountCents: outcome.amountCents,
          direction: 'in',
          paymentMethod: outcome.paymentMethod,
          category: 'sale',
          label: 'unitemized',
          source: input.source,
          inboundMessageId: message.id,
          afterClose: input.afterClose,
        },
        PIPELINE_ACTOR,
        'declared_cash_total',
      );
      input.dayEntries.push(entry);
      return 'recorded';
    }
    default:
      // Matches what is recorded, or a digital total: the evidence wins. A digital shortfall is
      // a close notice (D40), computed by Fase 5 from the interpretation stored in `extractions`.
      return 'recorded';
  }
}

// ---------------------------------------------------------------------------
// correct (case 13)
// ---------------------------------------------------------------------------

function correctionCategory(
  correction: Correction,
  target: LedgerEntry,
  direction: Direction,
): Category | undefined {
  const stated = correction.suggested_category;
  if (stated && isCategoryValidFor(stated, direction)) return stated;
  if (direction === target.direction) return undefined;
  return direction === 'in' ? 'sale' : 'unclassified';
}

async function applyCorrection(
  work: MessageWork,
  text: string,
  source: TextSource,
  correction: Correction | null,
  recent: readonly LedgerEntry[],
  now: Date,
): Promise<TerminalStatus> {
  const { deps, message, user } = work;
  const target = findCorrectionTarget(recent, now);
  const quote = quoteOf(text);

  return commitMessage(deps.db, message.id, async (tx) => {
    if (target.kind === 'none') return 'non_financial';

    const askAbout = async (entry: LedgerEntry): Promise<TerminalStatus> => {
      // Decision: the closest of the 7 types; resolving it («¿Por cuánto?») replaces that entry.
      await createClarification(tx, {
        userId: user.id,
        businessDay: entry.businessDay,
        type: 'unreadable',
        ledgerEntryId: entry.id,
        inboundMessageId: message.id,
        detail: {
          quote,
          direction: entry.direction,
          paymentMethod: entry.paymentMethod,
          at: message.receivedAt.toISOString(),
        },
      });
      return 'pending';
    };

    if (target.kind === 'ambiguous') {
      // Several entries came from her last message: ask instead of guessing.
      const candidates = recent.filter((entry) => target.entryIds.includes(entry.id));
      const latest = candidates[candidates.length - 1] ?? candidates[0];
      if (!latest) return 'non_financial';
      return askAbout(latest);
    }

    const entry = recent.find((candidate) => candidate.id === target.entryId);
    if (!entry || !correction) return entry ? askAbout(entry) : 'non_financial';

    if (correction.void) {
      await voidEntry(tx, {
        userId: user.id,
        entryId: entry.id,
        actor: WHATSAPP_USER_ACTOR,
        now,
        reason: 'message_correction',
      });
      return 'recorded';
    }

    const amountCents =
      correction.amount === null ? undefined : (amountToCents(correction.amount) ?? undefined);
    const direction = correction.direction ?? entry.direction;
    const patch = {
      ...(amountCents !== undefined && amountCents !== entry.amountCents ? { amountCents } : {}),
      ...(correction.payment_method && correction.payment_method !== entry.paymentMethod
        ? { paymentMethod: correction.payment_method }
        : {}),
      ...(direction !== entry.direction ? { direction } : {}),
    };
    const category = correctionCategory(correction, entry, direction);
    const fullPatch = category && category !== entry.category ? { ...patch, category } : patch;
    if (Object.keys(fullPatch).length === 0) return askAbout(entry);

    const { entry: corrected } = await correctEntry(tx, {
      userId: user.id,
      entryId: entry.id,
      patch: fullPatch,
      actor: WHATSAPP_USER_ACTOR,
      now,
      reason: 'message_correction',
      origin: { source, inboundMessageId: message.id },
    });
    // It became an outgoing payment without type: PR15 doubt (a doubt already open on the old
    // row moved to the new one with the correction).
    if (direction !== entry.direction && corrected.category === 'unclassified') {
      await createClarification(tx, {
        userId: user.id,
        businessDay: corrected.businessDay,
        type: 'category',
        ledgerEntryId: corrected.id,
        inboundMessageId: message.id,
      });
    }
    return 'recorded';
  });
}
