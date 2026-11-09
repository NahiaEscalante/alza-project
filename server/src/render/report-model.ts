/**
 * The report's content (5.10, 4.8, HU-14) as plain data, built from ledger rows without touching
 * the database, so the PDF and the Excel show the same figures.
 *
 * - Totals follow 11.6 (`computeIndicators`): only confirmed entries, never personal or internal.
 * - Tags (RF-RP-02, PR12): «Con captura», «Lo contaste tú», «Caja sin revisar», «Por confirmar».
 * - Clients only as initials (RF-RP-04, PR04): no full counterparty name leaves this module.
 * - Traceability (RF-RP-03): every version of every entry, its origin and its events.
 */
import type {
  CashCheckResult,
  Category,
  CloseLevel,
  DailyClose,
  Direction,
  LedgerEntry,
  LedgerEntryEventRow,
  LedgerEntrySource,
  LedgerEntryStatus,
  LedgerLabel,
  PaymentMethod,
} from '../db/schema.js';
import {
  addDays,
  businessDayOf,
  computeIndicators,
  formatSoles,
  type Indicators,
  type IsoDate,
  isBeforePointsDeadline,
  isCashVerified,
  isExcludedFromTotals,
  weekStart,
} from '../domain/index.js';
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
} from '../ledger/labels.js';
import { effectiveLevel } from '../ledger/queries.js';
import { formatDateTime, initials } from './format.js';
import {
  actorText,
  CASH_CHECK_TEXT,
  CHANGE_TEXT,
  type ChangeKind,
  EVENT_TEXT,
  PERIOD_TEXT,
  type ReportPeriod,
  reasonText,
  SOURCE_TEXT,
  STATUS_TEXT,
} from './report-texts.js';

export interface ReportEntry {
  /** Short reference shared by every sheet («3F2A9C1B»). */
  ref: string;
  businessDay: IsoDate;
  /** «14:05» (Lima) or null. */
  time: string | null;
  direction: Direction;
  directionText: string;
  paymentMethod: PaymentMethod;
  paymentMethodText: string;
  category: Category;
  categoryText: string;
  /** PR04: «R. M.», never the full name. */
  counterpartyInitials: string | null;
  amountCents: number;
  label: LedgerLabel;
  labelText: string;
  status: LedgerEntryStatus;
  statusText: string;
  /** Counts in entró/salió (11.6). */
  countsInTotals: boolean;
  afterClose: boolean;
  /** PR12 tags: label, «Por confirmar», «Agregado después del cierre». */
  tags: string[];
  source: LedgerEntrySource;
  sourceText: string;
}

export interface ReportDay {
  businessDay: IsoDate;
  /** «martes 10». */
  label: string;
  inCents: number;
  digitalSalesCents: number;
  cashSalesCents: number;
  outCents: number;
  leftCents: number;
  pendingCents: number;
  level: CloseLevel | null;
  /** «completo», «a medias», «sin cierre». */
  levelText: string | null;
  cashCheck: CashCheckResult | null;
  cashCheckText: string | null;
  /** «Caja sin revisar» (11.3). */
  cashUnreviewed: boolean;
  expectedCashChangeCents: number | null;
  sentAt: Date | null;
  repliedAt: Date | null;
  entryCount: number;
  tags: string[];
}

export interface ReportChartBucket {
  /** «9 nov» (week) or «nov 2026» (month). */
  label: string;
  inCents: number;
  outCents: number;
  leftCents: number;
}

export interface ReportOriginRow {
  /** «Entró», «Salió». */
  figure: string;
  screenshotCents: number;
  screenshotCount: number;
  selfReportedCents: number;
  selfReportedCount: number;
  unitemizedCents: number;
  unitemizedCount: number;
  totalCents: number;
}

export interface ReportChange {
  at: Date;
  businessDay: IsoDate;
  kind: ChangeKind;
  kindText: string;
  ref: string;
  /** «S/ 12 · Venta», or null when nothing was there before. */
  before: string | null;
  after: string | null;
  /** Ref. of the entry that replaced this one (corrections). */
  afterRef: string | null;
  actorText: string;
  reasonText: string | null;
}

