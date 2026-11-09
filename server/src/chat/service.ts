/**
 * Web chat (RF-CH-01..05, HU-13, 4.6): one turn = her message → (approved answer | model with
 * read-only tools) → reviewed reply, plus at most one proposed change she confirms with her PIN.
 *
 * - PR06: 30 messages of hers per business day; past that, a friendly limit and no model call.
 * - A turn whose model call fails on every route is not stored and does not count: she gets
 *   «No pude responder ahora» and can try again.
 * - Logs carry ids, tool names and flags only, never her words or amounts (RNF-09).
 */
import { and, asc, count, desc, eq, gte } from 'drizzle-orm';
import type { AiLayer } from '../ai/index.js';
import type { Db } from '../db/client.js';
import { type ChatMessage, type ChatRole, chatMessages } from '../db/schema.js';
import { businessDayOf, businessDayStart } from '../domain/index.js';
import type { Logger } from '../lib/logger.js';
import { asksForChange, isCreditQuestion, reviewReply } from './guards.js';
import {
  cancelProposal,
  confirmProposal,
  createProposal,
  listProposals,
  type ProposalDraft,
  type ProposalView,
  toProposalView,
} from './proposals.js';
import { CHAT_DAILY_LIMIT, CHAT_SUGGESTIONS, CHAT_TEXTS } from './texts.js';
import { createChatToolbox } from './tools.js';

/**
 * Messages of today the model sees as context (oldest first): the last 2 exchanges, each cut
 * short — enough for «¿y ayer?». History is re-sent on every model step of the turn.
 */
const HISTORY_FOR_MODEL = 4;
const HISTORY_CHARS_FOR_MODEL = 300;
/** Messages the chat screen shows. */
const HISTORY_FOR_SCREEN = 60;

export interface ChatDeps {
  db: Db;
  /** Null when no AI is configured: every turn that needs a model answers «no pude responder». */
  ai: Pick<AiLayer, 'chat'> | null;
  logger?: Logger;
}

export interface ChatMessageView {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  /** The change proposed with this reply, if any. */
  proposal: ProposalView | null;
}

export interface ChatLimitView {
  used: number;
  max: number;
  remaining: number;
  reached: boolean;
}

export type SendResult =
  | {
      ok: true;
      message: ChatMessageView;
      reply: ChatMessageView;
      proposedAction: ProposalView | null;
      limit: ChatLimitView;
    }
  | { ok: false; code: 'limit'; message: string; limit: ChatLimitView }
  | { ok: false; code: 'unavailable' | 'busy'; message: string };

/** One turn per user at a time (one instance, like the auth rate limits). */
const inFlight = new Set<string>();

function limitView(used: number): ChatLimitView {
  const remaining = Math.max(0, CHAT_DAILY_LIMIT - used);
  return { used, max: CHAT_DAILY_LIMIT, remaining, reached: remaining === 0 };
}

async function usedToday(db: Db, userId: string, now: Date): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.userId, userId),
        eq(chatMessages.role, 'user'),
        gte(chatMessages.createdAt, businessDayStart(businessDayOf(now))),
      ),
    );
  return row?.n ?? 0;
}

async function historyForModel(db: Db, userId: string, now: Date) {
  const rows = await db
    .select({ role: chatMessages.role, content: chatMessages.content })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.userId, userId),
        gte(chatMessages.createdAt, businessDayStart(businessDayOf(now))),
      ),
    )
    .orderBy(desc(chatMessages.createdAt))
    .limit(HISTORY_FOR_MODEL);
  return rows.reverse().map((row) => ({
    role: row.role,
    content:
      row.content.length > HISTORY_CHARS_FOR_MODEL
        ? `${row.content.slice(0, HISTORY_CHARS_FOR_MODEL)}…`
        : row.content,
  }));
}

function messageView(row: ChatMessage, proposal: ProposalView | null = null): ChatMessageView {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    proposal,
  };
}

async function insertMessage(
  db: Pick<Db, 'insert'>,
  userId: string,
  role: ChatRole,
  content: string,
  at: Date,
): Promise<ChatMessage> {
  const [row] = await db
    .insert(chatMessages)
    .values({ userId, role, content, createdAt: at })
    .returning();
  if (!row) throw new Error('insert returned no row');
  return row;
}

