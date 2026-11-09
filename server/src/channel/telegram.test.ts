import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/client.js';
import { recordOutbound } from './outbound.js';
import {
  parseTelegramKey,
  READ_REACTION,
  sniffMediaType,
  TelegramChannel,
  telegramCallbackKey,
  telegramMessageKey,
} from './telegram.js';
import type { OutboundContext } from './types.js';

vi.mock('./outbound.js', () => ({ recordOutbound: vi.fn(async () => 'outbound-id') }));

const db = {} as Db;
const TOKEN = `123456789:${'T'.repeat(35)}`;
const CHAT = '7700112233';
const ctx: OutboundContext = { userId: 'user-id', to: '+51900000000', catalogId: 'WA-10' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const sentOk = (messageId = 55, chatId = CHAT) =>
  json({ ok: true, result: { message_id: messageId, chat: { id: Number(chatId) }, date: 1 } });
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from('screenshot-bytes'),
]);

interface Call {
  url: string;
  init: RequestInit;
}

function harness(
  responses: Response[],
  options: {
    chatId?: string | null;
    clock?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const response = responses.shift();
    if (!response) throw new Error('unexpected request');
    return response;
  });
  const channel = new TelegramChannel({
    db,
    botToken: TOKEN,
    fetch,
    resolveChatId: async () => (options.chatId === undefined ? CHAT : options.chatId),
    minIntervalMs: options.clock ? 1_000 : 0,
    ...(options.clock ? { clock: options.clock } : {}),
    sleep: options.sleep ?? (async () => undefined),
  });
  const method = (i = 0) => new URL(calls[i]?.url ?? 'https://x').pathname.split('/').pop();
  const body = (i = 0) => {
    const raw = calls[i]?.init.body;
    if (raw instanceof FormData) return Object.fromEntries(raw.entries());
    return JSON.parse(String(raw));
  };
  return { channel, fetch, calls, method, body };
}

