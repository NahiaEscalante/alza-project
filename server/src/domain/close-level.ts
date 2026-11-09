/**
 * Close levels and when a close is sent (11.9, D07, D17, PR10, PR16, D39, D49, RF-CI-01/02/03).
 */
import { isCashVerified, MAX_CLARIFICATION_ROUNDS } from './cash-check.js';
import { businessDayOf, closeDueAt, isBeforePointsDeadline, isWithinLast24Hours } from './time.js';
import type { CashCheckResult, CloseLevel, DailyCloseStatus, IsoDate } from './types.js';

/**
 * Level after applying her reply (or after 2 clarification rounds): complete when every numbered
 * doubt of the message is resolved and the cash is verified; partial otherwise. Doubts that went
 * to the web do not count (PR10).
 */
export function closeLevelAfterReply(input: {
  messageClarificationsResolved: boolean;
  cashCheck: CashCheckResult | null;
}): Exclude<CloseLevel, 'no_close'> {
  return input.messageClarificationsResolved && isCashVerified(input.cashCheck)
    ? 'complete'
    : 'partial';
}

/**
 * Level at 12:00 of D+1 (the close becomes final). No close message, or no reply in time →
 * `no_close`. Otherwise the level of her reply (still waiting for a clarification counts with what
 * was resolved so far).
 */
export function finalCloseLevel(input: {
  closeSent: boolean;
  repliedInTime: boolean;
  messageClarificationsResolved: boolean;
  cashCheck: CashCheckResult | null;
}): CloseLevel {
  if (!input.closeSent || !input.repliedInTime) return 'no_close';
  return closeLevelAfterReply(input);
}

const LEVEL_RANK: Record<CloseLevel, number> = { no_close: 0, partial: 1, complete: 2 };

export function isBetterLevel(candidate: CloseLevel, than: CloseLevel): boolean {
  return LEVEL_RANK[candidate] > LEVEL_RANK[than];
}

/**
 * D17: after 12:00 a day can improve (late reply, or resolving Pendientes in the web) but points
 * never change. Returns the new `improved_level`, or null when it is not an improvement over both
 * the final level and the previous improved level.
 */
export function improvedLevel(input: {
  finalLevel: CloseLevel;
  currentImprovedLevel: CloseLevel | null;
  newLevel: CloseLevel;
}): CloseLevel | null {
  const best = input.currentImprovedLevel ?? input.finalLevel;
  const reference = isBetterLevel(best, input.finalLevel) ? best : input.finalLevel;
  return isBetterLevel(input.newLevel, reference) ? input.newLevel : null;
}

/** Case 19 / 20: a reply before 12:00 of D+1 earns points; after, WA-18 and no points. */
export function closeReplyTiming(day: IsoDate, at: Date): 'on_time' | 'late' {
  return isBeforePointsDeadline(day, at) ? 'on_time' : 'late';
}

/** PR16: a close is only sent if the day has at least one entry or one doubt. */
export function hasCloseActivity(input: {
  entryCount: number;
  clarificationCount: number;
}): boolean {
  return input.entryCount > 0 || input.clarificationCount > 0;
}

export type ScheduledCloseDecision =
  | 'send'
  | 'not_due'
  | 'already_sent'
  | 'no_recent_message'
  | 'no_activity';

/**
 * The 5-minute job (8.4): her close time has passed, she wrote in the last 24 h (RF-CI-01/02),
 * there is no close sent for today, and the day has activity (PR16).
 */
export function scheduledCloseDecision(input: {
  now: Date;
  closeTime: string;
  lastMessageAt: Date | null;
  closeStatus: DailyCloseStatus | null;
  entryCount: number;
  clarificationCount: number;
}): { decision: ScheduledCloseDecision; businessDay: IsoDate } {
  const businessDay = businessDayOf(input.now);
  const decide = (decision: ScheduledCloseDecision) => ({ decision, businessDay });
  if (input.closeStatus !== null && input.closeStatus !== 'open') return decide('already_sent');
  if (input.now.getTime() < closeDueAt(businessDay, input.closeTime).getTime()) {
    return decide('not_due');
  }
  if (!isWithinLast24Hours(input.lastMessageAt, input.now)) return decide('no_recent_message');
  if (!hasCloseActivity(input)) return decide('no_activity');
  return decide('send');
}

/**
 * She writes «cierre» (RF-CI-03): send it now; WA-21 if the day has nothing (D39); WA-22 if
 * today's close was already sent (D49, case 18). Decision: an already answered close also gets
 * WA-22 (the spec only covers the unanswered one, and every message costs).
 */
export type OnDemandCloseDecision = 'send_close' | 'nothing_recorded' | 'already_sent';

export function onDemandCloseDecision(input: {
  closeStatus: DailyCloseStatus | null;
  entryCount: number;
  clarificationCount: number;
}): OnDemandCloseDecision {
  if (
    input.closeStatus !== null &&
    input.closeStatus !== 'open' &&
    input.closeStatus !== 'no_activity'
  ) {
    return 'already_sent';
  }
  return hasCloseActivity(input) ? 'send_close' : 'nothing_recorded';
}

/**
 * After interpreting a reply (WA-11, RF-CI-07): ask again only for the numbered points still
 * unresolved, up to 2 clarification rounds; then finish with what was resolved (partial).
 */
export function closeReplyFollowUp(input: {
  unresolvedNumbers: readonly number[];
  roundsUsed: number;
}): { kind: 'ask_again'; numbers: number[] } | { kind: 'finish' } {
  if (input.unresolvedNumbers.length === 0 || input.roundsUsed >= MAX_CLARIFICATION_ROUNDS) {
    return { kind: 'finish' };
  }
  return { kind: 'ask_again', numbers: [...input.unresolvedNumbers].sort((a, b) => a - b) };
}