export async function sendChatMessage(
  deps: ChatDeps,
  input: { userId: string; message: string; now: () => Date },
): Promise<SendResult> {
  const { db, logger } = deps;
  const { userId } = input;
  if (inFlight.has(userId)) return { ok: false, code: 'busy', message: CHAT_TEXTS.busy };
  inFlight.add(userId);
  try {
    const at = input.now();
    const used = await usedToday(db, userId, at);
    if (used >= CHAT_DAILY_LIMIT) {
      return { ok: false, code: 'limit', message: CHAT_TEXTS.limit, limit: limitView(used) };
    }

    let reply: string;
    let proposal: ProposalDraft | null = null;
    if (isCreditQuestion(input.message)) {
      // RF-CH-02 / HU-13: the approved answer, no model involved.
      reply = CHAT_TEXTS.credit;
      logger?.info({ userId, answer: 'credit_text' }, 'chat turn');
    } else {
      if (!deps.ai) return { ok: false, code: 'unavailable', message: CHAT_TEXTS.unavailable };
      const result = await deps.ai.chat({
        message: input.message,
        history: await historyForModel(db, userId, at),
        tools: createChatToolbox({ db, userId, now: at, message: input.message }),
        creditAnswer: CHAT_TEXTS.credit,
        allowChanges: asksForChange(input.message),
        now: at,
      });
      if (!result.ok) {
        logger?.warn(
          { userId, error: result.error, attempts: result.attempts },
          'chat turn failed',
        );
        return { ok: false, code: 'unavailable', message: CHAT_TEXTS.unavailable };
      }
      proposal = result.value.tools.proposal;
      const review = reviewReply(result.value.text, { hasProposal: proposal !== null });
      reply = review.text;
      logger?.info(
        {
          userId,
          routeId: result.meta.routeId,
          latencyMs: result.meta.latencyMs,
          steps: result.value.usage.steps,
          tokensIn: result.value.usage.inputTokens,
          tokensOut: result.value.usage.outputTokens,
          tokensCached: result.value.usage.cachedInputTokens,
          tools: result.value.toolCalls,
          refusals: result.value.tools.refusals,
          toolFailures: result.value.tools.failures,
          proposal: proposal?.type ?? null,
          flags: review.flags,
        },
        'chat turn',
      );
    }

    const assistantAt = new Date(Math.max(input.now().getTime(), at.getTime() + 1));
    const stored = await db.transaction(async (tx) => {
      const mine = await insertMessage(tx, userId, 'user', input.message, at);
      const theirs = await insertMessage(tx, userId, 'assistant', reply, assistantAt);
      const action = proposal ? await createProposal(tx, userId, proposal, assistantAt) : null;
      return { mine, theirs, action };
    });
    const proposedAction = stored.action ? toProposalView(stored.action) : null;
    return {
      ok: true,
      message: messageView(stored.mine),
      reply: messageView(stored.theirs, proposedAction),
      proposedAction,
      limit: limitView(used + 1),
    };
  } finally {
    inFlight.delete(userId);
  }
}

export interface ChatHistoryView {
  messages: ChatMessageView[];
  limit: ChatLimitView;
  suggestions: readonly string[];
}

/** The chat screen: the latest messages, each reply with the change it proposed. */
export async function getChatHistory(db: Db, userId: string, now: Date): Promise<ChatHistoryView> {
  const [rows, proposals, used] = await Promise.all([
    db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.userId, userId))
      .orderBy(desc(chatMessages.createdAt))
      .limit(HISTORY_FOR_SCREEN),
    listProposals(db, userId, HISTORY_FOR_SCREEN),
    usedToday(db, userId, now),
  ]);
  const byTime = new Map(proposals.map((p) => [p.createdAt.getTime(), toProposalView(p)]));
  const ordered = rows.sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() ||
      (a.role === b.role ? 0 : a.role === 'user' ? -1 : 1),
  );
  const attach = (row: ChatMessage): ProposalView | null => {
    if (row.role !== 'assistant') return null;
    const proposal = byTime.get(row.createdAt.getTime()) ?? null;
    byTime.delete(row.createdAt.getTime());
    return proposal;
  };
  return {
    messages: ordered.map((row) => messageView(row, attach(row))),
    limit: limitView(used),
    suggestions: CHAT_SUGGESTIONS,
  };
}

export type AnswerResult =
  | { ok: true; proposal: ProposalView; reply: ChatMessageView }
  | { ok: false; code: 'not_found' }
  | { ok: false; code: 'not_open' | 'stale'; proposal: ProposalView; message: string };

/** «Confirmar» or «Cancelar» on a proposal card; the outcome is also said in the chat. */
export async function answerProposal(
  deps: Pick<ChatDeps, 'db' | 'logger'>,
  input: { userId: string; actionId: string; answer: 'confirm' | 'cancel'; now: Date },
): Promise<AnswerResult> {
  const { db } = deps;
  const outcome =
    input.answer === 'confirm'
      ? await confirmProposal(db, input)
      : await cancelProposal(db, { userId: input.userId, actionId: input.actionId });
  if (!outcome.ok) {
    if (outcome.code === 'not_found') return outcome;
    const proposal = toProposalView(outcome.action);
    const message =
      outcome.code === 'stale' ? CHAT_TEXTS.stale : (proposal.resultText ?? CHAT_TEXTS.stale);
    return { ok: false, code: outcome.code, proposal, message };
  }
  deps.logger?.info(
    { userId: input.userId, actionId: input.actionId, answer: input.answer },
    'chat proposal answered',
  );
  const reply = await insertMessage(db, input.userId, 'assistant', outcome.text, input.now);
  return { ok: true, proposal: toProposalView(outcome.action), reply: messageView(reply) };
}

/** Oldest first, for tests and the admin panel later. */
export async function listChatMessages(db: Db, userId: string): Promise<ChatMessage[]> {
  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.userId, userId))
    .orderBy(asc(chatMessages.createdAt));
}
