/**
 * The ledger writer (RF-LB-01, RF-LB-02, D16, D17). Every change to `ledger_entries` goes through
 * here: the web now, the WhatsApp pipeline (Fase 3) and the chat (Fase 8) later.
 *
 * - Append-only: a correction inserts a new row (`replaces_entry_id`) and the old one becomes
 *   `superseded`; removing makes it `voided`. Only `status` ever changes on an existing row.
 * - Every write runs in a transaction and adds `ledger_entry_events` rows (who and why).
 * - A web correction always ends as «Lo contaste tú» (D16, `correctedEntryFields`). Resolving a
 *   doubt that does not change the amount (direction, day, category) keeps the label: the amount
 *   still comes from the screenshot (11.3).
 * - Resolving doubts may raise the day's level (D17): before the points deadline the level itself,
 *   after it only `improved_level`.
 */
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import {
  type Category,
  type Clarification,
  type ClarificationType,
  clarifications,
  counterpartyRules,
  dailyCloses,
  type LedgerEntry,
  type LedgerEntryEvent,
  type LedgerEntrySource,
  type LedgerEntryStatus,
  type LedgerLabel,
  ledgerEntries,
  ledgerEntryEvents,
  type NewLedgerEntry,
} from '../db/schema.js';
import {
  businessDayOf,
  clarificationPriority,
  closeLevelAfterReply,
  correctedEntryFields,
  type IsoDate,
  improvedLevel,
  isBeforePointsDeadline,
  isBetterLevel,
  isCategoryValidFor,
  isIsoDate,
  isLive,
  isWebOnly,
  MAX_AMOUNT_CENTS,
  normalizeName,
  normalizeOperationNumber,
  outflowMemoryRule,
  resolveAmbiguousTotal,
} from '../domain/index.js';
import { LedgerError } from './errors.js';
import {
  type Actor,
  actorLabel,
  type ClarificationDetail,
  type DbOrTx,
  type Direction,
  type EntryOrigin,
  inTransaction,
  type PaymentMethod,
  resolvedStatusFor,
  type Tx,
} from './types.js';

const OPEN_CLARIFICATION_STATUSES = ['open', 'in_message', 'in_web'] as const;
const LIVE = ['confirmed', 'pending'] as const;

function assertAmount(cents: number): void {
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_AMOUNT_CENTS) {
    throw new LedgerError('invalid_amount');
  }
}

function assertCategory(category: Category, direction: Direction): void {
  if (!isCategoryValidFor(category, direction)) throw new LedgerError('invalid_category');
}

/** Source of rows written by the web or the chat. */
function defaultSource(actor: Actor): LedgerEntrySource {
  return actor.channel === 'chat' ? 'chat' : 'web';
}

async function lockEntry(tx: Tx, userId: string, entryId: string): Promise<LedgerEntry | null> {
  const [row] = await tx
    .select()
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.id, entryId), eq(ledgerEntries.userId, userId)))
    .for('update');
  return row ?? null;
}

async function addEvent(
  tx: Tx,
  ledgerEntryId: string,
  event: LedgerEntryEvent,
  actor: Actor,
  detail: Record<string, unknown>,
): Promise<void> {
  await tx.insert(ledgerEntryEvents).values({
    ledgerEntryId,
    event,
    actor: actorLabel(actor),
    detail,
  });
}

/** True when the day's close message already went out (PR03 «agregado después del cierre»). */
async function closeAlreadySent(tx: Tx, userId: string, day: IsoDate): Promise<boolean> {
  const [close] = await tx
    .select({ status: dailyCloses.status })
    .from(dailyCloses)
    .where(and(eq(dailyCloses.userId, userId), eq(dailyCloses.businessDay, day)));
  return close !== undefined && close.status !== 'open' && close.status !== 'no_activity';
}

