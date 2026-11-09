/**
 * Telegram transport (D71, D72): the public demo channel. It keeps the `Channel` contract, the
 * 12.1 catalog and the Meta limits of the other adapters, so going back to WhatsApp stays
 * mechanical:
 *
 * - text → `sendMessage`, plain text (no `parse_mode`), link previews off unless asked (her links
 *   carry tokens: Telegram must not fetch them), ≤ 4,096 characters;
 * - reply buttons → inline keyboard whose `callback_data` is the catalog button id (≤ 64 bytes);
 *   the tap comes back as a button reply with that id;
 * - summary image → `uploadMedia` keeps the PNG in memory under a local id for a few minutes;
 *   `sendImage` uploads it with `sendPhoto` (multipart) and the caption (≤ 1,024, D37), then
 *   forgets it;
 * - mark as read → a 👍 reaction on her message (silent receipt instead of the blue ticks); a
 *   button tap is acknowledged with `answerCallbackQuery`;
 * - downloads → `getFile` + file, size limits, SHA-256 and the type read from the bytes.
 *
 * The chat comes from `ctx.userId` (`users.telegram_chat_id`); `ctx.to` stays the phone that
 * identifies the account (D31, D72). At most one message per second per chat (Telegram's limit).
 * Message ids are `tg:<chat_id>:<message_id>` (callback taps: `tg:cb:<id>`), so replies and the
 * close «responder» match `outbound_messages.wa_message_id` like a `wamid`.
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { users } from '../db/schema.js';
import {
  assertValidButtons,
  assertValidContext,
  assertValidImage,
  assertValidText,
  META_LIMITS,
} from './limits.js';
import { recordOutbound } from './outbound.js';
import {
  type Fetch,
  fileSchema,
  sentMessageSchema,
  TelegramBotApi,
  trueSchema,
} from './telegram-api.js';
import {
  type ButtonsMessage,
  type Channel,
  ChannelError,
  type DownloadedMedia,
  type ImageMessage,
  type OutboundContext,
  type ReplyButton,
  type SentMessage,
  type TextMessage,
  type UploadedMedia,
} from './types.js';

export const TELEGRAM_LIMITS = {
  /** Bytes of `callback_data`. */
  callbackData: 64,
  /** One message per second per chat. */
  minIntervalMs: 1_000,
  /** Images she sends (as photo or as file) and the summary image we upload. */
  imageBytes: 10 * 1024 * 1024,
  audioBytes: 16 * 1024 * 1024,
} as const;

/** 👍: the silent receipt (D71). */
export const READ_REACTION = '👍';

const UPLOAD_TTL_MS = 15 * 60_000;
const MAX_UPLOADS = 50;
const MAX_TRACKED_CHATS = 2_000;

// ---------------------------------------------------------------------------
// Message keys (`inbound_messages.wa_message_id`, `outbound_messages.wa_message_id`)
// ---------------------------------------------------------------------------

const CHAT_ID = /^-?\d{1,20}$/;
const MESSAGE_KEY = /^tg:(-?\d{1,20}):(\d{1,12})$/;
const CALLBACK_KEY = /^tg:cb:([A-Za-z0-9_-]{1,128})$/;

export function telegramMessageKey(chatId: string, messageId: number): string {
  return `tg:${chatId}:${messageId}`;
}

export function telegramCallbackKey(callbackId: string): string {
  return `tg:cb:${callbackId}`;
}

export type TelegramKey =
  | { kind: 'message'; chatId: string; messageId: number }
  | { kind: 'callback'; callbackId: string };

export function parseTelegramKey(key: string): TelegramKey | null {
  const callback = CALLBACK_KEY.exec(key);
  if (callback?.[1]) return { kind: 'callback', callbackId: callback[1] };
  const message = MESSAGE_KEY.exec(key);
  if (message?.[1] && message[2]) {
    return { kind: 'message', chatId: message[1], messageId: Number(message[2]) };
  }
  return null;
}

