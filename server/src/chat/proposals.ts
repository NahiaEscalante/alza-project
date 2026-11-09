/**
 * Changes proposed by the chat (RF-CH-03, 14.5, PR13). The model can only fill a draft: the draft
 * becomes a `proposed_actions` row with «antes y después», and nothing changes until she taps
 * «Confirmar» and gives her PIN. Confirming applies the change through the ledger service with
 * actor `user:chat` and reason `chat_action:<id>`, so the traceability annex shows where it came
 * from (RF-LB-02).
 *
 * `proposed_actions.before` / `.after` keep the cards she saw plus what confirming runs (`apply`).
 */
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  type Category,
  type Direction,
  type LedgerEntry,
  type PaymentMethod,
  type ProposedAction,
  type ProposedActionStatus,
  proposedActions,
} from '../db/schema.js';
import { formatSoles, type IsoDate } from '../domain/index.js';
import {
  type Actor,
  addPastDayEntry,
  CATEGORY_TEXT,
  type ClarificationResolution,
  correctEntry,
  DIRECTION_TEXT,
  dayLabel,
  type EntryView,
  LABEL_TEXT,
  LedgerError,
  METHOD_TEXT,
  resolveClarification,
  type Tx,
  toEntryView,
  voidEntry,
} from '../ledger/index.js';
import { CHAT_TEXTS } from './texts.js';

export const PROPOSAL_TYPES = [
  'correct_amount',
  'change_category',
  'void_entry',
  'add_past_entry',
  'resolve_clarification',
] as const;
export type ProposalType = (typeof PROPOSAL_TYPES)[number];

/** A proposal can be confirmed for this long (and only while it is the latest one). */
export const PROPOSAL_TTL_MS = 24 * 60 * 60_000;

export const CHAT_ACTOR: Actor = { kind: 'user', channel: 'chat' };

/** A record as she sees it on the card (12.2 Chat). */
export interface EntryCard {
  businessDay: IsoDate;
  /** «jueves 12». */
  dayLabel: string;
  time: string | null;
  direction: Direction;
  directionText: string;
  paymentMethod: PaymentMethod;
  methodText: string;
  counterparty: string | null;
  amountCents: number;
  category: Category;
  categoryText: string;
  labelText: string;
  countsInTotals: boolean;
}

export function entryCard(view: EntryView): EntryCard {
  return {
    businessDay: view.businessDay,
    dayLabel: dayLabel(view.businessDay),
    time: view.time,
    direction: view.direction,
    directionText: view.directionText,
    paymentMethod: view.paymentMethod,
    methodText: view.paymentMethodText,
    counterparty: view.counterparty,
    amountCents: view.amountCents,
    category: view.category,
    categoryText: view.categoryText,
    labelText: view.labelText,
    countsInTotals: view.countsInTotals,
  };
}

/** What confirming runs. */
export type ApplyParams =
  | { kind: 'correct'; entryId: string; patch: { amountCents?: number; category?: Category } }
  | { kind: 'void'; entryId: string }
  | {
      kind: 'add';
      businessDay: IsoDate;
      amountCents: number;
      direction: Direction;
      paymentMethod: PaymentMethod;
      category: Category;
      counterparty: string | null;
    }
  | { kind: 'resolve'; clarificationId: string; resolution: ClarificationResolution };

/** `proposed_actions.before`. */
export interface ProposalBefore {
  entry: EntryCard | null;
  /** resolve_clarification: the question of the doubt. */
  question: string | null;
}

/** `proposed_actions.after`. */
export interface ProposalAfter {
  apply: ApplyParams;
  /** The record after the change (null when it stops existing or for a doubt). */
  entry: EntryCard | null;
  /** «no cuenta (personal)», «se quita: ya no cuenta», «Tu respuesta: Sí, fueron dos». */
  text: string;
  /** Set when confirmed. */
  result?: { entryId: string | null; outcome: string; at: string };
}

/** What the tool session collects; `createProposal` stores it. */
export interface ProposalDraft {
  type: ProposalType;
  before: ProposalBefore;
  after: ProposalAfter;
}