/** PR14: when she classifies an outgoing payment, the next ones to that counterparty follow. */
async function rememberOutflowCategory(
  tx: Tx,
  userId: string,
  entry: Pick<LedgerEntry, 'direction' | 'counterpartyNormalized'>,
  category: Category,
  now: Date,
): Promise<void> {
  if (entry.direction !== 'out') return;
  const rule = outflowMemoryRule(entry.counterpartyNormalized, category);
  if (!rule) return;
  await tx
    .insert(counterpartyRules)
    .values({ userId, ...rule, active: true, updatedAt: now })
    .onConflictDoUpdate({
      target: [
        counterpartyRules.userId,
        counterpartyRules.counterpartyNormalized,
        counterpartyRules.direction,
      ],
      set: { category: rule.category, source: 'memory', active: true, updatedAt: now },
    });
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

export interface CreateEntryInput {
  userId: string;
  businessDay: IsoDate;
  amountCents: number;
  direction: Direction;
  paymentMethod: PaymentMethod;
  category: Category;
  label: LedgerLabel;
  /** Default `confirmed`. A pending entry needs a doubt (RF-LB-06). */
  status?: 'confirmed' | 'pending';
  source: LedgerEntrySource;
  inboundMessageId?: string | null;
  counterparty?: string | null;
  operationNumber?: string | null;
  operationAt?: Date | null;
  afterClose?: boolean;
}

/** Inserts a new live entry and its `created` event. */
export async function createEntry(
  db: DbOrTx,
  input: CreateEntryInput,
  actor: Actor,
  reason?: string,
): Promise<LedgerEntry> {
  assertAmount(input.amountCents);
  assertCategory(input.category, input.direction);
  if (!isIsoDate(input.businessDay)) throw new LedgerError('invalid_day');
  const counterparty = input.counterparty?.trim() || null;
  return inTransaction(db, async (tx) => {
    const [entry] = await tx
      .insert(ledgerEntries)
      .values({
        userId: input.userId,
        businessDay: input.businessDay,
        operationAt: input.operationAt ?? null,
        amountCents: input.amountCents,
        direction: input.direction,
        paymentMethod: input.paymentMethod,
        category: input.category,
        counterparty,
        counterpartyNormalized: counterparty ? normalizeName(counterparty) || null : null,
        operationNumber: normalizeOperationNumber(input.operationNumber),
        label: input.label,
        status: input.status ?? 'confirmed',
        source: input.source,
        inboundMessageId: input.inboundMessageId ?? null,
        createdBy: actor.kind,
        afterClose: input.afterClose ?? false,
      })
      .returning();
    if (!entry) throw new Error('insert returned no row');
    await addEvent(tx, entry.id, 'created', actor, {
      source: input.source,
      reason: reason ?? null,
    });
    return entry;
  });
}

type EntryChanges = Partial<
  Pick<LedgerEntry, 'amountCents' | 'category' | 'direction' | 'paymentMethod' | 'businessDay'>
>;

/**
 * Supersedes `old` with a new row carrying `changes`. `label: 'self_reported'` applies D16 through
 * the domain; `'keep'` keeps the old label; any other label is set as given.
 */
async function replaceEntry(
  tx: Tx,
  old: LedgerEntry,
  changes: EntryChanges,
  options: {
    label: LedgerLabel | 'keep';
    status: 'confirmed' | 'pending';
    origin: EntryOrigin;
    actor: Actor;
    reason: string | null;
  },
): Promise<LedgerEntry> {
  await tx.update(ledgerEntries).set({ status: 'superseded' }).where(eq(ledgerEntries.id, old.id));

  const fields =
    options.label === 'self_reported'
      ? correctedEntryFields(old, changes)
      : {
          ...old,
          ...changes,
          label: options.label === 'keep' ? old.label : options.label,
          replacesEntryId: old.id,
        };
  const values: NewLedgerEntry = {
    userId: old.userId,
    businessDay: fields.businessDay,
    operationAt: fields.operationAt,
    amountCents: fields.amountCents,
    direction: fields.direction,
    paymentMethod: fields.paymentMethod,
    category: fields.category,
    counterparty: fields.counterparty,
    counterpartyNormalized: fields.counterpartyNormalized,
    operationNumber: fields.operationNumber,
    label: fields.label,
    status: options.status,
    source: options.origin.source,
    inboundMessageId:
      options.origin.inboundMessageId === undefined
        ? old.inboundMessageId
        : options.origin.inboundMessageId,
    replacesEntryId: old.id,
    createdBy: options.actor.kind,
    afterClose: old.afterClose,
  };
  const [entry] = await tx.insert(ledgerEntries).values(values).returning();
  if (!entry) throw new Error('insert returned no row');

  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(changes) as (keyof EntryChanges)[]) {
    if (changes[key] !== undefined && changes[key] !== old[key]) {
      diff[key] = { from: old[key], to: changes[key] };
    }
  }
  if (entry.label !== old.label) diff.label = { from: old.label, to: entry.label };

  await addEvent(tx, old.id, 'superseded', options.actor, {
    replacedBy: entry.id,
    reason: options.reason,
  });
  await addEvent(tx, entry.id, 'created', options.actor, {
    replaces: old.id,
    source: options.origin.source,
    reason: options.reason,
    changes: diff,
  });

  // Doubts still open on the old row now point to the row that replaced it.
  await tx
    .update(clarifications)
    .set({ ledgerEntryId: entry.id })
    .where(
      and(
        eq(clarifications.ledgerEntryId, old.id),
        inArray(clarifications.status, OPEN_CLARIFICATION_STATUSES),
      ),
    );
  return entry;
}

