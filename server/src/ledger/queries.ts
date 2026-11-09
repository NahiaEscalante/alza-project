/**
 * Ledger reads for the web (RF-WP-01, RF-WP-02, RF-WP-04). Every query is filtered by the user of
 * the session (14.4); totals come from the domain (11.6), never from SQL.
 */
import { and, asc, between, desc, eq, gte, inArray, lt, type SQL } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  type Clarification,
  type CloseLevel,
  clarifications,
  type DailyClose,
  dailyCloses,
  inboundMessages,
  type LedgerEntry,
  ledgerEntries,
  ledgerEntryEvents,
  pointsEntries,
  streaks,
} from '../db/schema.js';
import {
  addDays,
  buildWeeklySummary,
  businessDayEnd,
  businessDayOf,
  businessDayStart,
  computeIndicators,
  daysBetween,
  type IsoDate,
  isBeforePointsDeadline,
  isCashVerified,
  isExcludedFromTotals,
  sortClarifications,
  weekDays,
} from '../domain/index.js';
import { describeClarification, type PendingOption } from './clarification-texts.js';
import {
  AFTER_CLOSE_TAG,
  CASH_UNREVIEWED_TAG,
  CATEGORY_TEXT,
  DIRECTION_TEXT,
  dayLabel,
  formatTime24,
  LABEL_TEXT,
  LEVEL_TEXT,
  METHOD_TEXT,
  PENDING_TAG,
  weekdayName,
  weekLabel,
} from './labels.js';

const LIVE = ['confirmed', 'pending'] as const;
/** Doubts listed in Pendientes: not yet in a close message, or moved to the web (9.2). */
export const PENDING_LIST_STATUSES = ['open', 'in_web'] as const;
export const MAX_DAYS_RANGE = 93;

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

export interface EntryView {
  id: string;
  businessDay: IsoDate;
  /** «14:05» (Lima), or null when unknown (e.g. added later for a past day). */
  time: string | null;
  amountCents: number;
  direction: LedgerEntry['direction'];
  directionText: string;
  paymentMethod: LedgerEntry['paymentMethod'];
  paymentMethodText: string;
  category: LedgerEntry['category'];
  categoryText: string;
  counterparty: string | null;
  label: LedgerEntry['label'];
  labelText: string;
  status: LedgerEntry['status'];
  isPending: boolean;
  /** Counts in entró/salió (confirmed and not personal/internal, 11.6). */
  countsInTotals: boolean;
  afterClose: boolean;
  /** Visible tags (PR12): label text, «Por confirmar», «Agregado después del cierre». */
  tags: string[];
}

function entryTime(entry: LedgerEntry): string | null {
  if (entry.operationAt) return formatTime24(entry.operationAt);
  return businessDayOf(entry.createdAt) === entry.businessDay
    ? formatTime24(entry.createdAt)
    : null;
}

export function toEntryView(entry: LedgerEntry): EntryView {
  const isPending = entry.status === 'pending';
  const tags = [LABEL_TEXT[entry.label]];
  if (isPending) tags.push(PENDING_TAG);
  if (entry.afterClose) tags.push(AFTER_CLOSE_TAG);
  return {
    id: entry.id,
    businessDay: entry.businessDay,
    time: entryTime(entry),
    amountCents: entry.amountCents,
    direction: entry.direction,
    directionText: DIRECTION_TEXT[entry.direction],
    paymentMethod: entry.paymentMethod,
    paymentMethodText: METHOD_TEXT[entry.paymentMethod],
    category: entry.category,
    categoryText: CATEGORY_TEXT[entry.category],
    counterparty: entry.counterparty,
    label: entry.label,
    labelText: LABEL_TEXT[entry.label],
    status: entry.status,
    isPending,
    countsInTotals: entry.status === 'confirmed' && !isExcludedFromTotals(entry.category),
    afterClose: entry.afterClose,
    tags,
  };
}

/** Sorted by time of the operation, then arrival. */
function byTime(a: LedgerEntry, b: LedgerEntry): number {
  const ta = (a.operationAt ?? a.createdAt).getTime();
  const tb = (b.operationAt ?? b.createdAt).getTime();
  return ta - tb || a.createdAt.getTime() - b.createdAt.getTime();
}

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

