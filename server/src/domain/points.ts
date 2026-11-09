/**
 * Points, streak and streak freezes (13.1, D19, D21, D29, HU-08).
 *
 * | Action                           | Points | When                    |
 * |----------------------------------|--------|-------------------------|
 * | Complete close                   | 10     | 12:00 of D+1            |
 * | Partial close                    | 4      | 12:00 of D+1            |
 * | Every 7 streak days              | +20    | days 7, 14, 21…         |
 * | Every 30 streak days             | +50    | days 30, 60…            |
 * | Week with ≥ 5 complete closes    | +15    | Monday 12:00            |
 * | First 7-day streak               | +30    | once                    |
 *
 * Freezes: 2 per ISO week, renewed on Monday, not accumulated, used automatically on a day without
 * close. A freeze day keeps the streak without adding a day or points. A partial close counts as a
 * streak day, so it never spends a freeze.
 */
import { addMonths, isoWeekOf } from './time.js';
import type { CloseLevel, IsoDate, PointsEntryType } from './types.js';

export const POINTS = {
  completeClose: 10,
  partialClose: 4,
  streak7: 20,
  streak30: 50,
  weeklyBonus: 15,
  firstStreak: 30,
} as const;

export const FREEZES_PER_WEEK = 2;
export const WEEKLY_BONUS_MIN_COMPLETE = 5;
export const POINTS_EXPIRY_MONTHS = 6;

/** Mirrors the `streaks` table. `isoWeek` is null before the first close. */
export interface StreakState {
  days: number;
  isoWeek: string | null;
  freezesUsed: number;
  firstStreakAwarded: boolean;
}

export const INITIAL_STREAK: StreakState = {
  days: 0,
  isoWeek: null,
  freezesUsed: 0,
  firstStreakAwarded: false,
};

export interface PointsAward {
  type: PointsEntryType;
  points: number;
}

export interface DailyPointsResult {
  state: StreakState;
  awards: PointsAward[];
  /** Total of `awards`. */
  points: number;
  freezeUsed: boolean;
  streakBroken: boolean;
}

/** Applies the final level of day D at 12:00 of D+1 (13.1 pseudo-code, line by line). */
export function applyDailyClose(
  state: StreakState,
  day: IsoDate,
  level: CloseLevel,
): DailyPointsResult {
  const week = isoWeekOf(day);
  const next: StreakState =
    state.isoWeek === week ? { ...state } : { ...state, isoWeek: week, freezesUsed: 0 };
  const awards: PointsAward[] = [];
  let freezeUsed = false;
  let streakBroken = false;

  if (level === 'complete') {
    awards.push({ type: 'complete_close', points: POINTS.completeClose });
    next.days += 1;
  } else if (level === 'partial') {
    awards.push({ type: 'partial_close', points: POINTS.partialClose });
    next.days += 1;
  } else if (next.freezesUsed < FREEZES_PER_WEEK) {
    next.freezesUsed += 1;
    freezeUsed = true;
  } else {
    streakBroken = next.days > 0;
    next.days = 0;
  }

  if (level !== 'no_close') {
    if (next.days % 7 === 0) awards.push({ type: 'streak_7', points: POINTS.streak7 });
    if (next.days % 30 === 0) awards.push({ type: 'streak_30', points: POINTS.streak30 });
    if (next.days === 7 && !next.firstStreakAwarded) {
      awards.push({ type: 'first_streak', points: POINTS.firstStreak });
      next.firstStreakAwarded = true;
    }
  }

  return {
    state: next,
    awards,
    points: awards.reduce((total, award) => total + award.points, 0),
    freezeUsed,
    streakBroken,
  };
}

/** Monday 12:00: +15 if the previous week (Monday–Sunday, all final) had ≥ 5 complete closes. */
export function weeklyBonus(levels: readonly CloseLevel[]): PointsAward | null {
  const complete = levels.filter((level) => level === 'complete').length;
  return complete >= WEEKLY_BONUS_MIN_COMPLETE
    ? { type: 'weekly_bonus', points: POINTS.weeklyBonus }
    : null;
}

/** Balance = sum of all points entries (earned positive, redeemed/expired negative). */
export function pointsBalance(entries: readonly { points: number }[]): number {
  return entries.reduce((total, entry) => total + entry.points, 0);
}

/**
 * D29: if 6 months pass without any close (complete or partial), the balance expires. Any close
 * restarts the term. Returns the `expiration` entry to record, or null. `lastCloseDay` falls back
 * to `sinceDay` (e.g. the account's first day) when she never closed.
 */
export function pointsExpiration(input: {
  balance: number;
  lastCloseDay: IsoDate | null;
  sinceDay: IsoDate;
  today: IsoDate;
}): PointsAward | null {
  if (input.balance <= 0) return null;
  const expiresOn = addMonths(input.lastCloseDay ?? input.sinceDay, POINTS_EXPIRY_MONTHS);
  return input.today >= expiresOn ? { type: 'expiration', points: -input.balance } : null;
}
