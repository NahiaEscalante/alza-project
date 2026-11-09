/**
 * Calendar math for the scheduled tasks (D12, 8.4), on top of `domain/time.ts`. Pure: `now` is a
 * parameter.
 */
import { addDays, addMonths, type IsoDate, limaInstant, limaWallClock } from '../domain/index.js';

/**
 * Latest business day whose points deadline (12:00 of D+1) has passed at `now`: at 12:00 of
 * Tuesday it is Monday; at 11:59 of Tuesday (or at 02:00, still Monday's business day) it is
 * Sunday.
 */
export function lastFinalizableDay(now: Date): IsoDate {
  const { date } = limaWallClock(now);
  return now.getTime() >= limaInstant(date, 12).getTime() ? addDays(date, -1) : addDays(date, -2);
}

/** The same Lima wall-clock minute `months` calendar months earlier (clamped to month end). */
export function monthsBefore(now: Date, months: number): Date {
  const { date, hour, minute } = limaWallClock(now);
  return limaInstant(addMonths(date, -months), hour, minute);
}

/** Every day from `from` to `to`, both included (empty when `from > to`). */
export function daysFromTo(from: IsoDate, to: IsoDate): IsoDate[] {
  const days: IsoDate[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}