export interface DayView {
  businessDay: IsoDate;
  /** «martes 10». */
  label: string;
  isToday: boolean;
  hasActivity: boolean;
  entryCount: number;
  /** Doubts of the day listed in Pendientes. */
  pendingCount: number;
  inCents: number;
  outCents: number;
  leftCents: number;
  digitalSalesCents: number;
  cashSalesCents: number;
  /** «Por confirmar», never part of the totals. */
  pendingCents: number;
  /** Improved level if any (D17), else the close level; `no_close` once the deadline passed. */
  level: CloseLevel | null;
  /** «completo», «a medias», «sin cierre». */
  levelText: string | null;
  closeStatus: DailyClose['status'] | null;
  /** «Caja sin revisar» (11.3): she replied without verifying the cash, or never replied. */
  cashUnreviewed: boolean;
  tags: string[];
}

export function effectiveLevel(
  day: IsoDate,
  close: Pick<DailyClose, 'level' | 'improvedLevel'> | undefined,
  hasActivity: boolean,
  now: Date,
): CloseLevel | null {
  const level = close?.improvedLevel ?? close?.level ?? null;
  if (level) return level;
  return hasActivity && !isBeforePointsDeadline(day, now) ? 'no_close' : null;
}

function buildDayView(
  day: IsoDate,
  entries: readonly LedgerEntry[],
  close: DailyClose | undefined,
  pendingCount: number,
  now: Date,
): DayView {
  const indicators = computeIndicators(entries);
  const hasActivity = entries.length > 0 || pendingCount > 0 || close !== undefined;
  const level = effectiveLevel(day, close, hasActivity, now);
  const cashUnreviewed =
    close !== undefined &&
    close.sentAt !== null &&
    !isCashVerified(close.cashCheck) &&
    (close.repliedAt !== null || !isBeforePointsDeadline(day, now));
  return {
    businessDay: day,
    label: dayLabel(day),
    isToday: day === businessDayOf(now),
    hasActivity,
    entryCount: entries.length,
    pendingCount,
    inCents: indicators.inCents,
    outCents: indicators.outCents,
    leftCents: indicators.leftCents,
    digitalSalesCents: indicators.digitalSalesCents,
    cashSalesCents: indicators.cashSalesCents,
    pendingCents: indicators.pendingCents,
    level,
    levelText: level ? LEVEL_TEXT[level] : null,
    closeStatus: close?.status ?? null,
    cashUnreviewed,
    tags: cashUnreviewed ? [CASH_UNREVIEWED_TAG] : [],
  };
}

interface DayData {
  entries: LedgerEntry[];
  closes: DailyClose[];
  pendingByDay: Map<IsoDate, number>;
}

async function loadDays(db: Db, userId: string, from: IsoDate, to: IsoDate): Promise<DayData> {
  const [entries, closes, pending] = await Promise.all([
    db
      .select()
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.userId, userId),
          between(ledgerEntries.businessDay, from, to),
          inArray(ledgerEntries.status, LIVE),
        ),
      ),
    db
      .select()
      .from(dailyCloses)
      .where(and(eq(dailyCloses.userId, userId), between(dailyCloses.businessDay, from, to))),
    db
      .select({ businessDay: clarifications.businessDay })
      .from(clarifications)
      .where(
        and(
          eq(clarifications.userId, userId),
          between(clarifications.businessDay, from, to),
          inArray(clarifications.status, PENDING_LIST_STATUSES),
        ),
      ),
  ]);
  const pendingByDay = new Map<IsoDate, number>();
  for (const row of pending) {
    pendingByDay.set(row.businessDay, (pendingByDay.get(row.businessDay) ?? 0) + 1);
  }
  return { entries, closes, pendingByDay };
}

function dayViewsFrom(data: DayData, days: readonly IsoDate[], now: Date): DayView[] {
  return days.map((day) =>
    buildDayView(
      day,
      data.entries.filter((entry) => entry.businessDay === day),
      data.closes.find((close) => close.businessDay === day),
      data.pendingByDay.get(day) ?? 0,
      now,
    ),
  );
}

function earlierDay(a: IsoDate, b: IsoDate): IsoDate {
  if (a <= b) return a;
  return b;
}

/**
 * Days from `from` to `to` (clipped to today), most recent first, each with its totals, level and
 * tags. Range up to `MAX_DAYS_RANGE` days.
 */