// ---------------------------------------------------------------------------
// Drafts (pure): built by the tools from records already filtered by her session
// ---------------------------------------------------------------------------

function categoryAfterText(category: Category): string {
  if (category === 'personal') return 'no cuenta (personal)';
  if (category === 'internal') return 'no cuenta (movimiento interno)';
  return `pasa a ${CATEGORY_TEXT[category].toLowerCase()}`;
}

export function correctAmountDraft(entry: LedgerEntry, amountCents: number): ProposalDraft {
  const before = entryCard(toEntryView(entry));
  return {
    type: 'correct_amount',
    before: { entry: before, question: null },
    after: {
      apply: { kind: 'correct', entryId: entry.id, patch: { amountCents } },
      entry: { ...before, amountCents, labelText: LABEL_TEXT.self_reported },
      text: `queda como «${LABEL_TEXT.self_reported}»`,
    },
  };
}

export function changeCategoryDraft(entry: LedgerEntry, category: Category): ProposalDraft {
  const before = entryCard(toEntryView(entry));
  const counts = category !== 'personal' && category !== 'internal';
  return {
    type: 'change_category',
    before: { entry: before, question: null },
    after: {
      apply: { kind: 'correct', entryId: entry.id, patch: { category } },
      entry: {
        ...before,
        category,
        categoryText: CATEGORY_TEXT[category],
        labelText: LABEL_TEXT.self_reported,
        countsInTotals: counts && entry.status === 'confirmed',
      },
      text: categoryAfterText(category),
    },
  };
}

export function voidDraft(entry: LedgerEntry): ProposalDraft {
  return {
    type: 'void_entry',
    before: { entry: entryCard(toEntryView(entry)), question: null },
    after: {
      apply: { kind: 'void', entryId: entry.id },
      entry: null,
      text: 'se quita: ya no cuenta (queda guardado en su historial)',
    },
  };
}

export function addPastEntryDraft(input: {
  businessDay: IsoDate;
  amountCents: number;
  direction: Direction;
  paymentMethod: PaymentMethod;
  category: Category;
  counterparty: string | null;
}): ProposalDraft {
  return {
    type: 'add_past_entry',
    before: { entry: null, question: null },
    after: {
      apply: { kind: 'add', ...input },
      entry: {
        businessDay: input.businessDay,
        dayLabel: dayLabel(input.businessDay),
        time: null,
        direction: input.direction,
        directionText: DIRECTION_TEXT[input.direction],
        paymentMethod: input.paymentMethod,
        methodText: METHOD_TEXT[input.paymentMethod],
        counterparty: input.counterparty,
        amountCents: input.amountCents,
        category: input.category,
        categoryText: CATEGORY_TEXT[input.category],
        labelText: LABEL_TEXT.self_reported,
        countsInTotals: input.category !== 'personal' && input.category !== 'internal',
      },
      text: `se agrega como «${LABEL_TEXT.self_reported}»`,
    },
  };
}

export function resolveDraft(input: {
  clarificationId: string;
  question: string;
  entry: EntryView | null;
  optionLabel: string;
  resolution: ClarificationResolution;
}): ProposalDraft {
  const r = input.resolution;
  const detail =
    r.action === 'set_amount'
      ? ` (${formatSoles(r.amountCents)})`
      : r.action === 'set_day'
        ? ` (${dayLabel(r.businessDay)})`
        : '';
  return {
    type: 'resolve_clarification',
    before: { entry: input.entry ? entryCard(input.entry) : null, question: input.question },
    after: {
      apply: { kind: 'resolve', clarificationId: input.clarificationId, resolution: r },
      entry: null,
      text: `tu respuesta: ${input.optionLabel}${detail}`,
    },
  };
}

// ---------------------------------------------------------------------------
// Storage and view
// ---------------------------------------------------------------------------

export interface ProposalView {
  id: string;
  type: ProposalType;
  status: ProposedActionStatus;
  createdAt: string;
  /** «Encontré este registro:» (12.2). */
  intro: string;
  before: EntryCard | null;
  question: string | null;
  after: { entry: EntryCard | null; text: string };
  /** Once answered: «Listo. Ese registro ya no cuenta (personal).» */
  resultText: string | null;
}

