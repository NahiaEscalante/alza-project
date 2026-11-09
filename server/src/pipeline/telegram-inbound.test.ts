/**
 * Telegram end to end (D71, D72, D74), with the real webhook route, database, pipeline and
 * onboarding flow; only the Bot API is faked (HTTP), like the Meta adapter tests.
 */
import { createHash, randomInt } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestDb, hasTestDb } from '../../test/db.js';
import { deleteAccount } from '../account/delete-account.js';
import type { ScreenshotReading } from '../ai/read-screenshot.js';
import { TelegramChannel } from '../channel/telegram.js';
import {
  consents,
  inboundMessages,
  ledgerEntries,
  mediaFiles,
  type User,
  users,
} from '../db/schema.js';
import { withFlowHooks } from '../flows/hooks.js';
import { createOnboardingHooks } from '../flows/onboarding/index.js';
import { outboundTypes, TEST_BASE_URL } from '../flows/onboarding/test-support.js';
import { createApp } from '../http/app.js';
import { TELEGRAM_SECRET_HEADER } from '../http/routes/telegram.js';
import { SHARE_CONTACT_BUTTON, TELEGRAM_TEXTS, TEXTS } from '../messages/catalog.js';
import { CONSENT_TEXT_VERSION, DEMO_CONSENT_TEXT_VERSION } from '../messages/consent.js';
import type { PipelineDeps } from './deps.js';
import { LinkPromptThrottle, type TelegramInboundDeps } from './telegram-inbound.js';
import {
  cashSale,
  createOnboardedUser,
  FakeAi,
  MemoryStorage,
  randomPhone,
  receiptExtraction,
  silentLogger,
  TestQueue,
  userByPhone,
} from './test-support.js';
import { MAX_RETRIES, processInboundJob } from './worker.js';

const TOKEN = `123456789:${'T'.repeat(35)}`;
const SECRET = 'telegram-webhook-secret-for-tests-0123456789abcdef';
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('yape-receipt')]);

interface SentByBot {
  method: string;
  chatId: string;
  text?: string;
  caption?: string;
  replyMarkup?: Record<string, unknown>;
}

/** The Bot API over HTTP: records every call and answers like Telegram. */
class FakeTelegram {
  readonly calls: { method: string; body: Record<string, unknown> }[] = [];
  readonly files = new Map<string, Buffer>();
  #messageId = 5_000;

  fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const path = new URL(url).pathname;
    const file = /^\/file\/bot[^/]+\/files\/(.+)$/.exec(path);
    if (file?.[1]) {
      const bytes = this.files.get(file[1]);
      return bytes ? new Response(bytes) : new Response('', { status: 404 });
    }
    const method = path.split('/').pop() ?? '';
    const body =
      init.body instanceof FormData
        ? (Object.fromEntries(init.body.entries()) as Record<string, unknown>)
        : (JSON.parse(String(init.body)) as Record<string, unknown>);
    this.calls.push({ method, body });
    const ok = (result: unknown) => new Response(JSON.stringify({ ok: true, result }));
    switch (method) {
      case 'sendMessage':
      case 'sendPhoto':
        return ok({ message_id: ++this.#messageId, chat: { id: Number(body.chat_id) }, date: 1 });
      case 'getFile': {
        const bytes = this.files.get(String(body.file_id));
        if (!bytes) {
          return new Response(JSON.stringify({ ok: false, error_code: 400 }), { status: 400 });
        }
        return ok({
          file_id: body.file_id,
          file_size: bytes.length,
          file_path: `files/${body.file_id}`,
        });
      }
      default:
        return ok(true);
    }
  };

  sent(chat: number): SentByBot[] {
    return this.calls
      .filter(
        (call) =>
          (call.method === 'sendMessage' || call.method === 'sendPhoto') &&
          call.body.chat_id === String(chat),
      )
      .map((call) => ({
        method: call.method,
        chatId: String(call.body.chat_id),
        ...(typeof call.body.text === 'string' ? { text: call.body.text } : {}),
        ...(typeof call.body.caption === 'string' ? { caption: call.body.caption } : {}),
        ...(call.body.reply_markup
          ? { replyMarkup: call.body.reply_markup as Record<string, unknown> }
          : {}),
      }));
  }

  count(method: string, chat?: number): number {
    return this.calls.filter(
      (call) =>
        call.method === method && (chat === undefined || call.body.chat_id === String(chat)),
    ).length;
  }
}

const randomChat = () => 6_000_000_000 + randomInt(0, 1_000_000_000);
const digits = (phone: string) => phone.slice(1);

describe.skipIf(!hasTestDb)('Telegram inbound (D71, D72, D74)', () => {
  const { pool, db } = createTestDb();
  afterAll(() => pool.end());

  const inboundOf = (userId: string) =>
    db
      .select()
      .from(inboundMessages)
      .where(eq(inboundMessages.userId, userId))
      .orderBy(asc(inboundMessages.receivedAt));
  const entriesOf = (userId: string) =>
    db.select().from(ledgerEntries).where(eq(ledgerEntries.userId, userId));
  const userOfChat = async (chat: number) => {
    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.telegramChatId, String(chat)));
    return row;
  };