async function setEntryStatus(
  tx: Tx,
  entry: LedgerEntry,
  status: LedgerEntryStatus,
  event: LedgerEntryEvent | null,
  actor: Actor,
  detail: Record<string, unknown>,
): Promise<LedgerEntry> {
  const [updated] = await tx
    .update(ledgerEntries)
    .set({ status })
    .where(eq(ledgerEntries.id, entry.id))
    .returning();
  if (!updated) throw new Error('update returned no row');
  if (event) await addEvent(tx, entry.id, event, actor, detail);
  return updated;
}

/** Resolves every open doubt on an entry that left the ledger; returns their business days. */
async function resolveDoubtsOfEntry(
  tx: Tx,
  entryId: string,
  actor: Actor,
  now: Date,
  action: string,
): Promise<IsoDate[]> {
  const rows = await tx
    .update(clarifications)
    .set({
      status: resolvedStatusFor(actor),
      answer: { action, resolvedAt: now.toISOString(), by: actorLabel(actor) },
    })
    .where(
      and(
        eq(clarifications.ledgerEntryId, entryId),
        inArray(clarifications.status, OPEN_CLARIFICATION_STATUSES),
      ),
    )
    .returning({ businessDay: clarifications.businessDay });
  return [...new Set(rows.map((row) => row.businessDay))];
}

export interface CorrectEntryInput {
  userId: string;
  entryId: string;
  patch: { amountCents?: number; category?: Category };
  actor: Actor;
  now: Date;
  reason?: string;
  /** Default: source `web` (or `chat`), keeping the old entry's message link. */
  origin?: EntryOrigin;
}

/** «Corregir monto» / «Cambiar tipo» (RF-WP-03, HU-11). The new row is «Lo contaste tú» (D16). */
export async function correctEntry(
  db: DbOrTx,
  input: CorrectEntryInput,
): Promise<{ entry: LedgerEntry; replaced: LedgerEntry }> {
  return inTransaction(db, async (tx) => {
    const old = await lockEntry(tx, input.userId, input.entryId);
    if (!old) throw new LedgerError('not_found');
    if (!isLive(old)) throw new LedgerError('not_live');

    const changes: EntryChanges = {};
    const { amountCents, category } = input.patch;
    if (amountCents !== undefined && amountCents !== old.amountCents) {
      assertAmount(amountCents);
      changes.amountCents = amountCents;
    }
    if (category !== undefined && category !== old.category) {
      assertCategory(category, old.direction);
      changes.category = category;
    }
    if (Object.keys(changes).length === 0) throw new LedgerError('no_changes');

    const entry = await replaceEntry(tx, old, changes, {
      label: 'self_reported',
      status: old.status as 'confirmed' | 'pending',
      origin: input.origin ?? { source: defaultSource(input.actor) },
      actor: input.actor,
      reason: input.reason ?? null,
    });

    if (changes.category) {
      // Choosing the type answers a «¿Fue mercadería o un gasto?» doubt on this entry.
      const resolved = await tx
        .update(clarifications)
        .set({
          status: resolvedStatusFor(input.actor),
          answer: {
            action: 'set_category',
            category: changes.category,
            via: 'correction',
            resolvedAt: input.now.toISOString(),
            by: actorLabel(input.actor),
          },
        })
        .where(
          and(
            eq(clarifications.ledgerEntryId, entry.id),
            eq(clarifications.type, 'category'),
            inArray(clarifications.status, OPEN_CLARIFICATION_STATUSES),
          ),
        )
        .returning({ businessDay: clarifications.businessDay });
      await rememberOutflowCategory(tx, input.userId, entry, changes.category, input.now);
      for (const day of new Set(resolved.map((row) => row.businessDay))) {
        await refreshDayLevel(tx, input.userId, day, input.now);
      }
    }
    return { entry, replaced: old };
  });
}