const INTRO: Record<ProposalType, string> = {
  correct_amount: 'Encontré este registro:',
  change_category: 'Encontré este registro:',
  void_entry: 'Encontré este registro:',
  add_past_entry: 'Esto es lo que agregaría:',
  resolve_clarification: 'Sobre esta duda:',
};

export function confirmedText(type: ProposalType, after: ProposalAfter): string {
  const apply = after.apply;
  switch (type) {
    case 'correct_amount':
      return apply.kind === 'correct' && apply.patch.amountCents !== undefined
        ? `Listo. Ese registro ahora es de ${formatSoles(apply.patch.amountCents)}.`
        : 'Listo. Corregí ese registro.';
    case 'change_category':
      if (apply.kind === 'correct' && apply.patch.category === 'personal') {
        return 'Listo. Ese registro ya no cuenta (personal).';
      }
      if (apply.kind === 'correct' && apply.patch.category === 'internal') {
        return 'Listo. Ese registro ya no cuenta (movimiento interno).';
      }
      return apply.kind === 'correct' && apply.patch.category
        ? `Listo. Ese registro ahora es ${CATEGORY_TEXT[apply.patch.category].toLowerCase()}.`
        : 'Listo. Cambié el tipo de ese registro.';
    case 'void_entry':
      return 'Listo. Quité ese registro; queda guardado en su historial.';
    case 'add_past_entry':
      return apply.kind === 'add'
        ? `Listo. Lo agregué al ${dayLabel(apply.businessDay)}.`
        : 'Listo. Lo agregué.';
    case 'resolve_clarification':
      return 'Listo. Respondí esa duda.';
  }
}

export function toProposalView(row: ProposedAction): ProposalView {
  const type = row.type as ProposalType;
  const before = (row.before ?? { entry: null, question: null }) as ProposalBefore;
  const after = row.after as ProposalAfter;
  const resultText =
    row.status === 'confirmed'
      ? confirmedText(type, after)
      : row.status === 'rejected'
        ? CHAT_TEXTS.cancelled
        : row.status === 'expired'
          ? 'Este cambio ya no está vigente.'
          : null;
  return {
    id: row.id,
    type,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    intro: INTRO[type] ?? 'Encontré este registro:',
    before: before.entry,
    question: before.question,
    after: { entry: after.entry, text: after.text },
    resultText,
  };
}

/** Stores a draft as the only open proposal of her chat (older open ones expire). */
export async function createProposal(
  tx: Tx,
  userId: string,
  draft: ProposalDraft,
  at: Date,
): Promise<ProposedAction> {
  await tx
    .update(proposedActions)
    .set({ status: 'expired' })
    .where(and(eq(proposedActions.userId, userId), eq(proposedActions.status, 'proposed')));
  const [row] = await tx
    .insert(proposedActions)
    .values({
      userId,
      type: draft.type,
      before: draft.before,
      after: draft.after,
      status: 'proposed',
      createdAt: at,
    })
    .returning();
  if (!row) throw new Error('insert returned no row');
  return row;
}

export type AnswerOutcome =
  | { ok: true; action: ProposedAction; text: string; entry: LedgerEntry | null }
  | { ok: false; code: 'not_found' }
  | { ok: false; code: 'not_open'; action: ProposedAction }
  | { ok: false; code: 'stale'; action: ProposedAction };

async function lockAction(tx: Tx, userId: string, id: string): Promise<ProposedAction | null> {
  const [row] = await tx
    .select()
    .from(proposedActions)
    .where(and(eq(proposedActions.id, id), eq(proposedActions.userId, userId)))
    .for('update');
  return row ?? null;
}

async function setStatus(
  tx: Tx,
  row: ProposedAction,
  status: ProposedActionStatus,
  after?: ProposalAfter,
): Promise<ProposedAction> {
  const [updated] = await tx
    .update(proposedActions)
    .set({ status, ...(after ? { after } : {}) })
    .where(eq(proposedActions.id, row.id))
    .returning();
  return updated ?? row;
}

