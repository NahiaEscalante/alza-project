/**
 * Telegram updates (D71, D72) → what ALZA handles, as the Meta payload parser does for WhatsApp.
 *
 * Only private chats with a person (no groups, channels or bots). Names, usernames and the
 * contact's name are never read (minimization, 14.2). Mapping:
 * - text → `text`; `/start` (with any payload, e.g. the landing QR) → `start`;
 * - photo (largest size) and image files (jpeg, png, webp) → `image`, caption as text;
 * - voice and audio → `audio`;
 * - inline button tap → `interactive` with the catalog button id, key `tg:cb:<id>`;
 * - shared contact → `contact` (identity, D72);
 * - anything else (stickers, videos, locations…) → `unsupported`: acknowledged, never stored.
 */
import { z } from 'zod';
import type { IncomingMessage } from './meta-payload.js';
import { telegramCallbackKey, telegramMessageKey } from './telegram.js';

/** One of her messages, without `from`: the phone comes from the linked account. */
export type TelegramMessage = Omit<IncomingMessage, 'from'>;

interface Base {
  chatId: string;
  /** Telegram user id of the sender (equals `chatId` in a private chat). */
  fromId: string;
  /** `tg:<chat_id>:<message_id>` or `tg:cb:<id>`: the idempotency key. */
  key: string;
  sentAt: Date;
}

export type TelegramInbound =
  | (Base & { kind: 'message'; message: TelegramMessage; callbackId: string | null })
  | (Base & { kind: 'start' })
  | (Base & {
      kind: 'contact';
      /** `contact.user_id`: equals `fromId` only when she shared her own number. */
      contactUserId: string | null;
      /** E.164, or null when Telegram's number is not a valid one. */
      phoneE164: string | null;
    })
  | (Base & { kind: 'unsupported' });

export interface ParsedTelegramUpdate {
  updateId: number;
  /** Null: an update ALZA does not handle at all (other chats, edits, bots…). */
  event: TelegramInbound | null;
}

const IMAGE_FILE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
/** A sent-at more than this ahead of the server is not trusted (as for Meta). */
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

const fileId = z.string().min(1).max(256);
const chatSchema = z.object({ id: z.number().int(), type: z.string() }).loose();
const userSchema = z.object({ id: z.number().int(), is_bot: z.boolean() }).loose();
const fileSchema = z.object({ file_id: fileId, mime_type: z.string().max(100).optional() }).loose();

const messageSchema = z
  .object({
    message_id: z.number().int().positive(),
    from: userSchema.optional(),
    chat: chatSchema,
    date: z.number().int(),
    text: z.string().max(4_096).optional(),
    caption: z.string().max(4_096).optional(),
    photo: z
      .array(
        z
          .object({
            file_id: fileId,
            width: z.number().int().nonnegative(),
            height: z.number().int().nonnegative(),
            file_size: z.number().int().nonnegative().optional(),
          })
          .loose(),
      )
      .optional(),
    document: fileSchema.optional(),
    voice: fileSchema.optional(),
    audio: fileSchema.optional(),
    contact: z
      .object({ phone_number: z.string().max(40), user_id: z.number().int().optional() })
      .loose()
      .optional(),
    reply_to_message: z.object({ message_id: z.number().int() }).loose().optional(),
  })
  .loose();

const callbackSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    from: userSchema,
    data: z.string().max(64).optional(),
    message: z
      .object({
        message_id: z.number().int(),
        chat: chatSchema,
        reply_markup: z
          .object({
            inline_keyboard: z.array(
              z.array(z.object({ text: z.string(), callback_data: z.string().optional() }).loose()),
            ),
          })
          .loose()
          .optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

const updateSchema = z
  .object({
    update_id: z.number().int().nonnegative(),
    message: z.unknown().optional(),
    callback_query: z.unknown().optional(),
  })
  .loose();

/** Returns null when the body is not a Telegram update at all. */
export function parseTelegramUpdate(body: unknown, now: Date): ParsedTelegramUpdate | null {
  const update = updateSchema.safeParse(body);
  if (!update.success) return null;
  const updateId = update.data.update_id;
  if (update.data.message !== undefined) {
    return { updateId, event: parseMessage(update.data.message, now) };
  }
  if (update.data.callback_query !== undefined) {
    return { updateId, event: parseCallback(update.data.callback_query, now) };
  }
  return { updateId, event: null };
}

/** Telegram sends the number with or without «+»: E.164 or null. */
export function normalizeTelegramPhone(raw: string): string | null {
  const digits = raw.replace(/[\s\-().]/g, '').replace(/^\+/, '');
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
}

function sentAtOf(seconds: number, now: Date): Date {
  const ms = seconds * 1000;
  return Number.isFinite(ms) && ms > 0 && ms <= now.getTime() + MAX_CLOCK_SKEW_MS
    ? new Date(Math.min(ms, now.getTime()))
    : now;
}

function parseMessage(raw: unknown, now: Date): TelegramInbound | null {
  const parsed = messageSchema.safeParse(raw);
  if (!parsed.success) return null;
  const m = parsed.data;
  // A private chat with a person: chat id = her user id.
  if (m.chat.type !== 'private' || !m.from || m.from.is_bot || m.from.id !== m.chat.id) {
    return null;
  }
  const chatId = String(m.chat.id);
  const base: Base = {
    chatId,
    fromId: String(m.from.id),
    key: telegramMessageKey(chatId, m.message_id),
    sentAt: sentAtOf(m.date, now),
  };
  const common = {
    waMessageId: base.key,
    sentAt: base.sentAt,
    replyToWaMessageId: m.reply_to_message
      ? telegramMessageKey(chatId, m.reply_to_message.message_id)
      : null,
    buttonReply: null,
  };
  const message = (content: Pick<TelegramMessage, 'type' | 'text' | 'media'>): TelegramInbound => ({
    ...base,
    kind: 'message',
    callbackId: null,
    message: { ...common, ...content },
  });

  if (m.contact) {
    return {
      ...base,
      kind: 'contact',
      contactUserId: m.contact.user_id === undefined ? null : String(m.contact.user_id),
      phoneE164: normalizeTelegramPhone(m.contact.phone_number),
    };
  }
  if (m.text !== undefined) {
    if (/^\/start(@\w+)?(\s|$)/.test(m.text)) return { ...base, kind: 'start' };
    return message({ type: 'text', text: m.text, media: null });
  }
  const caption = m.caption ?? null;
  if (m.photo && m.photo.length > 0) {
    const largest = m.photo.reduce((best, size) =>
      size.width * size.height > best.width * best.height ||
      (size.width * size.height === best.width * best.height &&
        (size.file_size ?? 0) > (best.file_size ?? 0))
        ? size
        : best,
    );
    return message({
      type: 'image',
      text: caption,
      media: { id: largest.file_id, mimeType: 'image/jpeg', sha256: null },
    });
  }
  if (m.document) {
    const mimeType = m.document.mime_type ?? '';
    if (!IMAGE_FILE_TYPES.has(mimeType)) return { ...base, kind: 'unsupported' };
    return message({
      type: 'image',
      text: caption,
      media: { id: m.document.file_id, mimeType, sha256: null },
    });
  }
  const audio = m.voice ?? m.audio;
  if (audio) {
    return message({
      type: 'audio',
      text: null,
      media: {
        id: audio.file_id,
        mimeType: audio.mime_type ?? (m.voice ? 'audio/ogg' : 'audio/mpeg'),
        sha256: null,
      },
    });
  }
  return { ...base, kind: 'unsupported' };
}

function parseCallback(raw: unknown, now: Date): TelegramInbound | null {
  const parsed = callbackSchema.safeParse(raw);
  if (!parsed.success) return null;
  const q = parsed.data;
  const chat = q.message?.chat;
  if (chat?.type !== 'private' || q.from.is_bot || q.from.id !== chat.id || !q.data) {
    return null;
  }
  const chatId = String(chat.id);
  const key = telegramCallbackKey(q.id);
  // The title she saw, from the keyboard of the message she tapped (fallback: the id).
  const title =
    q.message?.reply_markup?.inline_keyboard
      .flat()
      .find((button) => button.callback_data === q.data)?.text ?? q.data;
  return {
    chatId,
    fromId: String(q.from.id),
    key,
    sentAt: now,
    kind: 'message',
    callbackId: q.id,
    message: {
      waMessageId: key,
      sentAt: now,
      type: 'interactive',
      text: q.data,
      media: null,
      buttonReply: { id: q.data, title: title.slice(0, 40) },
      replyToWaMessageId: null,
    },
  };
}