export async function listDays(
  db: Db,
  userId: string,
  range: { from: IsoDate; to: IsoDate },
  now: Date,
): Promise<DayView[]> {
  const today = businessDayOf(now);
  const to = earlierDay(range.to, today);
  if (range.from > to) return [];
  const count = Math.min(daysBetween(range.from, to) + 1, MAX_DAYS_RANGE);
  const days = Array.from({ length: count }, (_, i) => addDays(to, -i));
  const data = await loadDays(db, userId, days.at(-1) as IsoDate, to);
  return dayViewsFrom(data, days, now);
}

export async function getDayEntries(
  db: Db,
  userId: string,
  day: IsoDate,
  now: Date,
): Promise<{ day: DayView; entries: EntryView[] }> {
  const data = await loadDays(db, userId, day, day);
  const [view] = dayViewsFrom(data, [day], now);
  return {
    day: view as DayView,
    entries: [...data.entries].sort(byTime).map(toEntryView),
  };
}

// ---------------------------------------------------------------------------
// Week (Inicio)
// ---------------------------------------------------------------------------

export interface WeekView {
  weekStart: IsoDate;
  weekEnd: IsoDate;
  /** «Semana del 9 al 15 nov». */
  label: string;
  inCents: number;
  outCents: number;
  leftCents: number;
  digitalSalesCents: number;
  cashSalesCents: number;
  pendingCents: number;
  /** Final levels of the days before today (D38 counting). */
  completeCount: number;
  partialCount: number;
  noCloseCount: number;
  pointsEarned: number;
  /** Monday to Sunday, for the bar chart. */
  days: (Pick<
    DayView,
    'businessDay' | 'inCents' | 'outCents' | 'leftCents' | 'level' | 'levelText' | 'isToday'
  > & { weekday: string; isFuture: boolean })[];
}

/** Week (Monday–Sunday) containing `day`, with the domain's weekly summary (11.11). */
export async function getWeekView(
  db: Db,
  userId: string,
  day: IsoDate,
  now: Date,
): Promise<WeekView> {
  const week = weekDays(day);
  const monday = week[0] as IsoDate;
  const sunday = week[6] as IsoDate;
  const today = businessDayOf(now);
  const [data, points, [streak]] = await Promise.all([
    loadDays(db, userId, monday, sunday),
    db
      .select({ points: pointsEntries.points, createdAt: pointsEntries.createdAt })
      .from(pointsEntries)
      .where(
        and(
          eq(pointsEntries.userId, userId),
          gte(pointsEntries.createdAt, businessDayStart(monday)),
          lt(pointsEntries.createdAt, businessDayEnd(sunday)),
        ),
      ),
    db.select().from(streaks).where(eq(streaks.userId, userId)),
  ]);

  const summary = buildWeeklySummary({
    week: monday,
    sendDay: today,
    entries: data.entries,
    closes: data.closes.map((close) => ({ businessDay: close.businessDay, level: close.level })),
    pointsEntries: points.map((row) => ({
      points: row.points,
      businessDay: businessDayOf(row.createdAt),
    })),
    streakDays: streak?.days ?? 0,
    freezesUsed: streak?.freezesUsed ?? 0,
  });
  const views = dayViewsFrom(data, week, now);
  return {
    weekStart: monday,
    weekEnd: sunday,
    label: weekLabel(monday, sunday),
    inCents: summary.indicators.inCents,
    outCents: summary.indicators.outCents,
    leftCents: summary.indicators.leftCents,
    digitalSalesCents: summary.indicators.digitalSalesCents,
    cashSalesCents: summary.indicators.cashSalesCents,
    pendingCents: summary.indicators.pendingCents,
    completeCount: summary.completeCount,
    partialCount: summary.partialCount,
    noCloseCount: summary.noCloseCount,
    pointsEarned: summary.pointsEarned,
    days: views.map((view) => ({
      businessDay: view.businessDay,
      weekday: weekdayName(view.businessDay),
      inCents: view.inCents,
      outCents: view.outCents,
      leftCents: view.leftCents,
      level: view.level,
      levelText: view.levelText,
      isToday: view.isToday,
      isFuture: view.businessDay > today,
    })),
  };
}

// ---------------------------------------------------------------------------
// Pendientes
// ---------------------------------------------------------------------------

export interface PendingItem {
  id: string;
  type: Clarification['type'];
  businessDay: IsoDate;
  /** «martes 10». */
  dayLabel: string;
  question: string;
  hint: string | null;
  options: PendingOption[];
  entry: EntryView | null;
}

