/**
 * Weekly summary (11.11, D11, D38, PR02, HU-06).
 *
 * - Goes inside Sunday's close; if there is no close that Sunday, inside the next one.
 * - Amounts add up Monday–Sunday. Close levels count only days already final: every day of the
 *   week before the day the summary is sent (on Sunday that is Monday–Saturday, D38; if it goes
 *   out later, all 7).
 * - Comparison with the previous week only if both have ≥ 4 complete closes (PR02). Build the
 *   previous week with `sendDay − 7` so both weeks count the same days.
 */
import { computeIndicators, type IndicatorEntry, type Indicators } from './indicators.js';
import { addDays, weekDays } from './time.js';
import type { CloseLevel, IsoDate, LedgerEntryView } from './types.js';

export const MIN_COMPLETE_CLOSES_TO_COMPARE = 4;
export const NO_COMPARISON_TEXT = 'Esta semana no comparo porque faltaron cierres completos';

export type WeeklyEntry = IndicatorEntry & Pick<LedgerEntryView, 'businessDay'>;

export interface WeeklySummary {
  weekStart: IsoDate;
  weekEnd: IsoDate;
  indicators: Indicators;
  /** Days whose level was counted (final at send time). */
  countedDays: IsoDate[];
  completeCount: number;
  partialCount: number;
  noCloseCount: number;
  /** Positive points entries created during the week (earned, not redeemed). */
  pointsEarned: number;
  streakDays: number;
  freezesUsed: number;
}

export function buildWeeklySummary(input: {
  /** Any day of the week to summarize. */
  week: IsoDate;
  /** Business day the summary is sent (Sunday, or the first close after it). */
  sendDay: IsoDate;
  entries: readonly WeeklyEntry[];
  /** Final level per day; days without a row count as `no_close` (11.9). */
  closes: readonly { businessDay: IsoDate; level: CloseLevel | null }[];
  /** Points entries with the business day they were created on. */
  pointsEntries?: readonly { points: number; businessDay: IsoDate }[];
  streakDays?: number;
  freezesUsed?: number;
}): WeeklySummary {
  const days = weekDays(input.week);
  const weekStart = days[0] as IsoDate;
  const weekEnd = days[6] as IsoDate;
  const inWeek = (day: IsoDate) => day >= weekStart && day <= weekEnd;

  const countedDays = days.filter((day) => day < input.sendDay);
  const levelOf = new Map(input.closes.map((close) => [close.businessDay, close.level]));
  const levels = countedDays.map((day) => levelOf.get(day) ?? 'no_close');

  return {
    weekStart,
    weekEnd,
    indicators: computeIndicators(input.entries.filter((entry) => inWeek(entry.businessDay))),
    countedDays,
    completeCount: levels.filter((level) => level === 'complete').length,
    partialCount: levels.filter((level) => level === 'partial').length,
    noCloseCount: levels.filter((level) => level === 'no_close').length,
    pointsEarned: (input.pointsEntries ?? [])
      .filter((entry) => entry.points > 0 && inWeek(entry.businessDay))
      .reduce((total, entry) => total + entry.points, 0),
    streakDays: input.streakDays ?? 0,
    freezesUsed: input.freezesUsed ?? 0,
  };
}

export type WeeklyComparison =
  | { comparable: true; inDeltaCents: number; outDeltaCents: number; leftDeltaCents: number }
  | { comparable: false; text: typeof NO_COMPARISON_TEXT };

export function compareWeeks(
  current: WeeklySummary,
  previous: WeeklySummary | null,
): WeeklyComparison {
  if (
    previous === null ||
    current.completeCount < MIN_COMPLETE_CLOSES_TO_COMPARE ||
    previous.completeCount < MIN_COMPLETE_CLOSES_TO_COMPARE
  ) {
    return { comparable: false, text: NO_COMPARISON_TEXT };
  }
  return {
    comparable: true,
    inDeltaCents: current.indicators.inCents - previous.indicators.inCents,
    outDeltaCents: current.indicators.outCents - previous.indicators.outCents,
    leftDeltaCents: current.indicators.leftCents - previous.indicators.leftCents,
  };
}

/**
 * Whether today's close carries the weekly block: on Sunday, or on the first close after a Sunday
 * that had no close. `lastSummaryWeekStart` is the Monday of the last week already summarized.
 */
export function pendingWeeklySummaryWeek(input: {
  closeDay: IsoDate;
  lastSummaryWeekStart: IsoDate | null;
}): IsoDate | null {
  const thisWeek = weekDays(input.closeDay);
  const monday = thisWeek[0] as IsoDate;
  if (input.closeDay === thisWeek[6]) {
    return input.lastSummaryWeekStart === monday ? null : monday;
  }
  const previousMonday = addDays(monday, -7);
  if (input.lastSummaryWeekStart === null) return null;
  return input.lastSummaryWeekStart < previousMonday ? previousMonday : null;
}