export interface ReportTraceRow {
  ref: string;
  businessDay: IsoDate;
  amountCents: number;
  directionText: string;
  paymentMethodText: string;
  categoryText: string;
  sourceText: string;
  labelText: string;
  status: LedgerEntryStatus;
  statusText: string;
  replacesRef: string | null;
  replacedByRef: string | null;
  createdAt: Date;
  createdByText: string;
  /** Oldest first. */
  events: { at: Date; text: string; actorText: string }[];
  /** «10/11/2026 14:05 Anotado (ALZA) · 11/11/2026 09:12 Reemplazado (Tú, en la web)». */
  history: string;
}

export interface ReportData {
  period: ReportPeriod;
  periodText: string;
  from: IsoDate;
  to: IsoDate;
  generatedAt: Date;
  businessName: string | null;
  totals: Indicators;
  counts: {
    complete: number;
    partial: number;
    noClose: number;
    cashUnreviewed: number;
    activeDays: number;
    entries: number;
  };
  /** Days with activity, oldest first. */
  days: ReportDay[];
  chart: { granularity: 'week' | 'month'; buckets: ReportChartBucket[] };
  /** Live entries (confirmed and por confirmar), oldest first. */
  entries: ReportEntry[];
  origins: ReportOriginRow[];
  /** Personal or internal entries: recorded, but never in the totals. */
  excludedCents: number;
  changes: ReportChange[];
  /** Every version of every entry in the period. */
  trace: ReportTraceRow[];
}

export interface ReportRows {
  period: ReportPeriod;
  from: IsoDate;
  to: IsoDate;
  now: Date;
  businessName: string | null;
  /** Every entry of the period, any status. */
  entries: readonly LedgerEntry[];
  events: readonly LedgerEntryEventRow[];
  closes: readonly DailyClose[];
}

/** Weeks Monday–Sunday (11.1): «4 semanas» is this week and the 3 before, up to today. */
export function reportRange(
  period: ReportPeriod,
  now: Date,
  firstDay: IsoDate | null,
): { from: IsoDate; to: IsoDate } {
  const to = businessDayOf(now);
  if (period === 'all') return { from: firstDay && firstDay < to ? firstDay : to, to };
  const weeks = period === '4_weeks' ? 4 : 12;
  return { from: addDays(weekStart(to), -7 * (weeks - 1)), to };
}

/** Last 8 hex digits of the entry id: short enough to read, the same in the PDF and the Excel. */
export function entryRef(id: string): string {
  return id.replace(/-/g, '').slice(-8).toUpperCase();
}

const LIVE: readonly LedgerEntryStatus[] = ['confirmed', 'pending'];

function byTime(a: LedgerEntry, b: LedgerEntry): number {
  return (
    a.businessDay.localeCompare(b.businessDay) ||
    (a.operationAt ?? a.createdAt).getTime() - (b.operationAt ?? b.createdAt).getTime() ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    a.id.localeCompare(b.id)
  );
}

function entryTime(entry: LedgerEntry): string | null {
  if (entry.operationAt) return formatTime24(entry.operationAt);
  return businessDayOf(entry.createdAt) === entry.businessDay
    ? formatTime24(entry.createdAt)
    : null;
}

function toReportEntry(entry: LedgerEntry): ReportEntry {
  const tags: string[] = [LABEL_TEXT[entry.label]];
  if (entry.status === 'pending') tags.push(PENDING_TAG);
  if (entry.afterClose) tags.push(AFTER_CLOSE_TAG);
  return {
    ref: entryRef(entry.id),
    businessDay: entry.businessDay,
    time: entryTime(entry),
    direction: entry.direction,
    directionText: DIRECTION_TEXT[entry.direction],
    paymentMethod: entry.paymentMethod,
    paymentMethodText: METHOD_TEXT[entry.paymentMethod],
    category: entry.category,
    categoryText: CATEGORY_TEXT[entry.category],
    counterpartyInitials: initials(entry.counterparty),
    amountCents: entry.amountCents,
    label: entry.label,
    labelText: LABEL_TEXT[entry.label],
    status: entry.status,
    statusText: STATUS_TEXT[entry.status],
    countsInTotals: entry.status === 'confirmed' && !isExcludedFromTotals(entry.category),
    afterClose: entry.afterClose,
    tags,
    source: entry.source,
    sourceText: SOURCE_TEXT[entry.source],
  };
}