  function setup(options: { cap?: number } = {}) {
    const now = () => new Date();
    const tg = new FakeTelegram();
    const telegram = new TelegramChannel({
      db,
      botToken: TOKEN,
      fetch: tg.fetch,
      minIntervalMs: 0,
    });
    const queue = new TestQueue();
    const storage = new MemoryStorage();
    const ai = new FakeAi();
    const screenshots: Buffer[] = [];
    const readScreenshot = async (image: { data: Buffer }): Promise<ScreenshotReading> => {
      screenshots.push(image.data);
      return {
        extraction: receiptExtraction({
          amount: '12.50',
          operationNumber: String(randomInt(1e7, 1e8)),
        }),
        source: 'ocr',
        layout: null,
        meta: { provider: 'local', model: 'fake-ocr', promptVersion: 'fake/1' },
        aiFailure: null,
        issues: [],
        timings: { ocrMs: 0, visionMs: 0 },
      };
    };
    const flowDeps = {
      db,
      channel: telegram,
      storage,
      logger: silentLogger,
      appBaseUrl: TEST_BASE_URL,
      now,
      messagingApp: 'telegram' as const,
    };
    const deps: PipelineDeps = {
      db,
      logger: silentLogger,
      storage,
      channel: telegram,
      ai,
      readScreenshot,
      hooks: withFlowHooks(createOnboardingHooks(flowDeps)),
      now,
      messagingApp: 'telegram',
    };
    const inbound: TelegramInboundDeps = {
      receive: { db, logger: silentLogger, channel: telegram, queue, now },
      telegram,
      logger: silentLogger,
      dailyInboundCap: options.cap ?? 150,
      prompts: new LinkPromptThrottle(),
    };
    const app = createApp({
      db,
      logger: silentLogger,
      telegramWebhook: { ...inbound, secret: SECRET },
    });

    let drained = 0;
    async function drain(): Promise<void> {
      while (drained < queue.jobs.length) {
        const job = queue.jobs[drained++] as { inboundMessageId: string };
        for (let retryCount = 0; retryCount <= MAX_RETRIES; retryCount++) {
          try {
            await processInboundJob(deps, { ...job, retryCount });
            break;
          } catch {
            // pg-boss would retry later.
          }
        }
      }
    }

    let updateId = randomInt(1, 1_000_000);
    let messageId = 0;
    const post = async (update: unknown) => {
      const res = await app.request('/webhook/telegram', {
        method: 'POST',
        headers: { 'content-type': 'application/json', [TELEGRAM_SECRET_HEADER]: SECRET },
        body: JSON.stringify(update),
      });
      expect(res.status).toBe(200);
      await drain();
      return res.status;
    };
    const messageUpdate = (chat: number, content: Record<string, unknown>) => ({
      update_id: ++updateId,
      message: {
        message_id: ++messageId,
        from: { id: chat, is_bot: false, first_name: 'Rosa' },
        chat: { id: chat, type: 'private', first_name: 'Rosa' },
        date: Math.floor(Date.now() / 1000),
        ...content,
      },
    });
    const tapUpdate = (chat: number, data: string) => {
      const last = tg.sent(chat).at(-1);
      return {
        update_id: ++updateId,
        callback_query: {
          id: `cb${updateId}`,
          from: { id: chat, is_bot: false },
          data,
          message: {
            message_id: 1,
            chat: { id: chat, type: 'private' },
            ...(last?.replyMarkup ? { reply_markup: last.replyMarkup } : {}),
          },
        },
      };
    };

    return {
      tg,
      ai,
      screenshots,
      post,
      messageUpdate,
      start: (chat: number) => post(messageUpdate(chat, { text: '/start landing' })),
      say: (chat: number, text: string) => post(messageUpdate(chat, { text })),
      share: (chat: number, phone: string, owner: number | null = chat) =>
        post(
          messageUpdate(chat, {
            contact: {
              phone_number: digits(phone),
              first_name: 'Rosa',
              ...(owner === null ? {} : { user_id: owner }),
            },
          }),
        ),
      tap: (chat: number, data: string) => post(tapUpdate(chat, data)),
    };
  }