/** The media type from the first bytes: Telegram's `getFile` does not say it. */
export function sniffMediaType(bytes: Buffer): string | null {
  const ascii = (from: number, to: number) => bytes.subarray(from, to).toString('latin1');
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (ascii(0, 8) === '\x89PNG\r\n\x1a\n') return 'image/png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(0, 4) === 'OggS') return 'audio/ogg';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'audio/wav';
  if (ascii(4, 8) === 'ftyp') return 'audio/mp4';
  if (ascii(0, 3) === 'ID3') return 'audio/mpeg';
  if (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0) return 'audio/mpeg';
  return null;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export interface TelegramChannelOptions {
  db: Db;
  botToken: string;
  fetch?: Fetch;
  /** Chat of an account; default: `users.telegram_chat_id` (tests inject a stub). */
  resolveChatId?: (userId: string) => Promise<string | null>;
  /** Per-chat spacing; tests pass 0 or a fake clock. */
  minIntervalMs?: number;
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface StoredUpload {
  bytes: Buffer;
  mimeType: string;
  at: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class TelegramChannel implements Channel {
  readonly kind = 'telegram' as const;
  readonly api: TelegramBotApi;
  readonly #db: Db;
  readonly #resolveChatId: (userId: string) => Promise<string | null>;
  readonly #minIntervalMs: number;
  readonly #clock: () => number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #nextSlot = new Map<string, number>();
  readonly #uploads = new Map<string, StoredUpload>();

  constructor(options: TelegramChannelOptions) {
    this.#sleep = options.sleep ?? defaultSleep;
    this.api = new TelegramBotApi({
      botToken: options.botToken,
      sleep: this.#sleep,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
    this.#db = options.db;
    this.#resolveChatId = options.resolveChatId ?? ((userId) => this.#chatOf(userId));
    this.#minIntervalMs = options.minIntervalMs ?? TELEGRAM_LIMITS.minIntervalMs;
    this.#clock = options.clock ?? Date.now;
  }

  /** RF-IN-03 on Telegram: 👍 on her message; a button tap is answered (stops the spinner). */
  async markAsRead(waMessageId: string): Promise<void> {
    const key = parseTelegramKey(waMessageId);
    if (!key) return;
    if (key.kind === 'callback') {
      await this.answerCallback(key.callbackId);
      return;
    }
    await this.api.call(
      'setMessageReaction',
      {
        chat_id: key.chatId,
        message_id: key.messageId,
        reaction: [{ type: 'emoji', emoji: READ_REACTION }],
      },
      trueSchema,
    );
  }

  async answerCallback(callbackId: string): Promise<void> {
    await this.api.call('answerCallbackQuery', { callback_query_id: callbackId }, trueSchema);
  }

  async sendText(ctx: OutboundContext, message: TextMessage): Promise<SentMessage> {
    assertValidText(message);
    return this.#send(ctx, message.body, message.previewUrl ?? false, null);
  }

  /** WA-24 (D72): a text that also takes away the «Compartir mi número» keyboard. */
  async sendTextRemovingKeyboard(ctx: OutboundContext, message: TextMessage): Promise<SentMessage> {
    assertValidText(message);
    return this.#send(ctx, message.body, false, { remove_keyboard: true });
  }

  async sendButtons(ctx: OutboundContext, message: ButtonsMessage): Promise<SentMessage> {
    assertValidButtons(message);
    for (const button of message.buttons) {
      if (Buffer.byteLength(button.id, 'utf8') > TELEGRAM_LIMITS.callbackData) {
        throw new ChannelError('limit_exceeded', 'button id longer than 64 bytes');
      }
    }
    // Telegram has no header or footer: they go around the body, as plain lines.
    const body = [message.header, message.body, message.footer]
      .filter((part): part is string => part !== undefined)
      .join('\n\n');
    return this.#send(ctx, body, false, { inline_keyboard: keyboardRows(message.buttons) });
  }

  async sendImage(ctx: OutboundContext, message: ImageMessage): Promise<SentMessage> {
    assertValidImage(message);
    assertValidContext(ctx);
    this.#pruneUploads();
    const upload = this.#uploads.get(message.mediaId);
    if (!upload) throw new ChannelError('media_not_found', 'unknown media id');
    const chatId = await this.#chatFor(ctx);
    const form = new FormData();
    form.set('chat_id', chatId);
    form.set(
      'photo',
      new Blob([new Uint8Array(upload.bytes)], { type: upload.mimeType }),
      upload.mimeType === 'image/png' ? 'resumen.png' : 'resumen.jpg',
    );
    if (message.caption !== undefined && message.caption !== '') {
      form.set('caption', message.caption);
    }
    const reply = replyParameters(ctx, chatId);
    if (reply) form.set('reply_parameters', JSON.stringify(reply));
    try {
      await this.#waitTurn(chatId);
      const sent = await this.api.call('sendPhoto', form, sentMessageSchema);
      return await this.#record(ctx, sent);
    } finally {
      // Never kept after the attempt (8.6 privacy): a retry renders it again.
      this.#uploads.delete(message.mediaId);
    }
  }

  async uploadMedia(media: { bytes: Buffer; mimeType: string }): Promise<UploadedMedia> {
    if (
      !['image/png', 'image/jpeg'].includes(media.mimeType) ||
      media.bytes.length === 0 ||
      media.bytes.length > TELEGRAM_LIMITS.imageBytes
    ) {
      throw new ChannelError('limit_exceeded', 'invalid outbound image');
    }
    this.#pruneUploads();
    const mediaId = `tg-upload-${randomBytes(12).toString('hex')}`;
    this.#uploads.set(mediaId, {
      bytes: Buffer.from(media.bytes),
      mimeType: media.mimeType,
      at: this.#clock(),
    });
    return { mediaId };
  }

  async downloadMedia(mediaId: string): Promise<DownloadedMedia> {
    if (!/^[A-Za-z0-9_-]{10,256}$/.test(mediaId)) {
      throw new ChannelError('media_not_found', 'invalid Telegram file id');
    }
    const file = await this.api.call('getFile', { file_id: mediaId }, fileSchema, { media: true });
    if (!file.file_path) throw new ChannelError('media_not_found', 'Telegram file not available');
    const limit = Math.max(TELEGRAM_LIMITS.imageBytes, TELEGRAM_LIMITS.audioBytes);
    if ((file.file_size ?? 0) > limit) throw new ChannelError('limit_exceeded', 'media too large');
    const bytes = await this.api.downloadFile(file.file_path, limit);
    if (bytes.length === 0) throw new ChannelError('media_not_found', 'empty Telegram file');
    const mimeType = sniffMediaType(bytes);
    if (!mimeType) throw new ChannelError('rejected', 'unsupported inbound media');
    if (mimeType.startsWith('image/') && bytes.length > TELEGRAM_LIMITS.imageBytes) {
      throw new ChannelError('limit_exceeded', 'media too large');
    }
    return { bytes, mimeType, sha256: createHash('sha256').update(bytes).digest('hex') };
  }

  /**
   * WA-23 (D72) to a chat with no account yet: Telegram's native «Compartir mi número» button.
   * Nothing is recorded in `outbound_messages`: there is no user until she shares her number.
   */
  async requestContact(
    chatId: string,
    message: { body: string; buttonTitle: string },
  ): Promise<void> {
    if (!CHAT_ID.test(chatId)) throw new ChannelError('limit_exceeded', 'invalid chat id');
    assertValidText({ body: message.body });
    if (message.buttonTitle.length > META_LIMITS.buttonTitle) {
      throw new ChannelError('limit_exceeded', 'button title too long');
    }
    await this.#waitTurn(chatId);
    await this.api.call(
      'sendMessage',
      {
        chat_id: chatId,
        text: message.body,
        link_preview_options: { is_disabled: true },
        reply_markup: {
          keyboard: [[{ text: message.buttonTitle, request_contact: true }]],
          one_time_keyboard: true,
          resize_keyboard: true,
        },
      },
      sentMessageSchema,
    );
  }

  async #send(
    ctx: OutboundContext,
    body: string,
    previewUrl: boolean,
    replyMarkup: object | null,
  ): Promise<SentMessage> {
    assertValidContext(ctx);
    const chatId = await this.#chatFor(ctx);
    const reply = replyParameters(ctx, chatId);
    await this.#waitTurn(chatId);
    const sent = await this.api.call(
      'sendMessage',
      {
        chat_id: chatId,
        text: body,
        link_preview_options: { is_disabled: !previewUrl },
        ...(reply ? { reply_parameters: reply } : {}),
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      },
      sentMessageSchema,
    );
    return this.#record(ctx, sent);
  }

  async #record(
    ctx: OutboundContext,
    sent: { message_id: number; chat: { id: number } },
  ): Promise<SentMessage> {
    const waMessageId = telegramMessageKey(String(sent.chat.id), sent.message_id);
    return {
      waMessageId,
      outboundMessageId: await recordOutbound(this.#db, ctx, waMessageId),
    };
  }

  async #chatFor(ctx: OutboundContext): Promise<string> {
    const chatId = await this.#resolveChatId(ctx.userId);
    if (!chatId || !CHAT_ID.test(chatId)) {
      throw new ChannelError('rejected', 'no Telegram chat linked to this account');
    }
    return chatId;
  }

  async #chatOf(userId: string): Promise<string | null> {
    const [row] = await this.#db
      .select({ chatId: users.telegramChatId })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)));
    return row?.chatId ?? null;
  }

  /** Reserves this chat's next send slot (≥ 1 s apart) and waits for it. */
  async #waitTurn(chatId: string): Promise<void> {
    if (this.#minIntervalMs <= 0) return;
    const now = this.#clock();
    const slot = Math.max(now, this.#nextSlot.get(chatId) ?? 0);
    this.#nextSlot.set(chatId, slot + this.#minIntervalMs);
    if (this.#nextSlot.size > MAX_TRACKED_CHATS) {
      for (const [id, next] of this.#nextSlot) if (next < now) this.#nextSlot.delete(id);
    }
    if (slot > now) await this.#sleep(slot - now);
  }

  #pruneUploads(): void {
    const now = this.#clock();
    for (const [id, upload] of this.#uploads) {
      if (now - upload.at > UPLOAD_TTL_MS) this.#uploads.delete(id);
    }
    while (this.#uploads.size >= MAX_UPLOADS) {
      const oldest = this.#uploads.keys().next().value;
      if (oldest === undefined) break;
      this.#uploads.delete(oldest);
    }
  }
}

/** Short titles share a row («8 pm · 9 pm · 10 pm»); longer ones stack, as WhatsApp shows them. */
function keyboardRows(buttons: readonly ReplyButton[]) {
  const keys = buttons.map((button) => ({ text: button.title, callback_data: button.id }));
  const total = buttons.reduce((sum, button) => sum + button.title.length, 0);
  return total <= 24 ? [keys] : keys.map((key) => [key]);
}

/** Quoting one of her messages in the same chat (Meta `context.message_id`). */
function replyParameters(ctx: OutboundContext, chatId: string) {
  if (!ctx.replyToWaMessageId) return null;
  const key = parseTelegramKey(ctx.replyToWaMessageId);
  if (key?.kind !== 'message' || key.chatId !== chatId) return null;
  return { message_id: key.messageId, allow_sending_without_reply: true };
}