function buildDay(
  day: IsoDate,
  entries: readonly LedgerEntry[],
  close: DailyClose | undefined,
  now: Date,
): ReportDay {
  const indicators = computeIndicators(entries);
  const level = effectiveLevel(day, close, true, now);
  const cashUnreviewed =
    close !== undefined &&
    close.sentAt !== null &&
    !isCashVerified(close.cashCheck) &&
    (close.repliedAt !== null || !isBeforePointsDeadline(day, now));
  return {
    businessDay: day,
    label: dayLabel(day),
    inCents: indicators.inCents,
    digitalSalesCents: indicators.digitalSalesCents,
    cashSalesCents: indicators.cashSalesCents,
    outCents: indicators.outCents,
    leftCents: indicators.leftCents,
    pendingCents: indicators.pendingCents,
    level,
    levelText: level ? LEVEL_TEXT[level] : null,
    cashCheck: close?.cashCheck ?? null,
    cashCheckText: close?.cashCheck ? CASH_CHECK_TEXT[close.cashCheck] : null,
    cashUnreviewed,
    expectedCashChangeCents: close?.expectedCashChangeCents ?? null,
    sentAt: close?.sentAt ?? null,
    repliedAt: close?.repliedAt ?? null,
    entryCount: entries.length,
    tags: cashUnreviewed ? [CASH_UNREVIEWED_TAG] : [],
  };
}

const SHORT_MONTHS = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'set',
  'oct',
  'nov',
  'dic',
];

/** Weekly bars up to 26 weeks; monthly beyond (period «todo»). */
function buildChart(from: IsoDate, to: IsoDate, live: readonly LedgerEntry[]): ReportData['chart'] {
  const firstMonday = weekStart(from);
  const weeks: IsoDate[] = [];
  for (let monday = firstMonday; monday <= to; monday = addDays(monday, 7)) weeks.push(monday);
  const bucket = (label: string, list: readonly LedgerEntry[]): ReportChartBucket => {
    const indicators = computeIndicators(list);
    return {
      label,
      inCents: indicators.inCents,
      outCents: indicators.outCents,
      leftCents: indicators.leftCents,
    };
  };
  if (weeks.length <= 26) {
    return {
      granularity: 'week',
      buckets: weeks.map((monday) => {
        const sunday = addDays(monday, 6);
        return bucket(
          `${Number(monday.slice(8, 10))} ${SHORT_MONTHS[Number(monday.slice(5, 7)) - 1]}`,
          live.filter((entry) => entry.businessDay >= monday && entry.businessDay <= sunday),
        );
      }),
    };
  }
  const months: string[] = [];
  for (let month = from.slice(0, 7); month <= to.slice(0, 7); ) {
    months.push(month);
    const [y, m] = month.split('-').map(Number) as [number, number];
    month = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  }
  return {
    granularity: 'month',
    buckets: months.map((month) =>
      bucket(
        `${SHORT_MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(2, 4)}`,
        live.filter((entry) => entry.businessDay.startsWith(month)),
      ),
    ),
  };
}

function buildOrigins(live: readonly LedgerEntry[]): ReportOriginRow[] {
  const counted = live.filter(
    (entry) => entry.status === 'confirmed' && !isExcludedFromTotals(entry.category),
  );
  const row = (figure: string, list: readonly LedgerEntry[]): ReportOriginRow => {
    const by = (label: LedgerLabel) => list.filter((entry) => entry.label === label);
    const sum = (rows: readonly LedgerEntry[]) =>
      rows.reduce((total, entry) => total + entry.amountCents, 0);
    return {
      figure,
      screenshotCents: sum(by('screenshot')),
      screenshotCount: by('screenshot').length,
      selfReportedCents: sum(by('self_reported')),
      selfReportedCount: by('self_reported').length,
      unitemizedCents: sum(by('unitemized')),
      unitemizedCount: by('unitemized').length,
      totalCents: sum(list),
    };
  };
  return [
    row(
      'Entró',
      counted.filter((entry) => entry.direction === 'in' && entry.category === 'sale'),
    ),
    row(
      'Salió',
      counted.filter((entry) => entry.direction === 'out'),
    ),
  ];
}