describe('TelegramChannel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends plain text without link previews, quoting her message, and records the tg key', async () => {
    const { channel, calls, method, body } = harness([sentOk(901)]);
    const context = { ...ctx, replyToWaMessageId: telegramMessageKey(CHAT, 12) };
    await expect(channel.sendText(context, { body: 'Tu cierre' })).resolves.toEqual({
      waMessageId: `tg:${CHAT}:901`,
      outboundMessageId: 'outbound-id',
    });
    expect(calls[0]?.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(calls[0]?.init).toMatchObject({ method: 'POST', redirect: 'error' });
    expect(method()).toBe('sendMessage');
    expect(body()).toEqual({
      chat_id: CHAT,
      text: 'Tu cierre',
      link_preview_options: { is_disabled: true },
      reply_parameters: { message_id: 12, allow_sending_without_reply: true },
    });
    expect(body()).not.toHaveProperty('parse_mode');
    expect(recordOutbound).toHaveBeenCalledExactlyOnceWith(db, context, `tg:${CHAT}:901`);
  });

  it('sends catalog buttons as an inline keyboard whose callback_data is the button id', async () => {
    const { channel, body } = harness([sentOk(), sentOk()]);
    await channel.sendButtons(ctx, {
      body: '¿Aceptas?',
      buttons: [
        { id: 'consent:accept', title: 'Acepto' },
        { id: 'consent:decline', title: 'No, gracias' },
      ],
      header: 'ALZA',
    });
    expect(body(0)).toMatchObject({
      text: 'ALZA\n\n¿Aceptas?',
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Acepto', callback_data: 'consent:accept' },
            { text: 'No, gracias', callback_data: 'consent:decline' },
          ],
        ],
      },
    });
    await channel.sendButtons(ctx, {
      body: 'Elige',
      buttons: [
        { id: 'a', title: 'Sí, borrar todo' },
        { id: 'b', title: 'Mejor no, gracias' },
      ],
    });
    expect(body(1).reply_markup.inline_keyboard).toHaveLength(2);
  });

  it('enforces the same limits before calling Telegram (text, buttons, callback_data, caption)', async () => {
    const { channel, fetch } = harness([]);
    await expect(channel.sendText(ctx, { body: 'x'.repeat(4_097) })).rejects.toMatchObject({
      code: 'limit_exceeded',
    });
    const button = (id: string, title = id) => ({ id, title });
    await expect(
      channel.sendButtons(ctx, {
        body: 'x',
        buttons: [button('a'), button('b'), button('c'), button('d')],
      }),
    ).rejects.toMatchObject({ code: 'limit_exceeded' });
    await expect(
      channel.sendButtons(ctx, { body: 'x', buttons: [button('a', 'x'.repeat(21))] }),
    ).rejects.toMatchObject({ code: 'limit_exceeded' });
    await expect(
      channel.sendButtons(ctx, { body: 'x', buttons: [button('ñ'.repeat(33), 'ok')] }),
    ).rejects.toMatchObject({ code: 'limit_exceeded' });
    const { mediaId } = await channel.uploadMedia({ bytes: JPEG, mimeType: 'image/png' });
    await expect(
      channel.sendImage(ctx, { mediaId, caption: 'x'.repeat(1_025) }),
    ).rejects.toMatchObject({ code: 'limit_exceeded' });
    await expect(
      channel.sendText({ ...ctx, catalogId: 'HOLA' }, { body: 'x' }),
    ).rejects.toMatchObject({ code: 'limit_exceeded' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uploads the summary image with sendPhoto and its caption, then forgets the bytes', async () => {
    const { channel, method, body } = harness([sentOk(77)]);
    const { mediaId } = await channel.uploadMedia({ bytes: JPEG, mimeType: 'image/png' });
    const sent = await channel.sendImage(ctx, { mediaId, caption: '📒 Tu cierre' });
    expect(sent.waMessageId).toBe(`tg:${CHAT}:77`);
    expect(method()).toBe('sendPhoto');
    const form = body();
    expect(form.chat_id).toBe(CHAT);
    expect(form.caption).toBe('📒 Tu cierre');
    expect(form.photo).toBeInstanceOf(Blob);
    expect(Buffer.from(await (form.photo as Blob).arrayBuffer())).toEqual(JPEG);
    await expect(channel.sendImage(ctx, { mediaId })).rejects.toMatchObject({
      code: 'media_not_found',
    });
    await expect(
      channel.uploadMedia({ bytes: Buffer.alloc(0), mimeType: 'image/png' }),
    ).rejects.toMatchObject({ code: 'limit_exceeded' });
  });

  it('marks as read with a 👍 reaction and answers button taps', async () => {
    const { channel, method, body, fetch } = harness([
      json({ ok: true, result: true }),
      json({ ok: true, result: true }),
    ]);
    await channel.markAsRead(telegramMessageKey(CHAT, 34));
    expect(method(0)).toBe('setMessageReaction');
    expect(body(0)).toEqual({
      chat_id: CHAT,
      message_id: 34,
      reaction: [{ type: 'emoji', emoji: READ_REACTION }],
    });
    await channel.markAsRead(telegramCallbackKey('9876543210'));
    expect(method(1)).toBe('answerCallbackQuery');
    expect(body(1)).toEqual({ callback_query_id: '9876543210' });
    await channel.markAsRead('wamid.not-telegram');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('downloads her file: getFile, bytes, SHA-256 and the type read from the content', async () => {
    const { channel, calls, method } = harness([
      json({
        ok: true,
        result: {
          file_id: 'AgACAgEAAx-photo',
          file_size: JPEG.length,
          file_path: 'photos/f_1.jpg',
        },
      }),
      new Response(JPEG),
    ]);
    const media = await channel.downloadMedia('AgACAgEAAx-photo');
    expect(method(0)).toBe('getFile');
    expect(calls[1]?.url).toBe(`https://api.telegram.org/file/bot${TOKEN}/photos/f_1.jpg`);
    expect(media).toEqual({
      bytes: JPEG,
      mimeType: 'image/jpeg',
      sha256: createHash('sha256').update(JPEG).digest('hex'),
    });
  });

  it('refuses unknown, oversized and unsupported files', async () => {
    const expired = harness([
      json({ ok: false, error_code: 400, description: 'Bad Request: invalid file_id' }, 400),
    ]);
    await expect(expired.channel.downloadMedia('AgACAgEAAx-gone')).rejects.toMatchObject({
      code: 'media_not_found',
    });
    const big = harness([
      json({
        ok: true,
        result: { file_id: 'AgACAgEAAx-big', file_size: 50 * 1024 * 1024, file_path: 'docs/a' },
      }),
    ]);
    await expect(big.channel.downloadMedia('AgACAgEAAx-big')).rejects.toMatchObject({
      code: 'limit_exceeded',
    });
    const pdf = harness([
      json({ ok: true, result: { file_id: 'AgACAgEAAx-pdf', file_size: 20, file_path: 'docs/b' } }),
      new Response(Buffer.from('%PDF-1.7 not an image')),
    ]);
    await expect(pdf.channel.downloadMedia('AgACAgEAAx-pdf')).rejects.toMatchObject({
      code: 'rejected',
    });
    await expect(pdf.channel.downloadMedia('../etc')).rejects.toMatchObject({
      code: 'media_not_found',
    });
  });

  it('sanitizes provider errors: no token, URL or description', async () => {
    const description = 'Unauthorized: secret detail';
    const failing = [
      harness([json({ ok: false, error_code: 401, description }, 401)]),
      harness([json({ ok: false, error_code: 403, description }, 403)]),
      harness([json({ ok: false, error_code: 502, description }, 502)]),
    ];
    const codes = [];
    for (const { channel } of failing) {
      const err = await channel.sendText(ctx, { body: 'hola' }).catch((e: Error) => e);
      expect(String((err as Error).message)).not.toContain(TOKEN);
      expect(String((err as Error).message)).not.toContain('secret detail');
      expect((err as Error & { cause?: unknown }).cause).toBeUndefined();
      codes.push((err as { code?: string }).code);
    }
    expect(codes).toEqual(['unauthorized', 'rejected', 'unavailable']);

    const offline = new TelegramChannel({
      db,
      botToken: TOKEN,
      resolveChatId: async () => CHAT,
      minIntervalMs: 0,
      fetch: async (url) => {
        throw new Error(`connect failed ${url}`);
      },
    });
    const err = await offline.sendText(ctx, { body: 'hola' }).catch((e: Error) => e);
    expect(err).toMatchObject({ code: 'unavailable' });
    expect(String((err as Error).message)).not.toContain(TOKEN);
  });

  it('waits once on a short 429 and leaves longer ones to the queue', async () => {
    const sleep = vi.fn(async () => undefined);
    const tooMany = (retryAfter: number) =>
      json({ ok: false, error_code: 429, parameters: { retry_after: retryAfter } }, 429);
    const short = harness([tooMany(1), sentOk()], { sleep });
    await expect(short.channel.sendText(ctx, { body: 'hola' })).resolves.toMatchObject({
      waMessageId: `tg:${CHAT}:55`,
    });
    expect(sleep).toHaveBeenCalledWith(1_000);
    const long = harness([tooMany(30)], { sleep });
    await expect(long.channel.sendText(ctx, { body: 'hola' })).rejects.toMatchObject({
      code: 'unavailable',
    });
  });

  it('keeps at most one message per second per chat', async () => {
    let now = 10_000;
    const waits: number[] = [];
    const sleep = async (ms: number) => {
      waits.push(ms);
    };
    const { channel } = harness([sentOk(1), sentOk(2), sentOk(3)], { clock: () => now, sleep });
    await channel.sendText(ctx, { body: 'uno' });
    await channel.sendText(ctx, { body: 'dos' });
    now += 400;
    await channel.sendText(ctx, { body: 'tres' });
    expect(waits).toEqual([1_000, 1_600]);
  });

  it('fails without a linked chat and never guesses one', async () => {
    const { channel, fetch } = harness([], { chatId: null });
    await expect(channel.sendText(ctx, { body: 'hola' })).rejects.toMatchObject({
      code: 'rejected',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('asks an unknown chat for its number with the native button, without recording it', async () => {
    const { channel, body } = harness([sentOk(), sentOk()]);
    await channel.requestContact(CHAT, { body: 'Hola', buttonTitle: 'Compartir mi número' });
    expect(body(0)).toMatchObject({
      chat_id: CHAT,
      reply_markup: {
        keyboard: [[{ text: 'Compartir mi número', request_contact: true }]],
        one_time_keyboard: true,
      },
    });
    expect(recordOutbound).not.toHaveBeenCalled();
    await channel.sendTextRemovingKeyboard({ ...ctx, catalogId: 'WA-24' }, { body: 'Gracias' });
    expect(body(1).reply_markup).toEqual({ remove_keyboard: true });
    expect(recordOutbound).toHaveBeenCalledOnce();
  });

  it('rejects an invalid token at construction', () => {
    expect(() => new TelegramChannel({ db, botToken: 'nope' })).toThrow(
      expect.objectContaining({ code: 'rejected' }),
    );
  });
});

describe('Telegram keys and media types', () => {
  it('round-trips message and callback keys', () => {
    expect(parseTelegramKey(telegramMessageKey('77', 5))).toEqual({
      kind: 'message',
      chatId: '77',
      messageId: 5,
    });
    expect(parseTelegramKey(telegramCallbackKey('123'))).toEqual({
      kind: 'callback',
      callbackId: '123',
    });
    expect(parseTelegramKey('wamid.ABC')).toBeNull();
  });

  it('reads the type from the first bytes', () => {
    const pad = (head: Buffer | string) =>
      Buffer.concat([Buffer.isBuffer(head) ? head : Buffer.from(head, 'latin1'), Buffer.alloc(12)]);
    expect(sniffMediaType(JPEG)).toBe('image/jpeg');
    expect(sniffMediaType(pad('\x89PNG\r\n\x1a\n'))).toBe('image/png');
    expect(sniffMediaType(pad('RIFF\0\0\0\0WEBP'))).toBe('image/webp');
    expect(sniffMediaType(pad('OggS'))).toBe('audio/ogg');
    expect(sniffMediaType(pad('ID3'))).toBe('audio/mpeg');
    expect(sniffMediaType(pad('\0\0\0\x20ftypM4A '))).toBe('audio/mp4');
    expect(sniffMediaType(pad('%PDF-1.7'))).toBeNull();
  });
});
