/**
 * Business time (D12, 11.1, RNF-10). Everything is in America/Lima, which is UTC−5 all year (no
 * daylight saving since 1994), so a fixed offset is exact and independent of the server's zone.
 * `time.test.ts` cross-checks the offset against Intl's tz database.
 *
 * - Business day: 4:00 a. m. to 3:59 a. m. of the next calendar day, as `YYYY-MM-DD`.
 * - Week: Monday 4:00 to the next Monday 3:59 (business days Monday–Sunday).
 * - Points deadline for day D: 12:00 of D+1.
 * - Close time: 04:00 to 02:00 (next calendar day), stored as minutes since 04:00.
 *
 * No function reads the clock: `now` is always a parameter.
 */
import type { IsoDate } from './types.js';

export const LIMA_UTC_OFFSET_MINUTES = -300;
export const BUSINESS_DAY_START_HOUR = 4;
/** Latest close time: 2:00 a. m., i.e. 22 h after the business day starts (D12). */
export const MAX_CLOSE_TIME_MINUTES = 22 * 60;
export const POINTS_DEADLINE_HOUR = 12;

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function dayToUtcMs(day: IsoDate): number {
  const match = ISO_DATE.exec(day);
  if (!match) throw new RangeError(`Invalid business day: ${day}`);
  const [, y, m, d] = match;
  const ms = Date.UTC(Number(y), Number(m) - 1, Number(d));
  if (new Date(ms).toISOString().slice(0, 10) !== day) {
    throw new RangeError(`Invalid business day: ${day}`);
  }
  return ms;
}

function utcMsToDay(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function isIsoDate(value: string): boolean {
  try {
    dayToUtcMs(value);
    return true;
  } catch {
    return false;
  }
}

/** Business day an instant belongs to (D12): an operation at 00:30 Sunday counts for Saturday. */
export function businessDayOf(instant: Date): IsoDate {
  const shift = (LIMA_UTC_OFFSET_MINUTES - BUSINESS_DAY_START_HOUR * 60) * MINUTE_MS;
  return utcMsToDay(instant.getTime() + shift);
}

/** The instant of Lima wall-clock time `hour:minute` on calendar date `day`. */
export function limaInstant(day: IsoDate, hour: number, minute = 0): Date {
  return new Date(
    dayToUtcMs(day) + hour * HOUR_MS + minute * MINUTE_MS - LIMA_UTC_OFFSET_MINUTES * MINUTE_MS,
  );
}

/** Lima wall clock of an instant (calendar date, hour, minute). */
export function limaWallClock(instant: Date): { date: IsoDate; hour: number; minute: number } {
  const shifted = new Date(instant.getTime() + LIMA_UTC_OFFSET_MINUTES * MINUTE_MS);
  return {
    date: utcMsToDay(shifted.getTime()),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

/** First instant of a business day (4:00 a. m. Lima). */
export function businessDayStart(day: IsoDate): Date {
  return limaInstant(day, BUSINESS_DAY_START_HOUR);
}

/** End of a business day, exclusive (4:00 a. m. Lima of the next calendar day). */
export function businessDayEnd(day: IsoDate): Date {
  return businessDayStart(addDays(day, 1));
}

export function addDays(day: IsoDate, days: number): IsoDate {
  return utcMsToDay(dayToUtcMs(day) + days * DAY_MS);
}

/** Calendar months, clamped to the end of the month (31 Aug + 6 months = 28/29 Feb). */
export function addMonths(day: IsoDate, months: number): IsoDate {
  const base = new Date(dayToUtcMs(day));
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return utcMsToDay(Date.UTC(year, month, Math.min(base.getUTCDate(), lastDay)));
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((dayToUtcMs(to) - dayToUtcMs(from)) / DAY_MS);
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(day: IsoDate): number {
  const weekday = new Date(dayToUtcMs(day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

export function isSunday(day: IsoDate): boolean {
  return isoWeekday(day) === 7;
}

/** Monday of the business week that contains `day`. */
export function weekStart(day: IsoDate): IsoDate {
  return addDays(day, 1 - isoWeekday(day));
}

/** The 7 business days (Monday–Sunday) of the week that contains `day`. */
export function weekDays(day: IsoDate): IsoDate[] {
  const monday = weekStart(day);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** ISO week of a business day, as `YYYY-Www` (the `streaks.iso_week` column). */
export function isoWeekOf(day: IsoDate): string {
  const thursday = addDays(day, 4 - isoWeekday(day));
  const year = Number(thursday.slice(0, 4));
  const week = Math.floor(daysBetween(`${year}-01-01`, thursday) / 7) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** 12:00 Lima of D+1: last moment to answer the close of `day` with points (D12). */
export function pointsDeadline(day: IsoDate): Date {
  return limaInstant(addDays(day, 1), POINTS_DEADLINE_HOUR);
}

/** True when `at` is strictly before the points deadline (11:50 → yes, 12:00 or later → no). */
export function isBeforePointsDeadline(day: IsoDate, at: Date): boolean {
  return at.getTime() < pointsDeadline(day).getTime();
}

/**
 * Parses a close time («21:00», «21:00:00», «1:30») into minutes since 4:00 a. m.
 * Valid from 04:00 to 02:00 (next calendar day). Returns null otherwise.
 */
export function parseCloseTime(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  const sinceStart = (hour * 60 + minute - BUSINESS_DAY_START_HOUR * 60 + 24 * 60) % (24 * 60);
  return sinceStart <= MAX_CLOSE_TIME_MINUTES ? sinceStart : null;
}

export function isValidCloseTime(value: string): boolean {
  return parseCloseTime(value) !== null;
}

/** Minutes since 4:00 a. m.; throws on an invalid close time. */
export function closeTimeMinutes(value: string): number {
  const minutes = parseCloseTime(value);
  if (minutes === null) throw new RangeError(`Invalid close time: ${value}`);
  return minutes;
}

/** Instant the close of `day` is due (a 1:00 a. m. close is due on the next calendar date). */
export function closeDueAt(day: IsoDate, closeTime: string): Date {
  return new Date(businessDayStart(day).getTime() + closeTimeMinutes(closeTime) * MINUTE_MS);
}

/** Compares two close times by their position in the business day (02:00 is after 22:00). */
export function compareCloseTimes(a: string, b: string): number {
  return closeTimeMinutes(a) - closeTimeMinutes(b);
}

/** True when `at` happened within the 24 hours before `now` (RF-CI-01, WhatsApp window). */
export function isWithinLast24Hours(at: Date | null, now: Date): boolean {
  if (at === null) return false;
  const elapsed = now.getTime() - at.getTime();
  return elapsed >= 0 && elapsed <= DAY_MS;
}