  /** An onboarded account already linked to a Telegram chat, with the demo consent. */
  async function linkedUser(chat: number): Promise<User> {
    const user = await createOnboardedUser(db);
    await db
      .update(consents)
      .set({ textVersion: DEMO_CONSENT_TEXT_VERSION })
      .where(eq(consents.userId, user.id));
    await db
      .update(users)
      .set({ telegramChatId: String(chat) })
      .where(eq(users.id, user.id));
    return user;
  }

  it('from the landing QR to WA-06: number shared with the native button, then the usual onboarding', async () => {
    const h = setup();
    const chat = randomChat();
    const phone = randomPhone();

    // /start from an unknown chat: WA-23 with «Compartir mi número»; nothing stored.
    await h.start(chat);
    expect(h.tg.sent(chat)).toEqual([
      {
        method: 'sendMessage',
        chatId: String(chat),
        text: TEXTS['WA-23'](),
        replyMarkup: {
          keyboard: [[{ text: SHARE_CONTACT_BUTTON, request_contact: true }]],
          one_time_keyboard: true,
          resize_keyboard: true,
        },
      },
    ]);
    await h.say(chat, 'hola, vendí 5 de pan');
    expect(h.tg.sent(chat)).toHaveLength(1);
    expect(await userOfChat(chat)).toBeUndefined();
    expect(h.tg.count('setMessageReaction', chat)).toBe(0);

    // Her own contact: linked, WA-24 removes the keyboard, WA-01 (Telegram, demo notice).
    await h.share(chat, phone);
    const user = await userByPhone(db, phone);
    if (!user) throw new Error('user not created');
    expect(user).toMatchObject({
      telegramChatId: String(chat),
      onboardingStatus: 'awaiting_consent',
    });
    const [linkSent, welcome] = h.tg.sent(chat).slice(1);
    expect(linkSent).toMatchObject({
      text: TEXTS['WA-24'](),
      replyMarkup: { remove_keyboard: true },
    });
    expect(welcome).toMatchObject({
      text: TELEGRAM_TEXTS['WA-01']({ privacyUrl: `${TEST_BASE_URL}/privacidad` }),
      replyMarkup: {
        inline_keyboard: [
          [
            { text: 'Acepto', callback_data: 'consent:accept' },
            { text: 'No, gracias', callback_data: 'consent:decline' },
          ],
        ],
      },
    });
    // The contact message is kept without content (her number lives in `users` only).
    expect(await inboundOf(user.id)).toEqual([
      expect.objectContaining({ type: 'text', text: null, status: 'discarded_no_consent' }),
    ]);

    await h.tap(chat, 'consent:accept');
    expect(await db.select().from(consents).where(eq(consents.userId, user.id))).toEqual([
      expect.objectContaining({ accepted: true, textVersion: DEMO_CONSENT_TEXT_VERSION }),
    ]);
    await h.say(chat, 'Bodega Rosa');
    await h.say(chat, 'Rosa Quispe');
    await h.tap(chat, 'close_time:21:00');

    expect(await outboundTypes(db, user.id)).toEqual([
      'WA-24',
      'WA-01',
      'WA-03',
      'WA-04',
      'WA-05',
      'WA-06',
    ]);
    const wa05 = h.tg.sent(chat).at(-2);
    expect(wa05?.replyMarkup).toEqual({
      inline_keyboard: [
        [
          { text: '8 pm', callback_data: 'close_time:20:00' },
          { text: '9 pm', callback_data: 'close_time:21:00' },
          { text: '10 pm', callback_data: 'close_time:22:00' },
        ],
      ],
    });
    const wa06 = h.tg.sent(chat).at(-1)?.text ?? '';
    expect(wa06).toContain('¡Listo, Rosa! Así funciona:');
    expect(wa06).toContain('verás un 👍 en cada mensaje');
    expect(wa06).toContain(`${TEST_BASE_URL}/`);
    expect((await userByPhone(db, phone))?.onboardingStatus).toBe('complete');
    // Silent receipts: 👍 on the contact and both texts; both taps answered.
    expect(h.tg.count('setMessageReaction', chat)).toBe(3);
    expect(h.tg.calls.filter((call) => call.method === 'answerCallbackQuery')).toHaveLength(2);
  });

