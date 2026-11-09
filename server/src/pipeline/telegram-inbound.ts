/**
 * Telegram inbound (D71, D72, D74): what `POST /webhook/telegram` and local polling do with each
 * update before the usual receive path (`receiveMessage`: stored once by its key, enqueued,
 * marked as read with 👍).
 *
 * Identity (D72). Accounts are her phone (D31), so a chat must be linked first:
 * - An unknown chat (her first `/start` from the landing QR, or anything else) gets WA-23 with
 *   Telegram's «Compartir mi número» button, at most every 30 s for `/start` and every 2 min
 *   otherwise. Nothing it sends is processed or stored (RF-ON-02): not even the chat id.
 * - Her contact is accepted only if it is her own (`contact.user_id === from.id`). The number is
 *   normalized to E.164; the account with that phone is found or created and the chat is linked
 *   (`users.telegram_chat_id`). WA-24 removes the keyboard and the contact message enters the
 *   pipeline with no content, so the normal onboarding starts (WA-01, consent…).
 * - On a linked chat, a contact, sticker or video is acknowledged (👍) and never stored.
 *
 * Quota (D74): beyond `dailyInboundCap` messages in her business day, updates are ignored in
 * silence; only ids are logged. Logs never carry chat ids, phones or content: update id and
 * user id only.
 */
import { and, count, eq, gte, isNull } from 'drizzle-orm';
import type { IncomingMessage } from '../channel/meta-payload.js';
import type { TelegramChannel } from '../channel/telegram.js';
import { parseTelegramUpdate, type TelegramInbound } from '../channel/telegram-update.js';
import { inboundMessages, users } from '../db/schema.js';
import { businessDayOf, businessDayStart } from '../domain/index.js';
import { inTransaction } from '../ledger/types.js';
import type { Logger } from '../lib/logger.js';
import { contactLinkedMessage, contactRequestMessage } from '../messages/catalog.js';
import type { ReceiveDeps } from './deps.js';
import { markAsReadQuietly, receiveMessage } from './receive.js';
import { isUniqueViolation } from './shared.js';

/** WA-23 again after a `/start` or someone else's contact. */
export const LINK_PROMPT_AFTER_START_MS = 30_000;
/** WA-23 again after any other message from an unknown chat. */
export const LINK_PROMPT_REPEAT_MS = 2 * 60_000;

const MAX_TRACKED_PROMPTS = 5_000;

/** When each unknown chat last got WA-23 (memory only: an unknown chat is never stored). */
export class LinkPromptThrottle {
  readonly #last = new Map<string, number>();

  claim(chatId: string, nowMs: number, windowMs: number): boolean {
    const last = this.#last.get(chatId);
    if (last !== undefined && nowMs - last < windowMs) return false;
    this.#last.delete(chatId);
    this.#last.set(chatId, nowMs);
    while (this.#last.size > MAX_TRACKED_PROMPTS) {
      const oldest = this.#last.keys().next().value;
      if (oldest === undefined) break;
      this.#last.delete(oldest);
    }
    return true;
  }

  release(chatId: string): void {
    this.#last.delete(chatId);
  }
}

export interface TelegramInboundDeps {
  receive: ReceiveDeps;
  telegram: Pick<TelegramChannel, 'requestContact' | 'sendTextRemovingKeyboard' | 'answerCallback'>;
  logger: Logger;
  /** D74: inbound messages per user and business day. */
  dailyInboundCap: number;
  prompts: LinkPromptThrottle;
}

export type TelegramUpdateOutcome =
  | 'ignored'
  | 'prompted'
  | 'linked'
  | 'capped'
  | 'accepted'
  | 'duplicate'
  | 'requeued';

interface LinkedUser {
  id: string;
  phoneE164: string;
}

export async function handleTelegramUpdate(
  deps: TelegramInboundDeps,
  body: unknown,
): Promise<TelegramUpdateOutcome> {
  const now = deps.receive.now();
  const parsed = parseTelegramUpdate(body, now);
  if (!parsed?.event) return 'ignored';
  const { event, updateId } = parsed;

  const user = await linkedUser(deps, event.chatId);
  if (!user) return unlinkedChat(deps, event, updateId, now);

  if (event.kind === 'contact' || event.kind === 'unsupported') {
    // Not something ALZA handles: the 👍 receipt only (D04), nothing stored.
    await markAsReadQuietly(deps.receive, event.key);
    return 'ignored';
  }
  if (await overDailyCap(deps, user.id, now)) {
    if (event.kind === 'message' && event.callbackId) await answerQuietly(deps, event.callbackId);
    deps.logger.warn({ userId: user.id, updateId }, 'telegram daily inbound cap reached');
    return 'capped';
  }
  const message: IncomingMessage =
    event.kind === 'start'
      ? contentless(event, user.phoneE164)
      : { ...event.message, from: user.phoneE164 };
  return (await receiveMessage(deps.receive, message)).outcome;
}

