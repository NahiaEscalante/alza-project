import { describe, expect, it } from 'vitest';
import { normalizeTelegramPhone, parseTelegramUpdate } from './telegram-update.js';

const NOW = new Date('2026-11-09T15:00:00Z');
const SECONDS = Math.floor(NOW.getTime() / 1000) - 5;
const CHAT = 7_700_112_233;

const update = (message: Record<string, unknown>, chat: Record<string, unknown> = {}) => ({
  update_id: 10,
  message: {
    message_id: 42,
    from: { id: CHAT, is_bot: false, first_name: 'Marta' },
    chat: { id: CHAT, type: 'private', first_name: 'Marta', ...chat },
    date: SECONDS,
    ...message,
  },
});
const event = (body: unknown) => parseTelegramUpdate(body, NOW)?.event;

describe('parseTelegramUpdate', () => {
  it('maps a text with its key, time and reply, never reading names', () => {
    const parsed = parseTelegramUpdate(
      update({ text: 'vendí 5 de pan', reply_to_message: { message_id: 40 } }),
      NOW,
    );
    expect(parsed?.updateId).toBe(10);
    expect(parsed?.event).toEqual({
      kind: 'message',
      chatId: String(CHAT),
      fromId: String(CHAT),
      key: `tg:${CHAT}:42`,
      sentAt: new Date(SECONDS * 1000),
      callbackId: null,
      message: {
        waMessageId: `tg:${CHAT}:42`,
        sentAt: new Date(SECONDS * 1000),
        type: 'text',
        text: 'vendí 5 de pan',
        media: null,
        buttonReply: null,
        replyToWaMessageId: `tg:${CHAT}:40`,
      },
    });
    expect(JSON.stringify(parsed)).not.toContain('Marta');
  });

  it('recognizes /start with the landing payload', () => {
    expect(event(update({ text: '/start landing' }))).toMatchObject({ kind: 'start' });
    expect(event(update({ text: '/start' }))).toMatchObject({ kind: 'start' });
    expect(event(update({ text: '/starting' }))).toMatchObject({ kind: 'message' });
  });

  it('takes the largest photo size, with the caption as text', () => {
    const photo = [
      { file_id: 'small-file-id', width: 90, height: 160, file_size: 2_000 },
      { file_id: 'large-file-id', width: 720, height: 1280, file_size: 90_000 },
      { file_id: 'mid-file-id', width: 320, height: 568, file_size: 20_000 },
    ];
    expect(event(update({ photo, caption: 'de Rosa' }))).toMatchObject({
      kind: 'message',
      message: {
        type: 'image',
        text: 'de Rosa',
        media: { id: 'large-file-id', mimeType: 'image/jpeg', sha256: null },
      },
    });
  });

  it('accepts screenshots sent as image files and voice or audio notes', () => {
    expect(
      event(update({ document: { file_id: 'doc-file-id', mime_type: 'image/png' } })),
    ).toMatchObject({ message: { type: 'image', media: { id: 'doc-file-id' } } });
    expect(
      event(update({ document: { file_id: 'pdf-file-id', mime_type: 'application/pdf' } })),
    ).toMatchObject({ kind: 'unsupported' });
    expect(event(update({ voice: { file_id: 'voice-file-id', duration: 3 } }))).toMatchObject({
      message: { type: 'audio', text: null, media: { id: 'voice-file-id', mimeType: 'audio/ogg' } },
    });
    expect(
      event(update({ audio: { file_id: 'audio-file-id', mime_type: 'audio/mp4', duration: 3 } })),
    ).toMatchObject({ message: { type: 'audio', media: { mimeType: 'audio/mp4' } } });
    expect(event(update({ sticker: { file_id: 'x' } }))).toMatchObject({ kind: 'unsupported' });
  });

  it('reads a shared contact: whose it is and the number in E.164', () => {
    expect(
      event(update({ contact: { phone_number: '51987654321', user_id: CHAT, first_name: 'M' } })),
    ).toMatchObject({
      kind: 'contact',
      contactUserId: String(CHAT),
      fromId: String(CHAT),
      phoneE164: '+51987654321',
    });
    expect(
      event(update({ contact: { phone_number: '+51 911 222 333', first_name: 'Otra' } })),
    ).toMatchObject({ kind: 'contact', contactUserId: null, phoneE164: '+51911222333' });
  });

  it('maps a button tap to the catalog button id and the title she saw', () => {
    const tap = {
      update_id: 11,
      callback_query: {
        id: '4382617384620001',
        from: { id: CHAT, is_bot: false },
        data: 'consent:accept',
        message: {
          message_id: 50,
          chat: { id: CHAT, type: 'private' },
          reply_markup: {
            inline_keyboard: [[{ text: 'Acepto', callback_data: 'consent:accept' }]],
          },
        },
      },
    };
    expect(event(tap)).toEqual({
      kind: 'message',
      chatId: String(CHAT),
      fromId: String(CHAT),
      key: 'tg:cb:4382617384620001',
      sentAt: NOW,
      callbackId: '4382617384620001',
      message: {
        waMessageId: 'tg:cb:4382617384620001',
        sentAt: NOW,
        type: 'interactive',
        text: 'consent:accept',
        media: null,
        buttonReply: { id: 'consent:accept', title: 'Acepto' },
        replyToWaMessageId: null,
      },
    });
  });

  it('ignores groups, bots, other chats, other update kinds and garbage', () => {
    expect(event(update({ text: 'hola' }, { type: 'group', id: -100 }))).toBeNull();
    expect(
      event({ ...update({ text: 'hola' }), message: { ...update({}).message, from: undefined } }),
    ).toBeNull();
    expect(
      event(update({ text: 'hola', from: { id: CHAT, is_bot: true, first_name: 'bot' } })),
    ).toBeNull();
    expect(event({ update_id: 3, edited_message: {} })).toBeNull();
    expect(parseTelegramUpdate({ hello: 'world' }, NOW)).toBeNull();
  });

  it('does not trust a time from the future', () => {
    const future = event(update({ text: 'hola', date: SECONDS + 3_600 }));
    expect(future?.sentAt).toEqual(NOW);
  });
});

describe('normalizeTelegramPhone', () => {
  it('returns E.164 or null', () => {
    expect(normalizeTelegramPhone('51987654321')).toBe('+51987654321');
    expect(normalizeTelegramPhone('+1 (415) 555-0100')).toBe('+14155550100');
    expect(normalizeTelegramPhone('123')).toBeNull();
    expect(normalizeTelegramPhone('0051987654321')).toBeNull();
  });
});
