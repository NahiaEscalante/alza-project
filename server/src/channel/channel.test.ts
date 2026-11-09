import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestDb, hasTestDb } from '../../test/db.js';
import { outboundMessages, users } from '../db/schema.js';
import {
  assertValidButtons,
  assertValidImage,
  assertValidText,
  buildWebhookPayload,
  ChannelError,
  isValidSignature,
  META_LIMITS,
  parseWebhookPayload,
  SimulatorChannel,
  SimulatorStore,
  sha256Hex,
  signPayload,
} from './index.js';

const NOW = new Date('2026-11-10T15:00:00Z');

function limitError(fn: () => void): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ChannelError);
    expect((err as ChannelError).code).toBe('limit_exceeded');
    return (err as Error).message;
  }
  throw new Error('expected a limit error');
}

describe('Meta limits (D37, D46, D50)', () => {
  it('text body: 1 to 4,096 characters', () => {
    expect(() => assertValidText({ body: 'a'.repeat(META_LIMITS.textBody) })).not.toThrow();
    limitError(() => assertValidText({ body: 'a'.repeat(4_097) }));
    limitError(() => assertValidText({ body: '' }));
  });

  it('reply buttons: 1 to 3, titles up to 20 characters, unique, body up to 1,024', () => {
    const ok = {
      body: '¿Aceptas?',
      buttons: [
        { id: 'yes', title: 'Acepto' },
        { id: 'no', title: 'No, gracias' },
      ],
    };
    expect(() => assertValidButtons(ok)).not.toThrow();
    const four = [1, 2, 3, 4].map((n) => ({ id: `b${n}`, title: `Botón ${n}` }));
    expect(limitError(() => assertValidButtons({ body: 'x', buttons: four }))).toMatch(/1 to 3/);
    limitError(() => assertValidButtons({ body: 'x', buttons: [] }));
    limitError(() =>
      assertValidButtons({ body: 'x', buttons: [{ id: 'a', title: 'Un título demasiado largo' }] }),
    );
    limitError(() =>
      assertValidButtons({
        body: 'x',
        buttons: [
          { id: 'a', title: 'Igual' },
          { id: 'b', title: 'Igual' },
        ],
      }),
    );
    limitError(() => assertValidButtons({ body: 'x'.repeat(1_025), buttons: ok.buttons }));
  });

  it('image caption up to 1,024 characters (the close message caption, D37)', () => {
    expect(() => assertValidImage({ mediaId: 'm', caption: 'c'.repeat(1_024) })).not.toThrow();
    limitError(() => assertValidImage({ mediaId: 'm', caption: 'c'.repeat(1_025) }));
    limitError(() => assertValidImage({ mediaId: '' }));
  });
});

