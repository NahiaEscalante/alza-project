/**
 * WhatsApp channel (8.2, D46): the only way the system talks to WhatsApp. The simulator adapter
 * (`/dev/simulador`) and the Meta Cloud API adapter (Fase 10) implement the same interface, with
 * the same message shapes and the same Meta limits, so switching is mechanical.
 *
 * Shapes follow the Cloud API (`POST /{phone-number-id}/messages`, `/media`):
 * - text: `{ type: 'text', text: { body, preview_url } }`, body ≤ 4,096 characters;
 * - reply buttons: `{ type: 'interactive', interactive: { type: 'button', body, action.buttons } }`,
 *   1–3 buttons, title ≤ 20 characters, id ≤ 256, body ≤ 1,024;
 * - image by media id: `{ type: 'image', image: { id, caption } }`, caption ≤ 1,024 (D37);
 * - mark as read: `{ status: 'read', message_id }`;
 * - media download: `GET /{media-id}` → url, mime_type, sha256 → bytes (links expire: 2.6).
 *
 * Who sends what is decided by the message catalog (12.1, Fase 4–5): no adapter is called from
 * a registration branch (D04).
 */

/** Recipient and bookkeeping of one outbound message. */
export interface OutboundContext {
  userId: string;
  /** E.164, e.g. `+51987654321` (Meta takes the digits without `+`). */
  to: string;
  /** Catalog id of section 12.1 (e.g. `WA-10`): stored as `outbound_messages.type`. */
  catalogId: string;
  /** Quote one of her messages (Meta `context.message_id`). */
  replyToWaMessageId?: string;
}

export interface ReplyButton {
  /** Returned in the button reply (`interactive.button_reply.id`). ≤ 256 characters. */
  id: string;
  /** Visible title, ≤ 20 characters. */
  title: string;
}

export interface TextMessage {
  body: string;
  /** Meta `preview_url`: render a preview of the first link. */
  previewUrl?: boolean;
}

export interface ButtonsMessage {
  body: string;
  buttons: readonly ReplyButton[];
  /** Optional text header (≤ 60) and footer (≤ 60). */
  header?: string;
  footer?: string;
}

export interface ImageMessage {
  /** Id returned by `uploadMedia` (D37: the summary image is never sent by public URL). */
  mediaId: string;
  caption?: string;
}

export interface SentMessage {
  /** `wamid.…` returned by the channel. */
  waMessageId: string;
  /** Row in `outbound_messages`. */
  outboundMessageId: string;
}

export interface UploadedMedia {
  mediaId: string;
}

export interface DownloadedMedia {
  bytes: Buffer;
  mimeType: string;
  /** Hex SHA-256 of `bytes`, computed locally (RF-IN-04). */
  sha256: string;
}

export interface Channel {
  /** Selected transport; dialog360 is a limited sandbox, not the production channel. */
  readonly kind: 'simulator' | 'meta' | 'dialog360';
  /** RF-IN-03: blue ticks on one of her messages. */
  markAsRead(waMessageId: string): Promise<void>;
  sendText(ctx: OutboundContext, message: TextMessage): Promise<SentMessage>;
  sendButtons(ctx: OutboundContext, message: ButtonsMessage): Promise<SentMessage>;
  sendImage(ctx: OutboundContext, message: ImageMessage): Promise<SentMessage>;
  /** Uploads bytes (e.g. the summary image, 8.6) and returns the media id to send. */
  uploadMedia(media: { bytes: Buffer; mimeType: string }): Promise<UploadedMedia>;
  /** Downloads one of her files right away (RF-IN-04). Throws `ChannelError` on failure. */
  downloadMedia(mediaId: string): Promise<DownloadedMedia>;
}

export type ChannelErrorCode =
  /** A Meta limit was broken (length, number of buttons…): a bug in the caller. */
  | 'limit_exceeded'
  /** Invalid credentials or a request Meta permanently rejected. */
  | 'unsupported'
  | 'quota_exhausted'
  | 'unauthorized'
  | 'rejected'
  /** The media id does not exist or expired. */
  | 'media_not_found'
  /** Network or 5xx: worth retrying. */
  | 'unavailable';

export class ChannelError extends Error {
  readonly code: ChannelErrorCode;
  constructor(code: ChannelErrorCode, message: string) {
    super(message);
    this.name = 'ChannelError';
    this.code = code;
  }
}