/** «Quitar» (RF-LB-01): the entry becomes `voided`; its open doubts are resolved. */
export async function voidEntry(
  db: DbOrTx,
  input: { userId: string; entryId: string; actor: Actor; now: Date; reason?: string },
): Promise<LedgerEntry> {
  return inTransaction(db, async (tx) => {
    const old = await lockEntry(tx, input.userId, input.entryId);
    if (!old) throw new LedgerError('not_found');
    if (!isLive(old)) throw new LedgerError('not_live');
    const entry = await setEntryStatus(tx, old, 'voided', 'voided', input.actor, {
      reason: input.reason ?? null,
    });
    const days = await resolveDoubtsOfEntry(tx, old.id, input.actor, input.now, 'entry_voided');
    for (const day of days) await refreshDayLevel(tx, input.userId, day, input.now);
    return entry;
  });
}

export interface AddPastDayEntryInput {
  userId: string;
  businessDay: IsoDate;
  amountCents: number;
  direction: Direction;
  paymentMethod: PaymentMethod;
  /** Incoming defaults to `sale` (D09); outgoing must say it. */
  category?: Category;
  counterparty?: string | null;
  actor: Actor;
  now: Date;
  reason?: string;
}

/** «Agregar algo que faltó» (D16): only on business days before today. «Lo contaste tú». */
export async function addPastDayEntry(
  db: DbOrTx,
  input: AddPastDayEntryInput,
): Promise<LedgerEntry> {
  if (!isIsoDate(input.businessDay) || input.businessDay >= businessDayOf(input.now)) {
    throw new LedgerError('invalid_day');
  }
  const category = input.category ?? (input.direction === 'in' ? 'sale' : null);
  if (category === null) throw new LedgerError('invalid_category');
  assertCategory(category, input.direction);

  return inTransaction(db, async (tx) => {
    const afterClose = await closeAlreadySent(tx, input.userId, input.businessDay);
    const entry = await createEntry(
      tx,
      {
        userId: input.userId,
        businessDay: input.businessDay,
        amountCents: input.amountCents,
        direction: input.direction,
        paymentMethod: input.paymentMethod,
        category,
        label: 'self_reported',
        source: defaultSource(input.actor),
        counterparty: input.counterparty ?? null,
        afterClose,
      },
      input.actor,
      input.reason ?? 'added_past_day',
    );
    await rememberOutflowCategory(tx, input.userId, entry, category, input.now);
    return entry;
  });
}

// ---------------------------------------------------------------------------
// Clarifications
// ---------------------------------------------------------------------------

export interface CreateClarificationInput {
  userId: string;
  businessDay: IsoDate;
  type: ClarificationType;
  ledgerEntryId?: string | null;
  inboundMessageId?: string | null;
  detail?: ClarificationDetail | null;
  /** Default `open`; web-only types (`missing_from_list`, D10) default to `in_web`. */
  status?: 'open' | 'in_web';
}

/** Creates a doubt with its 11.8 priority. */
export async function createClarification(
  db: DbOrTx,
  input: CreateClarificationInput,
): Promise<Clarification> {
  const [row] = await db
    .insert(clarifications)
    .values({
      userId: input.userId,
      businessDay: input.businessDay,
      type: input.type,
      ledgerEntryId: input.ledgerEntryId ?? null,
      inboundMessageId: input.inboundMessageId ?? null,
      priority: clarificationPriority(input.type),
      status: input.status ?? (isWebOnly(input.type) ? 'in_web' : 'open'),
      detail: input.detail ?? null,
    })
    .returning();
  if (!row) throw new Error('insert returned no row');
  return row;
}

