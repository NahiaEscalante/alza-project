/**
 * Chat tools (10.5). Read-only, every query filtered by the session's user (14.4):
 *
 * | Tool             | 10.5                         | What it returns                               |
 * |------------------|------------------------------|-----------------------------------------------|
 * | get_summary      | consultar_resumen(periodo)   | entró, salió, te quedó, ventas por etiqueta    |
 * | search_entries   | buscar_movimientos(filtros)  | live records by day, amount, method, name…    |
 * | get_points       | consultar_puntos()           | balance, streak, freezes, next milestone      |
 * | explain          | explicar(tema)               | approved text of a term or rule (Anexo A)     |
 * | list_pending     | (needed to resolve a doubt)  | open doubts with their tap options            |
 * | propose_change   | proponer_cambio(tipo, datos) | collects ONE draft; nothing is written        |
 *
 * Records are named by per-turn refs (r1, p1…), never by database ids: the model can only point
 * at what her own search returned, so another user's record cannot be proposed (17.4). Amounts go
 * to the model already formatted («S/ 12,50») so it never does money arithmetic.
 */
import { and, between, desc, eq, inArray, like, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { getPointsSummary } from '../account/index.js';
import type { ChatToolbox, ChatToolSession } from '../ai/index.js';
import type { ToolSpec } from '../ai/providers/types.js';
import type { Db } from '../db/client.js';
import {
  CATEGORIES,
  type Category,
  DIRECTIONS,
  type Direction,
  type LedgerEntry,
  ledgerEntries,
  type PaymentMethod,
} from '../db/schema.js';
import {
  addDays,
  businessDayOf,
  computeIndicators,
  daysBetween,
  formatSoles,
  type IsoDate,
  isCategoryValidFor,
  isIsoDate,
  isLive,
  isoWeekday,
  normalizeName,
  parseAmountToCents,
  sumCents,
} from '../domain/index.js';
import {
  type ClarificationResolution,
  dayLabel,
  type EntryView,
  listDays,
  listPending,
  longDayLabel,
  MAX_DAYS_RANGE,
  type PendingItem,
  toEntryView,
} from '../ledger/index.js';
import { asksForChange, normalizeText } from './guards.js';
import {
  addPastEntryDraft,
  changeCategoryDraft,
  correctAmountDraft,
  type EntryCard,
  entryCard as entryCardOf,
  PROPOSAL_TYPES,
  type ProposalDraft,
  resolveDraft,
  voidDraft,
} from './proposals.js';
import { EXPLAIN_TOPIC_HINT, EXPLAIN_TOPICS, explainTopicFor } from './texts.js';

const LIVE = ['confirmed', 'pending'] as const;
/** search_entries without dates: the last 31 days. */
const DEFAULT_SEARCH_DAYS = 31;
const MAX_SEARCH_RESULTS = 12;
const MAX_PENDING_RESULTS = 10;
const WEB_METHODS = ['yape', 'plin', 'cash', 'bank_transfer'] as const;
/** Types she can give a record from the chat («por clasificar» is ALZA's). */
const CHOOSABLE_CATEGORIES = CATEGORIES.filter((c) => c !== 'unclassified');

// ---------------------------------------------------------------------------
// Specs (JSON Schema shown to the model)
// ---------------------------------------------------------------------------

const DATE = { type: 'string', description: 'YYYY-MM-DD, «hoy», «ayer» o un día («martes»)' };

/**
 * Short on purpose: specs are re-sent on every model step (free tiers count tokens per minute).
 * The rules live in the system prompt; enums carry the allowed values.
 */
export const CHAT_TOOL_SPECS: ToolSpec[] = [
  {
    name: 'get_summary',
    description: 'Entró, salió, te quedó y ventas de un periodo (un día: from = to).',
    parameters: {
      type: 'object',
      properties: { from: DATE, to: DATE },
      required: ['from', 'to'],
    },
  },
  {
    name: 'search_entries',
    description: `Sus registros, recientes primero (sin fechas: últimos ${DEFAULT_SEARCH_DAYS} días). Filtros opcionales. Cada uno trae su ref.`,
    parameters: {
      type: 'object',
      properties: {
        from: DATE,
        to: DATE,
        amount: { type: 'string', description: '"100", "12.50"' },
        payment_method: { type: 'string', enum: [...WEB_METHODS] },
        direction: {
          type: 'string',
          enum: [...DIRECTIONS],
          description: 'in = entró, out = salió',
        },
        category: { type: 'string', enum: [...CATEGORIES] },
        counterparty: { type: 'string', description: 'parte del nombre' },
      },
    },
  },
  {
    name: 'get_points',
    description: 'Puntos, racha, comodines y próximo hito.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'explain',
    description: 'Texto aprobado que explica un término o una regla de ALZA.',
    parameters: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: 'en sus palabras: «comodín», «racha», «cierre»…',
        },
      },
      required: ['topic'],
    },
  },
  {
    name: 'list_pending',
    description: 'Sus dudas pendientes con sus opciones. Cada una trae su ref.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'propose_change',
    description:
      'Propone UN cambio; ella lo confirma con su PIN. Por tipo: correct_amount: entry_ref, ' +
      'amount · change_category: entry_ref, category · void_entry: entry_ref · add_past_entry: ' +
      'day (antes de hoy), amount, direction, payment_method (+category si salió) · ' +
      'resolve_clarification: pending_ref, option (+amount o day si la opción lo pide).',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: [...PROPOSAL_TYPES] },
        entry_ref: { type: 'string' },
        pending_ref: { type: 'string' },
        option: { type: 'integer' },
        amount: { type: 'string' },
        category: { type: 'string', enum: CHOOSABLE_CATEGORIES },
        day: DATE,
        direction: { type: 'string', enum: [...DIRECTIONS] },
        payment_method: { type: 'string', enum: [...WEB_METHODS] },
        counterparty: { type: 'string' },
      },
      required: ['type'],
    },
  },
];