  it('accepts only her own contact (D72)', async () => {
    const h = setup();
    const chat = randomChat();
    const phone = randomPhone();
    await h.share(chat, phone, chat + 1);
    expect(h.tg.sent(chat).map((sent) => sent.text)).toEqual([TEXTS['WA-23']()]);
    const other = randomChat();
    await h.share(other, phone, null);
    expect(h.tg.sent(other).map((sent) => sent.text)).toEqual([TEXTS['WA-23']()]);
    expect(await userByPhone(db, phone)).toBeUndefined();
    expect(await userOfChat(chat)).toBeUndefined();
  });

  it('an existing WhatsApp account links its chat and accepts the demo notice again (14.1, D74)', async () => {
    const h = setup();
    const chat = randomChat();
    const user = await createOnboardedUser(db);
    await h.share(chat, user.phoneE164);
    expect((await userOfChat(chat))?.id).toBe(user.id);
    expect(h.tg.sent(chat).map((sent) => sent.text)).toEqual([
      TEXTS['WA-24'](),
      TELEGRAM_TEXTS['WA-01']({ privacyUrl: `${TEST_BASE_URL}/privacidad` }),
    ]);
    await h.tap(chat, 'consent:accept');
    const versions = await db
      .select({ version: consents.textVersion })
      .from(consents)
      .where(eq(consents.userId, user.id));
    expect(versions.map((row) => row.version).sort()).toEqual(
      [CONSENT_TEXT_VERSION, DEMO_CONSENT_TEXT_VERSION].sort(),
    );
    // Returning account: no onboarding questions again.
    expect(await outboundTypes(db, user.id)).toEqual(['WA-24', 'WA-01']);
    h.ai.text('vendí 5 de pan', cashSale('5.00'));
    await h.say(chat, 'vendí 5 de pan');
    expect(await entriesOf(user.id)).toEqual([
      expect.objectContaining({ amountCents: 500, paymentMethod: 'cash', status: 'confirmed' }),
    ]);
  });

  it('processes each update once: a redelivered message changes nothing', async () => {
    const h = setup();
    const chat = randomChat();
    const user = await linkedUser(chat);
    h.ai.text('vendí 5 de pan', cashSale('5.00'));
    const update = h.messageUpdate(chat, { text: 'vendí 5 de pan' });
    await h.post(update);
    await h.post(update);
    expect(await inboundOf(user.id)).toHaveLength(1);
    expect(await entriesOf(user.id)).toHaveLength(1);
    expect(h.tg.count('setMessageReaction', chat)).toBe(1);
    expect(h.tg.sent(chat)).toEqual([]);
  });