/** Answers she can give in Pendientes, by doubt type (RF-WP-04, «resolubles con toques»). */
export type ClarificationResolution =
  /** possible_duplicate «Sí, fueron dos» · date «Sí, es de ese día». */
  | { action: 'confirm' }
  /** possible_duplicate «No, es el mismo». */
  | { action: 'mark_duplicate' }
  /** direction «Me pagaron» / «Pagué …». Outgoing needs a category. */
  | { action: 'set_direction'; direction: Direction; category?: Category }
  /** date «Es de otro día». */
  | { action: 'set_day'; businessDay: IsoDate }
  /** category «Mercadería» / «Gasto» / «Para la casa». */
  | { action: 'set_category'; category: Category }
  /** unreadable «¿De cuánto era?». */
  | {
      action: 'set_amount';
      amountCents: number;
      direction?: Direction;
      paymentMethod?: PaymentMethod;
      category?: Category;
    }
  /** ambiguous_total «Solo efectivo». */
  | { action: 'cash_only' }
  /** ambiguous_total «Todo el día». */
  | { action: 'whole_day' }
  /** missing_from_list «Sí, anótalo» (with `category` for an outgoing row). */
  | { action: 'add_from_list'; category?: Category }
  /** «No era un pago» / «No lo cuentes» / «Está bien lo anotado». */
  | { action: 'dismiss' };

export type ResolutionAction = ClarificationResolution['action'];

export const RESOLUTION_ACTIONS: Record<ClarificationType, readonly ResolutionAction[]> = {
  ambiguous_total: ['cash_only', 'whole_day', 'dismiss'],
  possible_duplicate: ['confirm', 'mark_duplicate'],
  unreadable: ['set_amount', 'dismiss'],
  direction: ['set_direction'],
  date: ['confirm', 'set_day'],
  category: ['set_category'],
  missing_from_list: ['add_from_list', 'dismiss'],
};

export interface ResolveClarificationResult {
  clarification: Clarification;
  /** The entry that results (confirmed, created or replacing), if any. */
  entry: LedgerEntry | null;
  /** What happened, e.g. `confirmed`, `replaced`, `record_unitemized`, `already_recorded`. */
  outcome: string;
}

function requireLiveEntry(entry: LedgerEntry | null): LedgerEntry {
  if (!entry || !isLive(entry)) throw new LedgerError('invalid_resolution');
  return entry;
}

