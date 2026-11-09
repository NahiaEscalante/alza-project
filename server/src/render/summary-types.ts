/**
 * Input of the summary image (8.6). Mirrors `resumen` of the close composition (10.3) with the
 * code names of `Indicators` (11.6), so `computeIndicators()` can be passed as it is, plus the
 * points (13.2) and, on Sunday, the week (11.11, D38).
 *
 * By construction it carries no client names and no doubts (8.6, 9.1 of the insumos).
 */
import type { Indicators, IsoDate, WeeklyComparison, WeeklySummary } from '../domain/index.js';

/** `resumen` of 10.3 (cents). Optional fields default to 0. */
export type SummaryFigures = Pick<
  Indicators,
  | 'inCents'
  | 'digitalSalesCents'
  | 'cashSalesCents'
  | 'outCents'
  | 'inventoryCents'
  | 'expensesCents'
  | 'householdCents'
  | 'leftCents'
> &
  Partial<Pick<Indicators, 'unknownMethodSalesCents' | 'unclassifiedCents' | 'pendingCents'>>;

export interface SummaryPoints {
  balance: number;
  /** «Te faltan X para {premio}» (`nextRewardHint` / `PointsSummary.nextReward`); null hides it. */
  nextReward: { name: string; missingPoints: number } | null;
}

/** Sunday block (11.11): amounts Monday–Sunday, close levels Monday–Saturday (D38). */
export interface SummaryWeek {
  weekStart: IsoDate;
  weekEnd: IsoDate;
  inCents: number;
  outCents: number;
  leftCents: number;
  completeCount: number;
  partialCount: number;
  noCloseCount: number;
  pointsEarned: number;
  streakDays: number;
  freezesUsed: number;
  /** Optional mini chart: what entered each day, Monday to Sunday. */
  days?: { businessDay: IsoDate; inCents: number }[];
  /** PR02. Omitted: no comparison line. */
  comparison?: WeeklyComparison;
}

export interface SummaryImageData {
  businessDay: IsoDate;
  businessName: string | null;
  summary: SummaryFigures;
  points: SummaryPoints;
  /** Present on Sunday (or the first close after a Sunday without close). */
  week?: SummaryWeek | null;
}

/** Builds the Sunday block from the domain's weekly summary. */
export function summaryWeekFrom(
  summary: WeeklySummary,
  extra: Pick<SummaryWeek, 'days' | 'comparison'> = {},
): SummaryWeek {
  return {
    weekStart: summary.weekStart,
    weekEnd: summary.weekEnd,
    inCents: summary.indicators.inCents,
    outCents: summary.indicators.outCents,
    leftCents: summary.indicators.leftCents,
    completeCount: summary.completeCount,
    partialCount: summary.partialCount,
    noCloseCount: summary.noCloseCount,
    pointsEarned: summary.pointsEarned,
    streakDays: summary.streakDays,
    freezesUsed: summary.freezesUsed,
    ...extra,
  };
}
