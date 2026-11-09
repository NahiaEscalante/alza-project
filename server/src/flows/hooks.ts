/**
 * Hand-offs from the message pipeline (Fase 3) to the conversational flows (Fase 4: onboarding
 * and exception messages; Fase 5: the daily close). The pipeline decides *which* hook a message
 * goes to; the hook decides what, if anything, to send (12.1 catalog only).
 *
 * Contract for implementers:
 * - Hooks run inside the message job. A hook that throws makes the job retry (RF-IN-05, up to 3
 *   times), so hooks must be idempotent per `message.inboundMessageId`.
 *   Exceptions: `unreadableTip` and `afterProcessed` run after the message is committed; their
 *   errors are only logged (a finished message is never retried).
 * - `message.text` is her content (text body, audio transcription, or the button reply id for
 *   `interactive`). Never log it (RNF-09).
 * - Registration branches never call a hook: ALZA stays silent while she records (D04).
 */
import type { RequestKind } from '../ai/schemas.js';
import type { InboundMessageStatus, InboundMessageType, LedgerEntry, User } from '../db/schema.js';
import type { IsoDate } from '../domain/index.js';

/** The message being handled, as the hooks see it. */
export interface FlowMessage {
  inboundMessageId: string;
  waMessageId: string;
  type: InboundMessageType;
  /** Text body, transcription (audio), image caption, or button reply id (interactive). */
  text: string | null;
  /** Interactive button reply (`interactive.button_reply`), if any. */
  buttonReplyId: string | null;
  /** wa id of the message she replied to with WhatsApp's «responder», if any. */
  replyToWaMessageId: string | null;
  /** When she sent it. */
  receivedAt: Date;
}

interface BaseEvent {
  user: User;
  message: FlowMessage;
}

/**
 * Users without consent (RF-ON-02) or whose onboarding is not `complete` (RF-ON-06). Without
 * consent, `message.text` is already erased from the database and media was never downloaded;
 * for `interactive` messages the button id is kept (it is the consent answer itself).
 */
export interface OnboardingEvent extends BaseEvent {
  /** An accepted consent exists (latest `consents` row). */
  consented: boolean;
}

/**
 * - `handled` (default): the onboarding flow consumed the message.
 * - `process`: only for consented users; the pipeline records the message as usual (e.g. a first
 *   screenshot sent right after the last onboarding step).
 */
export type OnboardingOutcome = 'handled' | 'process';

/** «pedir algo» (D05, D27): web link, forgot PIN, delete data, «sin imagen»/«con imagen». */
export interface RequestEvent extends BaseEvent {
  /** From the text interpretation; null for a button reply. */
  request: RequestKind | null;
  /** Button tapped (e.g. the WA-15 confirmation), for `interactive` messages. */
  buttonReplyId: string | null;
}

/** RF-IN-08: one WA-20 answer, no follow-up. */
export type DangerEvent = BaseEvent;

/** «cierre» (D39, D49): Fase 5 decides WA-10, WA-21 or WA-22. */
export interface CloseNowEvent extends BaseEvent {
  /** Business day of arrival. */
  businessDay: IsoDate;
}

/** PR17: her answer to a close message (10.3, 11.1). */
export interface CloseReplyEvent extends BaseEvent {
  /** Her answer: text body or audio transcription. */
  text: string;
  /** Day of the close being answered. */
  businessDay: IsoDate;
  /** `late` after 12:00 of the next day: applied without points (case 20, WA-18). */
  timing: 'on_time' | 'late';
  /** WhatsApp «responder» on the close message, or the interpreted intent. */
  via: 'reply_context' | 'intent';
}

/** D28, RF-IN-07, case 28: the pipeline already applied `shouldSendUnreadableTip`. */
export interface UnreadableTipEvent extends BaseEvent {
  /** Unreadable screenshots in a row, including this one (≥ 3). */
  consecutiveUnreadable: number;
  businessDay: IsoDate;
}

/**
 * PR01, D41, RF-ON-08: a message reached its final state (any but `discarded_no_consent`) and its
 * ledger writes are committed. Fase 4 uses it to confirm the first screenshot (WA-07).
 */
export interface AfterProcessedEvent extends BaseEvent {
  status: Exclude<
    InboundMessageStatus,
    'received' | 'processing' | 'error' | 'failed' | 'discarded_no_consent'
  >;
  /** Ledger entries this message created, oldest first (empty unless recorded or pending). */
  entries: LedgerEntry[];
}

export interface FlowHooks {
  onboarding(event: OnboardingEvent): Promise<OnboardingOutcome | undefined>;
  request(event: RequestEvent): Promise<void>;
  danger(event: DangerEvent): Promise<void>;
  closeNow(event: CloseNowEvent): Promise<void>;
  closeReply(event: CloseReplyEvent): Promise<void>;
  /** Send WA-19. Called at most once per business day (the pipeline checks the outbound log). */
  unreadableTip(event: UnreadableTipEvent): Promise<void>;
  /** After the message is committed; at most once per message (a finished job is skipped). */
  afterProcessed(event: AfterProcessedEvent): Promise<void>;
}

/** Until Fases 4–5: every hand-off is a silent no-op. */
export const NO_OP_FLOW_HOOKS: FlowHooks = {
  onboarding: async () => 'handled',
  request: async () => undefined,
  danger: async () => undefined,
  closeNow: async () => undefined,
  closeReply: async () => undefined,
  unreadableTip: async () => undefined,
  afterProcessed: async () => undefined,
};

/** Fills missing hooks with the no-ops. */
export function withFlowHooks(partial: Partial<FlowHooks> = {}): FlowHooks {
  return { ...NO_OP_FLOW_HOOKS, ...partial };
}