/** Resolves a doubt from Pendientes (or, later, from the chat or the close reply). */
export async function resolveClarification(
  db: DbOrTx,
  input: {
    userId: string;
    clarificationId: string;
    resolution: ClarificationResolution;
    actor: Actor;
    now: Date;
  },
): Promise<ResolveClarificationResult> {
  const { userId, actor, now } = input;
  const r = input.resolution;
  return inTransaction(db, async (tx) => {
    const [c] = await tx
      .select()
      .from(clarifications)
      .where(and(eq(clarifications.id, input.clarificationId), eq(clarifications.userId, userId)))
      .for('update');
    if (!c) throw new LedgerError('not_found');
    if (c.status === 'resolved' || c.status === 'resolved_web') {
      throw new LedgerError('already_resolved');
    }
    if (!RESOLUTION_ACTIONS[c.type].includes(r.action)) {
      throw new LedgerError('invalid_resolution');
    }

    const linked = c.ledgerEntryId ? await lockEntry(tx, userId, c.ledgerEntryId) : null;
    const detail = (c.detail ?? {}) as ClarificationDetail;
    const origin: EntryOrigin = { source: defaultSource(actor) };
    const reason = `clarification:${c.type}`;
    let entry: LedgerEntry | null = null;
    let outcome: string = r.action;

    const confirm = async (target: LedgerEntry) =>
      target.status === 'pending'
        ? setEntryStatus(tx, target, 'confirmed', 'confirmed', actor, { clarificationId: c.id })
        : target;
    const replace = (target: LedgerEntry, changes: EntryChanges, label: LedgerLabel | 'keep') =>
      replaceEntry(tx, target, changes, { label, status: 'confirmed', origin, actor, reason });
    const newEntry = async (values: Omit<CreateEntryInput, 'userId' | 'businessDay'>) =>
      createEntry(
        tx,
        {
          userId,
          businessDay: c.businessDay,
          inboundMessageId: c.inboundMessageId,
          afterClose: await closeAlreadySent(tx, userId, c.businessDay),
          ...values,
        },
        actor,
        reason,
      );

    switch (r.action) {
      case 'confirm': {
        entry = await confirm(requireLiveEntry(linked));
        outcome = 'confirmed';
        break;
      }
      case 'mark_duplicate': {
        entry = await setEntryStatus(tx, requireLiveEntry(linked), 'duplicate', null, actor, {});
        outcome = 'duplicate';
        break;
      }
      case 'set_direction': {
        const target = requireLiveEntry(linked);
        const category = r.category ?? (r.direction === 'in' ? 'sale' : null);
        if (category === null) throw new LedgerError('invalid_resolution');
        assertCategory(category, r.direction);
        if (target.direction === r.direction && target.category === category) {
          entry = await confirm(target);
          outcome = 'confirmed';
        } else {
          entry = await replace(target, { direction: r.direction, category }, 'keep');
          outcome = 'replaced';
        }
        await rememberOutflowCategory(tx, userId, entry, category, now);
        break;
      }
      case 'set_day': {
        const target = requireLiveEntry(linked);
        if (!isIsoDate(r.businessDay) || r.businessDay > businessDayOf(now)) {
          throw new LedgerError('invalid_day');
        }
        if (r.businessDay === target.businessDay) {
          entry = await confirm(target);
          outcome = 'confirmed';
        } else {
          entry = await replace(target, { businessDay: r.businessDay }, 'keep');
          outcome = 'replaced';
        }
        break;
      }
      case 'set_category': {
        const target = requireLiveEntry(linked);
        assertCategory(r.category, target.direction);
        if (target.category === r.category) {
          entry = await confirm(target);
          outcome = 'confirmed';
        } else {
          entry = await replace(target, { category: r.category }, 'keep');
          outcome = 'replaced';
        }
        await rememberOutflowCategory(tx, userId, entry, r.category, now);
        break;
      }
      case 'set_amount': {
        assertAmount(r.amountCents);
        const direction = r.direction ?? linked?.direction ?? detail.direction ?? 'in';
        const paymentMethod =
          r.paymentMethod ?? linked?.paymentMethod ?? detail.paymentMethod ?? 'unknown';
        const category = r.category ?? (direction === 'in' ? 'sale' : 'unclassified');
        assertCategory(category, direction);
        if (linked && isLive(linked)) {
          entry = await replace(
            linked,
            { amountCents: r.amountCents, direction, paymentMethod, category },
            'self_reported',
          );
          outcome = 'replaced';
        } else {
          entry = await newEntry({
            amountCents: r.amountCents,
            direction,
            paymentMethod,
            category,
            label: 'self_reported',
            source: origin.source,
            operationAt: detail.at ? new Date(detail.at) : null,
          });
          outcome = 'created';
        }
        break;
      }
      case 'cash_only':
      case 'whole_day': {
        if (detail.variant === 'cash_below_recorded') throw new LedgerError('invalid_resolution');
        const live = linked && isLive(linked) ? linked : null;
        const total = detail.declaredTotalCents ?? live?.amountCents;
        if (!total) throw new LedgerError('invalid_resolution');
        const dayEntries = await tx
          .select()
          .from(ledgerEntries)
          .where(
            and(
              eq(ledgerEntries.userId, userId),
              eq(ledgerEntries.businessDay, c.businessDay),
              inArray(ledgerEntries.status, LIVE),
            ),
          );
        const result = resolveAmbiguousTotal(
          total,
          r.action === 'cash_only' ? 'cash' : 'whole_day',
          dayEntries.filter((row) => row.id !== live?.id),
        );
        outcome = result.kind;
        if (result.kind === 'record_unitemized') {
          const values = {
            amountCents: result.amountCents,
            direction: 'in' as const,
            paymentMethod: result.paymentMethod,
            category: 'sale' as const,
          };
          entry = live
            ? await replace(live, values, 'unitemized')
            : await newEntry({ ...values, label: 'unitemized', source: origin.source });
        } else if (live) {
          // Covered by what is recorded: the declared total adds nothing (D03).
          entry = await setEntryStatus(tx, live, 'voided', 'voided', actor, { reason });
        }
        break;
      }
      case 'add_from_list': {
        const row = detail.row;
        if (!row) throw new LedgerError('invalid_resolution');
        const operationNumber = normalizeOperationNumber(row.operationNumber);
        const [existing] = operationNumber
          ? await tx
              .select()
              .from(ledgerEntries)
              .where(
                and(
                  eq(ledgerEntries.userId, userId),
                  eq(ledgerEntries.paymentMethod, row.paymentMethod),
                  eq(ledgerEntries.operationNumber, operationNumber),
                  inArray(ledgerEntries.status, LIVE),
                ),
              )
          : [];
        if (existing) {
          // She sent the screenshot meanwhile: the row is already in the ledger (11.10).
          entry = existing;
          outcome = 'already_recorded';
          break;
        }
        const category = row.direction === 'in' ? 'sale' : (r.category ?? 'unclassified');
        assertCategory(category, row.direction);
        entry = await newEntry({
          amountCents: row.amountCents,
          direction: row.direction,
          paymentMethod: row.paymentMethod,
          category,
          // 11.10: rows she marks are recorded «con captura», origin `lista`.
          label: 'screenshot',
          source: 'activity_list',
          counterparty: row.counterparty,
          operationNumber: row.operationNumber,
          operationAt: row.operationAt ? new Date(row.operationAt) : null,
        });
        await rememberOutflowCategory(tx, userId, entry, category, now);
        outcome = 'created';
        break;
      }
      case 'dismiss': {
        if (linked && linked.status === 'pending') {
          entry = await setEntryStatus(tx, linked, 'voided', 'voided', actor, { reason });
        }
        outcome = 'dismissed';
        break;
      }
    }

    if (entry) {
      await addEvent(tx, entry.id, 'resolved', actor, {
        clarificationId: c.id,
        type: c.type,
        action: r.action,
        outcome,
      });
    }
    const [resolved] = await tx
      .update(clarifications)
      .set({
        status: resolvedStatusFor(actor),
        ledgerEntryId: entry?.id ?? c.ledgerEntryId,
        answer: {
          ...r,
          outcome,
          entryId: entry?.id ?? null,
          resolvedAt: now.toISOString(),
          by: actorLabel(actor),
        },
      })
      .where(eq(clarifications.id, c.id))
      .returning();
    if (!resolved) throw new Error('update returned no row');

    // Other open doubts on an entry that just left the ledger have nothing left to ask.
    if (entry && !isLive(entry)) {
      await resolveDoubtsOfEntry(tx, entry.id, actor, now, `entry_${entry.status}`);
    }
    await refreshDayLevel(tx, userId, c.businessDay, now);
    return { clarification: resolved, entry, outcome };
  });
}