function describe(entry: LedgerEntry): string {
  return `${formatSoles(entry.amountCents)} · ${CATEGORY_TEXT[entry.category]}`;
}

function eventReason(event: LedgerEntryEventRow | undefined): string | null {
  const detail = (event?.detail ?? null) as { reason?: unknown } | null;
  return reasonText(detail?.reason);
}

function buildChanges(
  entries: readonly LedgerEntry[],
  eventsByEntry: Map<string, LedgerEntryEventRow[]>,
): ReportChange[] {
  const replacementOf = new Map<string, LedgerEntry>();
  for (const entry of entries) {
    if (entry.replacesEntryId) replacementOf.set(entry.replacesEntryId, entry);
  }
  const eventOf = (entryId: string, event: LedgerEntryEventRow['event']) =>
    (eventsByEntry.get(entryId) ?? []).find((row) => row.event === event);

  const changes: ReportChange[] = [];
  const push = (
    kind: ChangeKind,
    entry: LedgerEntry,
    at: Date,
    before: string | null,
    after: string | null,
    actor: string | null | undefined,
    reason: string | null,
    afterRef: string | null = null,
  ) =>
    changes.push({
      at,
      businessDay: entry.businessDay,
      kind,
      kindText: CHANGE_TEXT[kind],
      ref: entryRef(entry.id),
      before,
      after,
      afterRef,
      actorText: actorText(actor),
      reasonText: reason,
    });

  for (const entry of entries) {
    const created = eventOf(entry.id, 'created');
    if (entry.status === 'superseded') {
      const next = replacementOf.get(entry.id);
      const superseded = eventOf(entry.id, 'superseded');
      push(
        'correction',
        entry,
        superseded?.createdAt ?? next?.createdAt ?? entry.createdAt,
        describe(entry),
        next ? describe(next) : null,
        superseded?.actor,
        eventReason(superseded) ?? eventReason(next && eventOf(next.id, 'created')),
        next ? entryRef(next.id) : null,
      );
    } else if (entry.status === 'voided') {
      const voided = eventOf(entry.id, 'voided');
      push(
        'voided',
        entry,
        voided?.createdAt ?? entry.createdAt,
        describe(entry),
        null,
        voided?.actor,
        eventReason(voided),
      );
    }
    if (!LIVE.includes(entry.status) || entry.replacesEntryId) continue;
    const reason = (created?.detail as { reason?: unknown } | null)?.reason;
    if (entry.label === 'unitemized') {
      push('unitemized', entry, entry.createdAt, null, describe(entry), created?.actor, null);
    } else if (entry.afterClose) {
      push('afterClose', entry, entry.createdAt, null, describe(entry), created?.actor, null);
    } else if (reason === 'added_past_day') {
      push('pastDay', entry, entry.createdAt, null, describe(entry), created?.actor, null);
    }
  }
  return changes.sort((a, b) => a.at.getTime() - b.at.getTime() || a.ref.localeCompare(b.ref));
}