// ---------------------------------------------------------------------------
// Argument schemas (a model can send anything)
// ---------------------------------------------------------------------------

const optionalText = z
  .string()
  .trim()
  .max(80)
  .nullish()
  .transform((v) => v || undefined);
const amountArg = z
  .union([z.string().max(20), z.number()])
  .nullish()
  .transform((v) => (v === null || v === undefined || v === '' ? undefined : String(v)));
/** A date or a day word («hoy», «martes»): resolved by the session against her business day. */
const dayArg = optionalText;
const enumArg = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .enum(values)
    .nullish()
    .transform((v) => v ?? undefined);

const summaryArgs = z.object({ from: z.string().max(20), to: z.string().max(20) });
const searchArgs = z.object({
  from: dayArg,
  to: dayArg,
  amount: amountArg,
  payment_method: enumArg(WEB_METHODS),
  direction: enumArg(DIRECTIONS),
  category: enumArg(CATEGORIES),
  counterparty: optionalText,
});
const explainArgs = z.object({ topic: z.string().trim().min(1).max(80) });
const proposeArgs = z.object({
  type: z.enum(PROPOSAL_TYPES),
  entry_ref: optionalText,
  pending_ref: optionalText,
  option: z.coerce.number().int().min(1).max(10).nullish(),
  amount: amountArg,
  category: enumArg(CATEGORIES),
  day: dayArg,
  direction: enumArg(DIRECTIONS),
  payment_method: enumArg(WEB_METHODS),
  counterparty: optionalText,
});

const WEEKDAY_WORDS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
const DAY_HINT = 'Fechas YYYY-MM-DD, «hoy», «ayer», «anteayer» o un día («martes»).';

/**
 * A tool date: «YYYY-MM-DD», «hoy», «ayer», «anteayer» or a weekday (the most recent one that is
 * not in the future, today included). The server does the date arithmetic, not the model.
 */
export function resolveToolDay(value: string, today: IsoDate): IsoDate | null {
  if (isIsoDate(value)) return value;
  const word = normalizeText(value).replace(/^(el|este) /, '');
  if (word === 'hoy') return today;
  if (word === 'ayer') return addDays(today, -1);
  if (word === 'anteayer') return addDays(today, -2);
  const index = WEEKDAY_WORDS.indexOf(word);
  if (index < 0) return null;
  return addDays(today, -((isoWeekday(today) - (index + 1) + 7) % 7));
}