/**
 * D17 / 11.9: once she has replied to a close, resolving the doubts that were in its message can
 * raise the level. Before the points deadline it updates `level` (the 12:00 job gives points for
 * it); after, only `improved_level`, without points. Doubts that went to the web never count
 * (PR10). Nothing happens if she never replied.
 */
export async function refreshDayLevel(
  db: DbOrTx,
  userId: string,
  businessDay: IsoDate,
  now: Date,
): Promise<void> {
  await inTransaction(db, async (tx) => {
    const [close] = await tx
      .select()
      .from(dailyCloses)
      .where(and(eq(dailyCloses.userId, userId), eq(dailyCloses.businessDay, businessDay)))
      .for('update');
    if (!close || close.level === null || close.repliedAt === null) return;

    const inMessage = await tx
      .select({ status: clarifications.status })
      .from(clarifications)
      .where(
        and(
          eq(clarifications.userId, userId),
          eq(clarifications.businessDay, businessDay),
          isNotNull(clarifications.messageNumber),
        ),
      );
    const newLevel = closeLevelAfterReply({
      messageClarificationsResolved: inMessage.every(
        (row) => row.status === 'resolved' || row.status === 'resolved_web',
      ),
      cashCheck: close.cashCheck,
    });

    const isFinal = close.status === 'final' || !isBeforePointsDeadline(businessDay, now);
    if (!isFinal) {
      if (isBetterLevel(newLevel, close.level)) {
        await tx.update(dailyCloses).set({ level: newLevel }).where(eq(dailyCloses.id, close.id));
      }
      return;
    }
    const improved = improvedLevel({
      finalLevel: close.level,
      currentImprovedLevel: close.improvedLevel,
      newLevel,
    });
    if (improved) {
      await tx
        .update(dailyCloses)
        .set({ improvedLevel: improved })
        .where(eq(dailyCloses.id, close.id));
    }
  });
}