describe('webhook payload (10.1)', () => {
  it('round-trips text, image, audio and button replies; keeps the reply context', () => {
    const sentAt = new Date('2026-11-10T14:59:00Z');
    const cases = [
      { type: 'text', body: 'vendí 5 de pan' },
      { type: 'image', mediaId: 'MEDIA_1', mimeType: 'image/jpeg', sha256: 'abc', caption: 'luz' },
      { type: 'audio', mediaId: 'MEDIA_2', mimeType: 'audio/ogg', sha256: 'def' },
      { type: 'interactive', buttonId: 'consent:accept', buttonTitle: 'Acepto' },
    ] as const;
    for (const message of cases) {
      const payload = buildWebhookPayload({
        waMessageId: `wamid.${message.type}`,
        from: '+51987654321',
        sentAt,
        message,
        replyToWaMessageId: 'wamid.CLOSE',
      });
      const parsed = parseWebhookPayload(payload, NOW);
      expect(parsed?.messages).toHaveLength(1);
      const [m] = parsed?.messages ?? [];
      expect(m).toMatchObject({
        waMessageId: `wamid.${message.type}`,
        from: '+51987654321',
        type: message.type,
        sentAt,
        replyToWaMessageId: 'wamid.CLOSE',
      });
    }
  });

  it('maps content per type: caption, media, button id', () => {
    const parse = (message: Parameters<typeof buildWebhookPayload>[0]['message']) =>
      parseWebhookPayload(
        buildWebhookPayload({ waMessageId: 'w', from: '51987654321', sentAt: NOW, message }),
        NOW,
      )?.messages[0];
    expect(
      parse({ type: 'image', mediaId: 'M', mimeType: 'image/png', sha256: 's', caption: 'hola' }),
    ).toMatchObject({
      text: 'hola',
      media: { id: 'M', mimeType: 'image/png', sha256: 's' },
    });
    expect(
      parse({ type: 'interactive', buttonId: 'consent:accept', buttonTitle: 'Acepto' }),
    ).toMatchObject({
      text: 'consent:accept',
      buttonReply: { id: 'consent:accept', title: 'Acepto' },
    });
  });

  it('ignores statuses, stickers and malformed messages; rejects non-payloads', () => {
    const body = {
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [{ id: 'wamid.OUT', status: 'delivered' }],
                messages: [
                  {
                    id: 'wamid.STICKER',
                    from: '51987654321',
                    timestamp: '1762615320',
                    type: 'sticker',
                    sticker: {},
                  },
                  {
                    id: 'wamid.BAD',
                    from: 'not-a-phone',
                    timestamp: '1',
                    type: 'text',
                    text: { body: 'x' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(parseWebhookPayload(body, NOW)).toEqual({
      messages: [],
      ignored: 2,
      ignoredIds: ['wamid.STICKER', 'wamid.BAD'],
    });
    expect(parseWebhookPayload({ entry: 'nope' }, NOW)).toBeNull();
    expect(parseWebhookPayload({}, NOW)).toEqual({ messages: [], ignored: 0, ignoredIds: [] });
  });

  it('a timestamp in the future is not trusted (server clock instead)', () => {
    const payload = buildWebhookPayload({
      waMessageId: 'w',
      from: '51987654321',
      sentAt: new Date(NOW.getTime() + 60 * 60_000),
      message: { type: 'text', body: 'hola' },
    });
    expect(parseWebhookPayload(payload, NOW)?.messages[0]?.sentAt).toEqual(NOW);
  });
});

describe('webhook signature (14.5)', () => {
  it('accepts the HMAC of the raw body and rejects anything else', () => {
    const raw = '{"entry":[]}';
    const header = signPayload(raw, 'secret');
    expect(header).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(isValidSignature(raw, header, 'secret')).toBe(true);
    expect(isValidSignature(raw, header.toUpperCase().replace('SHA256', 'sha256'), 'secret')).toBe(
      true,
    );
    expect(isValidSignature(`${raw} `, header, 'secret')).toBe(false);
    expect(isValidSignature(raw, header, 'other')).toBe(false);
    expect(isValidSignature(raw, null, 'secret')).toBe(false);
    expect(isValidSignature(raw, 'sha256=123', 'secret')).toBe(false);
  });
});

describe('SimulatorStore', () => {
  it('ticks only move forward and media keeps its SHA-256', () => {
    const store = new SimulatorStore({ now: () => NOW });
    store.addInbound('+51987654321', 'wamid.1', { type: 'text', body: 'hola' });
    expect(store.setTick('wamid.1', 'read')).toBe(true);
    store.setTick('wamid.1', 'delivered');
    expect(store.tickOf('wamid.1')).toBe('read');
    expect(store.setTick('wamid.unknown', 'read')).toBe(false);

    const bytes = Buffer.from('png-bytes');
    const { mediaId, sha256 } = store.putMedia(bytes, 'image/png');
    expect(sha256).toBe(sha256Hex(bytes));
    expect(store.getMedia(mediaId)?.mimeType).toBe('image/png');
    store.clear('+51987654321');
    expect(store.events('+51987654321')).toEqual([]);
  });
});

describe.skipIf(!hasTestDb)('SimulatorChannel', () => {
  const { pool, db } = createTestDb();
  afterAll(() => pool.end());

  it('sends text, buttons and an uploaded image; records each in outbound_messages', async () => {
    const phone = `+519${String(Date.now()).slice(-8)}`;
    const [user] = await db.insert(users).values({ phoneE164: phone }).returning();
    if (!user) throw new Error('no user');
    const store = new SimulatorStore({ now: () => NOW });
    const channel = new SimulatorChannel({ db, store });
    const ctx = { userId: user.id, to: phone, catalogId: 'WA-01' };

    const text = await channel.sendText(
      { ...ctx, catalogId: 'WA-13' },
      { body: 'Aquí tienes tu enlace' },
    );
    await channel.sendButtons(ctx, {
      body: 'Hola, soy ALZA 👋',
      buttons: [
        { id: 'consent:accept', title: 'Acepto' },
        { id: 'consent:decline', title: 'No, gracias' },
      ],
    });
    const { mediaId } = await channel.uploadMedia({
      bytes: Buffer.from('png'),
      mimeType: 'image/png',
    });
    await channel.sendImage({ ...ctx, catalogId: 'WA-10' }, { mediaId, caption: '📒 Tu cierre' });

    await expect(
      channel.sendButtons(ctx, {
        body: 'x',
        buttons: [1, 2, 3, 4].map((n) => ({ id: `${n}`, title: `${n}` })),
      }),
    ).rejects.toThrow(ChannelError);
    await expect(channel.sendImage(ctx, { mediaId: 'nope' })).rejects.toThrow(/unknown media/);
    await expect(channel.sendText({ ...ctx, to: '987654321' }, { body: 'hola' })).rejects.toThrow(
      ChannelError,
    );

    const rows = await db
      .select()
      .from(outboundMessages)
      .where(eq(outboundMessages.userId, user.id));
    expect(rows.map((r) => r.type).sort()).toEqual(['WA-01', 'WA-10', 'WA-13']);
    expect(rows.find((r) => r.type === 'WA-13')?.waMessageId).toBe(text.waMessageId);
    expect(rows.every((r) => r.pricingCategory === 'service' && r.billable === false)).toBe(true);
    const events = store.events(phone);
    expect(events.map((e) => (e.direction === 'outbound' ? e.content.type : null))).toEqual([
      'text',
      'buttons',
      'image',
    ]);

    const downloaded = await channel.downloadMedia(mediaId);
    expect(downloaded).toMatchObject({
      mimeType: 'image/png',
      sha256: sha256Hex(Buffer.from('png')),
    });
    await expect(channel.downloadMedia('missing')).rejects.toMatchObject({
      code: 'media_not_found',
    });
  });
});