async function apply(
  tx: Tx,
  userId: string,
  actionId: string,
  params: ApplyParams,
  now: Date,
): Promise<{ entry: LedgerEntry | null; outcome: string }> {
  const reason = `chat_action:${actionId}`;
  switch (params.kind) {
    case 'correct': {
      const { entry } = await correctEntry(tx, {
        userId,
        entryId: params.entryId,
        patch: params.patch,
        actor: CHAT_ACTOR,
        now,
        reason,
      });
      return { entry, outcome: 'replaced' };
    }
    case 'void': {
      const entry = await voidEntry(tx, {
        userId,
        entryId: params.entryId,
        actor: CHAT_ACTOR,
        now,
        reason,
      });
      return { entry, outcome: 'voided' };
    }
    case 'add': {
      const entry = await addPastDayEntry(tx, {
        userId,
        businessDay: params.businessDay,
        amountCents: params.amountCents,
        direction: params.direction,
        paymentMethod: params.paymentMethod,
        category: params.category,
        counterparty: params.counterparty,
        actor: CHAT_ACTOR,
        now,
        reason,
      });
      return { entry, outcome: 'added' };
    }
    case 'resolve': {
      const result = await resolveClarification(tx, {
        userId,
        clarificationId: params.clarificationId,
        resolution: params.resolution,
        actor: CHAT_ACTOR,
        now,
      });
      return { entry: result.entry, outcome: result.outcome };
    }
  }
}

/**
 * «Confirmar» (🔒 in the route): applies the change through the ledger service in the same
 * transaction that marks the proposal `confirmed`. A proposal that is old, replaced by a newer
 * one, or whose record already changed becomes `expired` and nothing is applied.
 */
export async function confirmProposal(
  db: Db,
  input: { userId: string; actionId: string; now: Date },
): Promise<AnswerOutcome> {
  return db.transaction(async (tx): Promise<AnswerOutcome> => {
    const row = await lockAction(tx, input.userId, input.actionId);
    if (!row) return { ok: false, code: 'not_found' };
    if (row.status !== 'proposed') return { ok: false, code: 'not_open', action: row };
    const after = row.after as ProposalAfter;
    if (input.now.getTime() - row.createdAt.getTime() > PROPOSAL_TTL_MS) {
      return { ok: false, code: 'stale', action: await setStatus(tx, row, 'expired') };
    }
    let result: { entry: LedgerEntry | null; outcome: string };
    try {
      // A savepoint: a ledger refusal rolls back the change only, the proposal still expires.
      result = await tx.transaction((inner) =>
        apply(inner, input.userId, row.id, after.apply, input.now),
      );
    } catch (err) {
      if (!(err instanceof LedgerError)) throw err;
      return { ok: false, code: 'stale', action: await setStatus(tx, row, 'expired') };
    }
    const updated = await setStatus(tx, row, 'confirmed', {
      ...after,
      result: {
        entryId: result.entry?.id ?? null,
        outcome: result.outcome,
        at: input.now.toISOString(),
      },
    });
    return {
      ok: true,
      action: updated,
      text: confirmedText(row.type as ProposalType, after),
      entry: result.entry,
    };
  });
}

/** «Cancelar»: nothing changes; the proposal is `rejected`. */
export async function cancelProposal(
  db: Db,
  input: { userId: string; actionId: string },
): Promise<AnswerOutcome> {
  return db.transaction(async (tx): Promise<AnswerOutcome> => {
    const row = await lockAction(tx, input.userId, input.actionId);
    if (!row) return { ok: false, code: 'not_found' };
    if (row.status !== 'proposed') return { ok: false, code: 'not_open', action: row };
    const updated = await setStatus(tx, row, 'rejected');
    return { ok: true, action: updated, text: CHAT_TEXTS.cancelled, entry: null };
  });
}

export async function listProposals(db: Db, userId: string, limit: number) {
  return db
    .select()
    .from(proposedActions)
    .where(eq(proposedActions.userId, userId))
    .orderBy(desc(proposedActions.createdAt))
    .limit(limit);
}