async function linkedUser(deps: TelegramInboundDeps, chatId: string): Promise<LinkedUser | null> {
  const [row] = await deps.receive.db
    .select({ id: users.id, phoneE164: users.phoneE164 })
    .from(users)
    .where(and(eq(users.telegramChatId, chatId), isNull(users.deletedAt)));
  return row ?? null;
}

/**
 * A message with no content (`/start`, the linking contact): it reaches the onboarding like a
 * «Hola», without storing anything she wrote.
 */
function contentless(event: TelegramInbound, phoneE164: string): IncomingMessage {
  return {
    waMessageId: event.key,
    from: phoneE164,
    sentAt: event.sentAt,
    type: 'text',
    text: null,
    media: null,
    buttonReply: null,
    replyToWaMessageId: null,
  };
}

async function overDailyCap(deps: TelegramInboundDeps, userId: string, now: Date) {
  const since = businessDayStart(businessDayOf(now));
  const [row] = await deps.receive.db
    .select({ n: count() })
    .from(inboundMessages)
    .where(and(eq(inboundMessages.userId, userId), gte(inboundMessages.receivedAt, since)));
  return (row?.n ?? 0) >= deps.dailyInboundCap;
}

async function answerQuietly(deps: TelegramInboundDeps, callbackId: string): Promise<void> {
  try {
    await deps.telegram.answerCallback(callbackId);
  } catch (err) {
    deps.logger.warn({ err }, 'telegram callback answer failed');
  }
}

async function unlinkedChat(
  deps: TelegramInboundDeps,
  event: TelegramInbound,
  updateId: number,
  now: Date,
): Promise<TelegramUpdateOutcome> {
  if (event.kind === 'message' && event.callbackId) await answerQuietly(deps, event.callbackId);
  if (event.kind === 'contact' && event.phoneE164 && event.contactUserId === event.fromId) {
    return linkChat(deps, event, event.phoneE164, updateId, now);
  }
  // Someone else's contact, or anything before linking: ask for her own number again.
  const windowMs =
    event.kind === 'start' || event.kind === 'contact'
      ? LINK_PROMPT_AFTER_START_MS
      : LINK_PROMPT_REPEAT_MS;
  if (!deps.prompts.claim(event.chatId, now.getTime(), windowMs)) return 'ignored';
  try {
    await deps.telegram.requestContact(event.chatId, contactRequestMessage());
  } catch (err) {
    // Telegram redelivers the update (webhook) or polling retries it.
    deps.prompts.release(event.chatId);
    throw err;
  }
  deps.logger.info({ updateId, catalogId: 'WA-23' }, 'telegram number requested');
  return 'prompted';
}

async function linkChat(
  deps: TelegramInboundDeps,
  event: TelegramInbound,
  phoneE164: string,
  updateId: number,
  now: Date,
): Promise<TelegramUpdateOutcome> {
  const { db } = deps.receive;
  let userId: string;
  try {
    userId = await inTransaction(db, async (tx) => {
      const byPhone = async () => {
        const [row] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.phoneE164, phoneE164), isNull(users.deletedAt)));
        return row?.id ?? null;
      };
      let id = await byPhone();
      if (!id) {
        const [created] = await tx
          .insert(users)
          .values({ phoneE164, onboardingStatus: 'new', createdAt: now })
          .onConflictDoNothing({ target: users.phoneE164 })
          .returning({ id: users.id });
        id = created?.id ?? (await byPhone());
      }
      if (!id) throw new Error('user insert returned no row');
      // The newest verified owner of the number takes the account's chat (D72).
      await tx.update(users).set({ telegramChatId: event.chatId }).where(eq(users.id, id));
      return id;
    });
  } catch (err) {
    // The same contact arrived twice at once: the first delivery linked the chat.
    if (isUniqueViolation(err)) return 'duplicate';
    throw err;
  }
  deps.logger.info({ userId, updateId }, 'telegram chat linked');

  const linked = contactLinkedMessage();
  try {
    if (linked.kind !== 'text') throw new Error('WA-24 must be a text');
    await deps.telegram.sendTextRemovingKeyboard(
      { userId, to: phoneE164, catalogId: linked.catalogId },
      { body: linked.body },
    );
  } catch (err) {
    // The account is linked; the onboarding goes on even if this confirmation failed.
    deps.logger.warn({ err, userId, updateId }, 'telegram link confirmation failed');
  }
  await receiveMessage(deps.receive, contentless(event, phoneE164));
  return 'linked';
}
