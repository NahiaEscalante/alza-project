/**
 * Which business day a message belongs to (11.1, D12, PR03, cases 4, 5, 20, 21, 31).
 *
 * - Close reply: belongs to that close's day (explicit WhatsApp reply to the close message, or
 *   intent `close_reply` while a sent close is still unanswered — even after 12:00, case 20).
 * - Screenshot with a legible date: the business day of the operation.
 * - Screenshot without date, text or audio: the business day it arrived.
 *
 * Placement in that day:
 * - close not sent yet → normal entry;
 * - close sent and waiting for her reply → it joins that close (cases 4 and 21);
 * - close replied, expired or final → silent adjustment flagged «agregado después del cierre»
 *   (`after_close`, PR03): level and points do not change; the next close mentions it.
 */
import { closeReplyTiming } from './close-level.js';
import { addDays, businessDayOf, MINUTE_MS } from './time.js';
import type { DailyCloseStatus, Intent, IsoDate } from './types.js';

/** Clock skew tolerated before a screenshot date counts as «in the future». */
export const FUTURE_DATE_TOLERANCE_MS = 5 * MINUTE_MS;

export interface CloseRef {
  businessDay: IsoDate;
  status: DailyCloseStatus;
  sentAt: Date | null;
  repliedAt: Date | null;
}

export interface AttributionInput {
  receivedAt: Date;
  /** Date and time read from the screenshot, if legible (text and audio: null). */
  operationAt: Date | null;
  intent: Intent;
  /** Day of the close message she replied to with WhatsApp's «responder», if any. */
  repliesToCloseOfDay?: IsoDate | null;
  /** Her recent closes (at least today's and yesterday's, when they exist). */
  closes: readonly CloseRef[];
}

export type EntryPlacement = 'normal' | 'joins_sent_close' | 'after_close';

export type Attribution =
  | { kind: 'close_reply'; businessDay: IsoDate; timing: 'on_time' | 'late' }
  | {
      kind: 'entry';
      businessDay: IsoDate;
      dateSource: 'screenshot' | 'arrival';
      placement: EntryPlacement;
      /** `ledger_entries.after_close` */
      afterClose: boolean;
      /** The screenshot date was in the future: arrival day used instead. */
      futureDateIgnored: boolean;
    };

const AWAITING_REPLY: readonly DailyCloseStatus[] = ['sent', 'awaiting_clarification'];

function isUnanswered(close: CloseRef): boolean {
  if (close.sentAt === null) return false;
  if (AWAITING_REPLY.includes(close.status)) return true;
  return (close.status === 'expired' || close.status === 'final') && close.repliedAt === null;
}

/** The close an answer goes to: the most recent unanswered one from today or yesterday. */
export function closeForReply(closes: readonly CloseRef[], receivedAt: Date): CloseRef | null {
  const today = businessDayOf(receivedAt);
  const yesterday = addDays(today, -1);
  const candidates = closes
    .filter(
      (close) =>
        (close.businessDay === today || close.businessDay === yesterday) && isUnanswered(close),
    )
    .sort((a, b) => (b.sentAt?.getTime() ?? 0) - (a.sentAt?.getTime() ?? 0));
  return candidates[0] ?? null;
}

export function placementFor(status: DailyCloseStatus | null): EntryPlacement {
  if (status === null || status === 'open') return 'normal';
  if (AWAITING_REPLY.includes(status)) return 'joins_sent_close';
  return 'after_close';
}

export function attributeMessage(input: AttributionInput): Attribution {
  if (input.repliesToCloseOfDay) {
    return {
      kind: 'close_reply',
      businessDay: input.repliesToCloseOfDay,
      timing: closeReplyTiming(input.repliesToCloseOfDay, input.receivedAt),
    };
  }
  if (input.intent === 'close_reply') {
    const close = closeForReply(input.closes, input.receivedAt);
    if (close) {
      return {
        kind: 'close_reply',
        businessDay: close.businessDay,
        timing: closeReplyTiming(close.businessDay, input.receivedAt),
      };
    }
  }

  const futureDateIgnored =
    input.operationAt !== null &&
    input.operationAt.getTime() > input.receivedAt.getTime() + FUTURE_DATE_TOLERANCE_MS;
  const useScreenshotDate = input.operationAt !== null && !futureDateIgnored;
  const businessDay = businessDayOf(
    useScreenshotDate && input.operationAt ? input.operationAt : input.receivedAt,
  );
  const status = input.closes.find((close) => close.businessDay === businessDay)?.status ?? null;
  const placement = placementFor(status);
  return {
    kind: 'entry',
    businessDay,
    dateSource: useScreenshotDate ? 'screenshot' : 'arrival',
    placement,
    afterClose: placement === 'after_close',
    futureDateIgnored,
  };
}
