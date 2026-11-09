import type { AiLayer } from '../../ai/layer.js';
import type { Channel } from '../../channel/types.js';
import type { Db } from '../../db/client.js';
import type { CloseLevel, IsoDate } from '../../domain/index.js';
import type { Logger } from '../../lib/logger.js';
import type { SummaryImageData } from '../../render/index.js';

/** What the close flow needs (dependencies by parameter, the clock included). */
export interface CloseFlowDeps {
  db: Db;
  logger: Logger;
  channel: Pick<Channel, 'sendText' | 'sendImage' | 'uploadMedia'>;
  ai: Pick<AiLayer, 'interpretCloseReply'>;
  now: () => Date;
  /** `config.appBaseUrl`, for the 7-day link (D13). */
  baseUrl: string;
  /** Default `renderSummaryImage` (8.6). Injected by tests to simulate a failure (RF-CI-10). */
  renderImage?: (data: SummaryImageData) => Promise<Buffer>;
}

/** Informative lines a close carried (RF-CI-11, D27): kinds only, never amounts. */
export type CloseNoticeKind =
  | 'unitemized_cash'
  | 'after_close'
  | 'security'
  | 'digital_shortfall'
  | 'text_only';

/** `daily_closes.composition`: what the close message carried, without its text. */
export interface CloseComposition {
  format: 'image' | 'text';
  /** Her D27 preference when it was sent (false = «solo texto»). */
  summaryImage: boolean;
  /** RF-CI-10: the image could not be made or uploaded and it went as text. */
  imageFailed: boolean;
  /** Monday of the week summarized in this close (11.11, D38), if any. */
  weeklySummaryWeek: IsoDate | null;
  doubtsInMessage: number;
  /** «Tienes {k} cosas más por revisar en la web». */
  webCount: number;
  notices: CloseNoticeKind[];
}

/** One entry of `daily_closes.reply_log` per inbound message applied. */
export interface CloseReplyLogEntry {
  inboundMessageId: string;
  /** When she sent it (ISO). */
  receivedAt: string;
  timing: 'on_time' | 'late';
  /** Message ALZA answered with. */
  response: 'WA-11' | 'WA-12' | 'WA-18';
  /** WA-11: numbers asked again. */
  asked?: number[];
  /** Level after applying it. */
  level: Exclude<CloseLevel, 'no_close'>;
}

export type CloseSendResult =
  | { kind: 'sent'; closeId: string; waMessageId: string; format: 'image' | 'text' }
  | { kind: 'already_sent' }
  | { kind: 'nothing_recorded' }
  | { kind: 'not_due' }
  | { kind: 'no_recent_message' }
  | { kind: 'no_activity' };