/** Doubts she can resolve in the web, most recent day first, then by 11.8 priority. */
export async function listPending(db: Db, userId: string): Promise<PendingItem[]> {
  const rows = await db
    .select({
      clarification: clarifications,
      entry: ledgerEntries,
      message: {
        type: inboundMessages.type,
        text: inboundMessages.text,
        receivedAt: inboundMessages.receivedAt,
      },
    })
    .from(clarifications)
    .leftJoin(
      ledgerEntries,
      and(
        eq(ledgerEntries.id, clarifications.ledgerEntryId),
        eq(ledgerEntries.userId, clarifications.userId),
      ),
    )
    .leftJoin(
      inboundMessages,
      and(
        eq(inboundMessages.id, clarifications.inboundMessageId),
        eq(inboundMessages.userId, clarifications.userId),
      ),
    )
    .where(
      and(eq(clarifications.userId, userId), inArray(clarifications.status, PENDING_LIST_STATUSES)),
    )
    .orderBy(desc(clarifications.businessDay));

  const byDay = new Map<IsoDate, typeof rows>();
  for (const row of rows) {
    const list = byDay.get(row.clarification.businessDay) ?? [];
    list.push(row);
    byDay.set(row.clarification.businessDay, list);
  }
  const items: PendingItem[] = [];
  for (const [day, list] of byDay) {
    const candidates = list.map((row) => ({
      ...row,
      id: row.clarification.id,
      type: row.clarification.type,
      amountCents: row.entry?.amountCents ?? null,
      createdAt: row.clarification.createdAt,
    }));
    for (const row of sortClarifications(candidates)) {
      const message = row.message?.type ? row.message : null;
      const text = describeClarification(row.clarification, row.entry, message);
      items.push({
        id: row.clarification.id,
        type: row.clarification.type,
        businessDay: day,
        dayLabel: dayLabel(day),
        question: text.question,
        hint: text.hint ?? null,
        options: text.options,
        entry: row.entry ? toEntryView(row.entry) : null,
      });
    }
  }
  return items;
}

/** «Tienes 2 cosas por revisar» (12.2 Inicio). */
export function pendingNotice(count: number): string | null {
  if (count === 0) return null;
  return count === 1 ? 'Tienes 1 cosa por revisar' : `Tienes ${count} cosas por revisar`;
}

// ---------------------------------------------------------------------------
// Traceability of one entry (D16, HU-11)
// ---------------------------------------------------------------------------

export interface EntryHistory {
  /** Oldest first; the last one is the current version (live, unless it was removed). */
  versions: (EntryView & { createdAt: string; source: LedgerEntry['source'] })[];
  events: {
    entryId: string;
    event: string;
    actor: string;
    at: string;
    detail: unknown;
  }[];
}

/** The chain of versions an entry belongs to (via `replaces_entry_id`) and its events. */
export async function getEntryHistory(
  db: Db,
  userId: string,
  entryId: string,
): Promise<EntryHistory | null> {
  const load = async (where: SQL) => {
    const [row] = await db
      .select()
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.userId, userId), where));
    return row ?? null;
  };
  const start = await load(eq(ledgerEntries.id, entryId));
  if (!start) return null;

  const chain: LedgerEntry[] = [start];
  for (let current = start; current.replacesEntryId && chain.length < 100; ) {
    const previous = await load(eq(ledgerEntries.id, current.replacesEntryId));
    if (!previous) break;
    chain.unshift(previous);
    current = previous;
  }
  for (let current = start; chain.length < 100; ) {
    const next = await load(eq(ledgerEntries.replacesEntryId, current.id));
    if (!next) break;
    chain.push(next);
    current = next;
  }

  const ids = chain.map((entry) => entry.id);
  const events = await db
    .select()
    .from(ledgerEntryEvents)
    .where(inArray(ledgerEntryEvents.ledgerEntryId, ids))
    .orderBy(asc(ledgerEntryEvents.createdAt));
  return {
    versions: chain.map((entry) => ({
      ...toEntryView(entry),
      createdAt: entry.createdAt.toISOString(),
      source: entry.source,
    })),
    events: events.map((event) => ({
      entryId: event.ledgerEntryId,
      event: event.event,
      actor: event.actor,
      at: event.createdAt.toISOString(),
      detail: event.detail,
    })),
  };
}