type ToolError = { ok: false; error: string; hint?: string };
const fail = (error: string, hint?: string): ToolError => ({
  ok: false,
  error,
  ...(hint ? { hint } : {}),
});

function parseCents(amount: string | undefined): number | null {
  if (amount === undefined) return null;
  const parsed = parseAmountToCents(amount);
  return parsed.ok ? parsed.cents : null;
}

function periodLabel(from: IsoDate, to: IsoDate): string {
  return from === to ? dayLabel(from) : `del ${dayLabel(from)} al ${dayLabel(to)}`;
}

/**
 * What the model sees of a record: compact, with defaults left out (re-sent on every later step).
 * Text from screenshots stays inside the DATA block.
 */
function entryForModel(ref: string, view: EntryView, longDays: boolean) {
  return {
    ref,
    day: longDays ? longDayLabel(view.businessDay) : dayLabel(view.businessDay),
    ...(view.time ? { time: view.time } : {}),
    direction: view.directionText,
    method: view.paymentMethodText,
    ...(view.counterparty ? { counterparty: view.counterparty } : {}),
    amount: formatSoles(view.amountCents),
    type: view.categoryText,
    label: view.labelText,
    ...(view.isPending ? { status: 'Por confirmar' } : {}),
    ...(view.countsInTotals ? {} : { counts_in_totals: false }),
  };
}

