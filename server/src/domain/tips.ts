/**
 * Screenshot tip (WA-19, D28, D42, RF-IN-07, case 28): after 3 unreadable screenshots in a row,
 * during her first 2 weeks, at most once per business day.
 */
import { businessDayOf, DAY_MS } from './time.js';

export const UNREADABLE_STREAK_FOR_TIP = 3;
export const TIP_PERIOD_MS = 14 * DAY_MS;

export function shouldSendUnreadableTip(input: {
  /** Unreadable screenshots in a row, counting the current one. */
  consecutiveUnreadable: number;
  userCreatedAt: Date;
  lastTipSentAt: Date | null;
  now: Date;
}): boolean {
  if (input.consecutiveUnreadable < UNREADABLE_STREAK_FOR_TIP) return false;
  if (input.now.getTime() - input.userCreatedAt.getTime() >= TIP_PERIOD_MS) return false;
  if (input.lastTipSentAt && businessDayOf(input.lastTipSentAt) === businessDayOf(input.now)) {
    return false;
  }
  return true;
}