function buildTrace(
  entries: readonly LedgerEntry[],
  eventsByEntry: Map<string, LedgerEntryEventRow[]>,
): ReportTraceRow[] {
  const replacementOf = new Map<string, string>();
  for (const entry of entries) {
    if (entry.replacesEntryId) replacementOf.set(entry.replacesEntryId, entry.id);
  }
  return [...entries].sort(byTime).map((entry) => {
    const events = (eventsByEntry.get(entry.id) ?? []).map((event) => ({
      at: event.createdAt,
      text: EVENT_TEXT[event.event],
      actorText: actorText(event.actor),
    }));
    const createdBy = (eventsByEntry.get(entry.id) ?? []).find((row) => row.event === 'created');
    const replacedBy = replacementOf.get(entry.id);
    return {
      ref: entryRef(entry.id),
      businessDay: entry.businessDay,
      amountCents: entry.amountCents,
      directionText: DIRECTION_TEXT[entry.direction],
      paymentMethodText: METHOD_TEXT[entry.paymentMethod],
      categoryText: CATEGORY_TEXT[entry.category],
      sourceText: SOURCE_TEXT[entry.source],
      labelText: LABEL_TEXT[entry.label],
      status: entry.status,
      statusText: STATUS_TEXT[entry.status],
      replacesRef: entry.replacesEntryId ? entryRef(entry.replacesEntryId) : null,
      replacedByRef: replacedBy ? entryRef(replacedBy) : null,
      createdAt: entry.createdAt,
      createdByText: createdBy
        ? actorText(createdBy.actor)
        : entry.createdBy === 'user'
          ? 'Tú'
          : entry.createdBy === 'admin'
            ? 'Equipo de ALZA'
            : 'ALZA',
      events,
      history: events
        .map((event) => `${formatDateTime(event.at)} ${event.text} (${event.actorText})`)
        .join(' · '),
    };
  });
}

/** Builds the report from the rows of one user and period. Pure: same rows, same report. */
export function buildReportData(rows: ReportRows): ReportData {
  const inRange = (day: IsoDate) => day >= rows.from && day <= rows.to;
  const all = rows.entries.filter((entry) => inRange(entry.businessDay));
  const live = all.filter((entry) => LIVE.includes(entry.status)).sort(byTime);

  const eventsByEntry = new Map<string, LedgerEntryEventRow[]>();
  for (const event of [...rows.events].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  )) {
    const list = eventsByEntry.get(event.ledgerEntryId) ?? [];
    list.push(event);
    eventsByEntry.set(event.ledgerEntryId, list);
  }

  const closes = rows.closes.filter((close) => inRange(close.businessDay));
  const activeDays = [
    ...new Set([...live.map((entry) => entry.businessDay), ...closes.map((c) => c.businessDay)]),
  ].sort();
  const days = activeDays.map((day) =>
    buildDay(
      day,
      live.filter((entry) => entry.businessDay === day),
      closes.find((close) => close.businessDay === day),
      rows.now,
    ),
  );

  return {
    period: rows.period,
    periodText: PERIOD_TEXT[rows.period],
    from: rows.from,
    to: rows.to,
    generatedAt: rows.now,
    businessName: rows.businessName?.trim() || null,
    totals: computeIndicators(live),
    counts: {
      complete: days.filter((day) => day.level === 'complete').length,
      partial: days.filter((day) => day.level === 'partial').length,
      noClose: days.filter((day) => day.level === 'no_close').length,
      cashUnreviewed: days.filter((day) => day.cashUnreviewed).length,
      activeDays: days.length,
      entries: live.length,
    },
    days,
    chart: buildChart(rows.from, rows.to, live),
    entries: live.map(toReportEntry),
    origins: buildOrigins(live),
    excludedCents: live
      .filter((entry) => entry.status === 'confirmed' && isExcludedFromTotals(entry.category))
      .reduce((total, entry) => total + entry.amountCents, 0),
    changes: buildChanges(all, eventsByEntry),
    trace: buildTrace(all, eventsByEntry),
  };
}

/** «del 19 oct al 15 nov de 2026», «del 3 al 15 nov de 2026», «del 28 dic de 2025 al 4 ene de 2026». */
export function rangeText(from: IsoDate, to: IsoDate): string {
  const part = (day: IsoDate) => ({
    d: Number(day.slice(8, 10)),
    m: SHORT_MONTHS[Number(day.slice(5, 7)) - 1] as string,
    y: day.slice(0, 4),
  });
  const a = part(from);
  const b = part(to);
  const end = `${b.d} ${b.m} de ${b.y}`;
  if (a.y !== b.y) return `del ${a.d} ${a.m} de ${a.y} al ${end}`;
  if (a.m !== b.m) return `del ${a.d} ${a.m} al ${end}`;
  if (a.d !== b.d) return `del ${a.d} al ${end}`;
  return `el ${end}`;
}