function cardForModel(card: EntryCard | null) {
  if (!card) return null;
  return {
    day: card.dayLabel,
    direction: card.directionText,
    method: card.methodText,
    counterparty: card.counterparty,
    amount: formatSoles(card.amountCents),
    type: card.categoryText,
    label: card.labelText,
  };
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export interface ChatToolsResult {
  proposal: ProposalDraft | null;
  /** Codes of refused proposals (tests and logs). */
  refusals: string[];
  /** Tools that threw (e.g. the database); the model was told `tool_failed`. */
  failures: string[];
}

export interface ChatToolsContext {
  db: Db;
  /** From the session cookie, never from the browser or the model. */
  userId: string;
  now: Date;
  /** Her message of this turn: `propose_change` works only if it asks for a change. */
  message: string;
}

/** Read-only tools, plus `propose_change` only when her message asks for a change. */
export function chatToolSpecs(message: string): ToolSpec[] {
  return asksForChange(message)
    ? CHAT_TOOL_SPECS
    : CHAT_TOOL_SPECS.filter((spec) => spec.name !== 'propose_change');
}

export function createChatToolbox(context: ChatToolsContext): ChatToolbox<ChatToolsResult> {
  // The session still answers a `propose_change` the model was not offered: «not_requested».
  return { specs: chatToolSpecs(context.message), open: () => new ToolSession(context) };
}

class ToolSession implements ChatToolSession<ChatToolsResult> {
  private readonly entries = new Map<string, string>();
  private readonly pending = new Map<string, PendingItem>();
  private proposal: ProposalDraft | null = null;
  private readonly refusals: string[] = [];
  private readonly failures: string[] = [];
  private readonly today: IsoDate;

  constructor(private readonly ctx: ChatToolsContext) {
    this.today = businessDayOf(ctx.now);
  }

  finish(): ChatToolsResult {
    return { proposal: this.proposal, refusals: [...this.refusals], failures: [...this.failures] };
  }

  async execute(name: string, args: unknown): Promise<unknown> {
    try {
      return await this.run(name, args && typeof args === 'object' ? args : {});
    } catch (err) {
      this.failures.push(name);
      throw err;
    }
  }

  private async run(name: string, input: object): Promise<unknown> {
    switch (name) {
      case 'get_summary':
        return this.summary(input);
      case 'search_entries':
        return this.search(input);
      case 'get_points':
        return this.points();
      case 'explain': {
        const parsed = explainArgs.safeParse(input);
        const topic = parsed.success ? explainTopicFor(parsed.data.topic) : null;
        if (!topic) return fail('unknown_topic', `Temas: ${EXPLAIN_TOPIC_HINT}`);
        return { topic, text: EXPLAIN_TOPICS[topic] };
      }
      case 'list_pending':
        return this.listPending();
      case 'propose_change':
        return this.propose(input);
      default:
        return fail('unknown_tool');
    }
  }

  /** Clips a range to today and to the longest allowed period. */
  private range(from: IsoDate, to: IsoDate): { from: IsoDate; to: IsoDate } | ToolError {
    const end = to > this.today ? this.today : to;
    if (from > end) return fail('future_period', 'Ese periodo todavía no llega.');
    if (daysBetween(from, end) + 1 > MAX_DAYS_RANGE) {
      return fail('period_too_long', `Máximo ${MAX_DAYS_RANGE} días.`);
    }
    return { from, to: end };
  }

  private async loadEntries(from: IsoDate, to: IsoDate, extra: SQL[] = []) {
    return this.ctx.db
      .select()
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.userId, this.ctx.userId),
          inArray(ledgerEntries.status, LIVE),
          between(ledgerEntries.businessDay, from, to),
          ...extra,
        ),
      )
      .orderBy(
        desc(ledgerEntries.businessDay),
        desc(ledgerEntries.operationAt),
        desc(ledgerEntries.createdAt),
      );
  }

  private async summary(args: object) {
    const parsed = summaryArgs.safeParse(args);
    const from = parsed.success ? resolveToolDay(parsed.data.from, this.today) : null;
    const to = parsed.success ? resolveToolDay(parsed.data.to, this.today) : null;
    if (!from || !to) return fail('invalid_dates', DAY_HINT);
    const range = this.range(from, to);
    if ('ok' in range) return range;
    const [entries, days] = await Promise.all([
      this.loadEntries(range.from, range.to),
      listDays(this.ctx.db, this.ctx.userId, range, this.ctx.now),
    ]);
    const indicators = computeIndicators(entries);
    const sales = entries.filter(
      (e) => e.status === 'confirmed' && e.direction === 'in' && e.category === 'sale',
    );
    const byLabel = (label: LedgerEntry['label']) =>
      formatSoles(sumCents(sales.filter((e) => e.label === label).map((e) => e.amountCents)));
    const level = (value: string) => days.filter((d) => d.level === value).length;
    return {
      period: { label: periodLabel(range.from, range.to) },
      days_with_records: new Set(entries.map((e) => e.businessDay)).size,
      came_in: formatSoles(indicators.inCents),
      went_out: formatSoles(indicators.outCents),
      left: formatSoles(indicators.leftCents),
      sales: {
        total: formatSoles(indicators.inCents),
        count: sales.length,
        with_screenshot: byLabel('screenshot'),
        self_reported: formatSoles(
          sumCents(sales.filter((e) => e.label !== 'screenshot').map((e) => e.amountCents)),
        ),
        digital_yape_plin_transfer: formatSoles(indicators.digitalSalesCents),
        cash: formatSoles(indicators.cashSalesCents),
      },
      went_out_detail: {
        inventory: formatSoles(indicators.inventoryCents),
        business_expenses: formatSoles(indicators.expensesCents),
        household: formatSoles(indicators.householdCents),
        unclassified: formatSoles(indicators.unclassifiedCents),
      },
      pending_to_confirm: formatSoles(indicators.pendingCents),
      closes: {
        complete: level('complete'),
        partial: level('partial'),
        no_close: level('no_close'),
      },
    };
  }

  private async search(args: object) {
    const parsed = searchArgs.safeParse(args);
    if (!parsed.success) return fail('invalid_filters');
    const f = parsed.data;
    const fromDay = f.from === undefined ? undefined : resolveToolDay(f.from, this.today);
    const toDay = f.to === undefined ? undefined : resolveToolDay(f.to, this.today);
    if (fromDay === null || toDay === null) return fail('invalid_dates', DAY_HINT);
    const to = toDay ?? (fromDay ? addDays(fromDay, DEFAULT_SEARCH_DAYS - 1) : this.today);
    const from = fromDay ?? addDays(to, -(DEFAULT_SEARCH_DAYS - 1));
    const range = this.range(from, to);
    if ('ok' in range) return range;
    const extra: SQL[] = [];
    if (f.amount !== undefined) {
      const cents = parseCents(f.amount);
      if (cents === null) return fail('invalid_amount');
      extra.push(eq(ledgerEntries.amountCents, cents));
    }
    if (f.payment_method) extra.push(eq(ledgerEntries.paymentMethod, f.payment_method));
    if (f.direction) extra.push(eq(ledgerEntries.direction, f.direction));
    if (f.category) extra.push(eq(ledgerEntries.category, f.category));
    if (f.counterparty) {
      const key = normalizeName(f.counterparty).replace(/[\\%_]/g, '');
      if (key) extra.push(like(ledgerEntries.counterpartyNormalized, `%${key}%`));
    }
    const rows = await this.loadEntries(range.from, range.to, extra);
    const shown = rows.slice(0, MAX_SEARCH_RESULTS);
    // «martes 10» is unique within a month; longer searches name the month too.
    const longDays = daysBetween(range.from, range.to) >= DEFAULT_SEARCH_DAYS;
    return {
      period: periodLabel(range.from, range.to),
      found: rows.length,
      ...(shown.length < rows.length ? { shown: shown.length } : {}),
      entries: shown.map((row) => {
        const ref = `r${this.entries.size + 1}`;
        this.entries.set(ref, row.id);
        return entryForModel(ref, toEntryView(row), longDays);
      }),
    };
  }

  private async points() {
    const p = await getPointsSummary(this.ctx.db, this.ctx.userId, this.ctx.now);
    return {
      balance: p.balance,
      streak_days: p.streakDays,
      freezes_left_this_week: p.freezesLeft,
      next_milestone: p.nextMilestone,
      missing_for_next_milestone: p.missingForNextMilestone,
      next_reward: p.nextReward
        ? {
            name: p.nextReward.name,
            cost: p.nextReward.costPoints,
            missing: p.nextReward.missingPoints,
          }
        : null,
      big_goal: p.bigGoal,
      missing_for_big_goal: p.missingForBigGoal,
      note: 'Los premios son de ejemplo para la demo.',
    };
  }

  private async listPending() {
    const items = await listPending(this.ctx.db, this.ctx.userId);
    const shown = items.slice(0, MAX_PENDING_RESULTS);
    return {
      count: items.length,
      items: shown.map((item) => {
        const ref = `p${this.pending.size + 1}`;
        this.pending.set(ref, item);
        return {
          ref,
          day: item.dayLabel,
          question: item.question,
          options: item.options.map((option, i) => ({
            option: i + 1,
            label: option.label,
            ...(option.input ? { needs: option.input } : {}),
          })),
          entry: item.entry ? cardForModel(entryCardOf(item.entry)) : null,
        };
      }),
    };
  }

  // -- propose_change ---------------------------------------------------------------------

  private refuse(error: string, hint?: string): ToolError {
    this.refusals.push(error);
    return fail(error, hint);
  }

  /** The record behind a ref of this turn, re-read with her user id (14.4). */
  private async entryFor(ref: string | undefined): Promise<LedgerEntry | ToolError> {
    const id = ref ? this.entries.get(ref) : undefined;
    if (!id) return this.refuse('unknown_ref', 'Usa una ref de search_entries de este turno.');
    const [row] = await this.ctx.db
      .select()
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.id, id), eq(ledgerEntries.userId, this.ctx.userId)));
    if (!row) return this.refuse('unknown_ref');
    if (!isLive(row)) return this.refuse('not_live', 'Ese registro ya fue cambiado o quitado.');
    return row;
  }

  private async propose(args: object) {
    if (!asksForChange(this.ctx.message)) {
      return this.refuse(
        'not_requested',
        'Ella no pidió ningún cambio en su mensaje. No propongas cambios.',
      );
    }
    if (this.proposal) return this.refuse('one_change_per_turn', 'Ya propusiste un cambio.');
    const parsed = proposeArgs.safeParse(args);
    if (!parsed.success) return this.refuse('invalid_arguments');
    const day =
      parsed.data.day === undefined ? undefined : resolveToolDay(parsed.data.day, this.today);
    if (day === null) return this.refuse('invalid_day', DAY_HINT);
    const a = { ...parsed.data, day };
    let draft: ProposalDraft | ToolError;
    switch (a.type) {
      case 'correct_amount': {
        const entry = await this.entryFor(a.entry_ref);
        if ('ok' in entry) return entry;
        const cents = parseCents(a.amount);
        if (cents === null) return this.refuse('invalid_amount', 'Pregúntale el monto correcto.');
        if (cents === entry.amountCents) return this.refuse('no_changes', 'Ya tiene ese monto.');
        draft = correctAmountDraft(entry, cents);
        break;
      }
      case 'change_category': {
        const entry = await this.entryFor(a.entry_ref);
        if ('ok' in entry) return entry;
        const category = a.category;
        if (
          !category ||
          category === 'unclassified' ||
          !isCategoryValidFor(category, entry.direction)
        ) {
          return this.refuse(
            'invalid_category',
            `Tipos válidos para este registro: ${validCategories(entry.direction).join(', ')}.`,
          );
        }
        if (category === entry.category) return this.refuse('no_changes', 'Ya tiene ese tipo.');
        draft = changeCategoryDraft(entry, category);
        break;
      }
      case 'void_entry': {
        const entry = await this.entryFor(a.entry_ref);
        if ('ok' in entry) return entry;
        draft = voidDraft(entry);
        break;
      }
      case 'add_past_entry':
        draft = this.addDraft(a);
        break;
      case 'resolve_clarification':
        draft = this.resolutionDraft(a);
        break;
    }
    if ('ok' in draft) return draft;
    this.proposal = draft;
    return {
      ok: true,
      before: cardForModel(draft.before.entry),
      after: { record: cardForModel(draft.after.entry), change: draft.after.text },
      next: 'Ella ve «antes y después» con Confirmar y Cancelar. Dile que lo revise y toque «Confirmar»; no digas que ya está hecho.',
    };
  }

  private addDraft(a: z.infer<typeof proposeArgs>): ProposalDraft | ToolError {
    if (!a.day || a.day >= this.today) {
      return this.refuse(
        'invalid_day',
        'Solo días anteriores a hoy; lo de hoy se manda por WhatsApp.',
      );
    }
    if (daysBetween(a.day, this.today) > MAX_DAYS_RANGE) return this.refuse('invalid_day');
    const cents = parseCents(a.amount);
    if (cents === null) return this.refuse('invalid_amount', 'Pregúntale el monto.');
    const direction: Direction = a.direction ?? 'in';
    const category: Category | undefined = a.category ?? (direction === 'in' ? 'sale' : undefined);
    if (!category) {
      return this.refuse(
        'missing_category',
        'Pregúntale si fue mercadería, gasto del negocio o para la casa.',
      );
    }
    if (category === 'unclassified' || !isCategoryValidFor(category, direction)) {
      return this.refuse(
        'invalid_category',
        `Tipos válidos: ${validCategories(direction).join(', ')}.`,
      );
    }
    const paymentMethod: PaymentMethod = a.payment_method ?? 'cash';
    return addPastEntryDraft({
      businessDay: a.day,
      amountCents: cents,
      direction,
      paymentMethod,
      category,
      counterparty: a.counterparty ?? null,
    });
  }

  private resolutionDraft(a: z.infer<typeof proposeArgs>): ProposalDraft | ToolError {
    const item = a.pending_ref ? this.pending.get(a.pending_ref) : undefined;
    if (!item) return this.refuse('unknown_ref', 'Usa una ref de list_pending de este turno.');
    const option = a.option ? item.options[a.option - 1] : undefined;
    if (!option) return this.refuse('invalid_option', 'Pregúntale cuál de las opciones elige.');
    let resolution = option.resolution as Record<string, unknown>;
    if (option.input === 'amount') {
      const cents = parseCents(a.amount);
      if (cents === null) return this.refuse('invalid_amount', 'Pregúntale de cuánto era.');
      resolution = { ...resolution, amountCents: cents };
    }
    if (option.input === 'day') {
      if (!a.day || a.day > this.today)
        return this.refuse('invalid_day', 'Pregúntale de qué día era.');
      resolution = { ...resolution, businessDay: a.day };
    }
    return resolveDraft({
      clarificationId: item.id,
      question: item.question,
      entry: item.entry,
      optionLabel: option.label,
      // Built from the server's own option, plus a validated amount or day.
      resolution: resolution as unknown as ClarificationResolution,
    });
  }
}

function validCategories(direction: Direction): Category[] {
  return CHOOSABLE_CATEGORIES.filter((c) => isCategoryValidFor(c, direction));
}