  it('downloads the largest photo and her voice notes, stored with their SHA-256', async () => {
    const h = setup();
    const chat = randomChat();
    const user = await linkedUser(chat);
    h.tg.files.set('AgACAgEAAx-large-photo', JPEG);
    await h.post(
      h.messageUpdate(chat, {
        photo: [
          { file_id: 'AgACAgEAAx-small-photo', width: 90, height: 160 },
          { file_id: 'AgACAgEAAx-large-photo', width: 720, height: 1280 },
        ],
      }),
    );
    expect(h.tg.calls.find((call) => call.method === 'getFile')?.body).toEqual({
      file_id: 'AgACAgEAAx-large-photo',
    });
    expect(h.screenshots).toEqual([JPEG]);
    const [file] = await db.select().from(mediaFiles).where(eq(mediaFiles.userId, user.id));
    expect(file).toMatchObject({
      mimeType: 'image/jpeg',
      sha256: createHash('sha256').update(JPEG).digest('hex'),
    });
    expect(await entriesOf(user.id)).toEqual([
      expect.objectContaining({ amountCents: 1250, label: 'screenshot', paymentMethod: 'yape' }),
    ]);
    // PR01: the first screenshot is confirmed once (WA-07).
    expect(await outboundTypes(db, user.id)).toEqual(['WA-07']);

    const voice = Buffer.from('OggS-voice-note-of-rosa');
    h.tg.files.set('AwACAgEAAx-voice-note', voice);
    h.ai.audio(voice.toString('utf8'), { text: 'vendí 8 soles de pan' });
    h.ai.text('vendí 8 soles de pan', cashSale('8.00'));
    await h.post(
      h.messageUpdate(chat, { voice: { file_id: 'AwACAgEAAx-voice-note', duration: 2 } }),
    );
    const entries = await entriesOf(user.id);
    expect(entries.map((entry) => entry.amountCents).sort((a, b) => a - b)).toEqual([800, 1250]);
    const files = await db.select().from(mediaFiles).where(eq(mediaFiles.userId, user.id));
    expect(files.map((row) => row.mimeType).sort()).toEqual(['audio/ogg', 'image/jpeg']);
  });

  it('a linked chat: stickers get 👍 and are never stored; /start is a contentless hello', async () => {
    const h = setup();
    const chat = randomChat();
    const user = await linkedUser(chat);
    await h.post(h.messageUpdate(chat, { sticker: { file_id: 'CAACAgEAAx-sticker' } }));
    expect(await inboundOf(user.id)).toHaveLength(0);
    expect(h.tg.count('setMessageReaction', chat)).toBe(1);
    await h.start(chat);
    expect(await inboundOf(user.id)).toEqual([
      expect.objectContaining({ text: null, status: 'non_financial' }),
    ]);
    expect(h.tg.sent(chat)).toEqual([]);
  });

  it('beyond the daily cap, her messages are ignored in silence (D74)', async () => {
    const h = setup({ cap: 2 });
    const chat = randomChat();
    const user = await linkedUser(chat);
    for (const text of ['uno', 'dos', 'tres']) await h.say(chat, text);
    expect(await inboundOf(user.id)).toHaveLength(2);
    expect(h.tg.count('setMessageReaction', chat)).toBe(2);
    await h.tap(chat, 'delete:cancel');
    expect(await inboundOf(user.id)).toHaveLength(2);
    // The tap's spinner still stops.
    expect(h.tg.count('answerCallbackQuery')).toBe(1);
  });

  it('a deleted account frees its chat: writing again asks for the number', async () => {
    const h = setup();
    const chat = randomChat();
    const user = await linkedUser(chat);
    await deleteAccount({ db, storage: new MemoryStorage() }, user.id);
    const [row] = await db
      .select({ chat: users.telegramChatId })
      .from(users)
      .where(and(eq(users.id, user.id)));
    expect(row?.chat).toBeNull();
    await h.say(chat, 'hola');
    expect(h.tg.sent(chat).map((sent) => sent.text)).toEqual([TEXTS['WA-23']()]);
  });
});
