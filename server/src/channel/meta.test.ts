import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/client.js';
import { MetaChannel } from './meta.js';
import { recordOutbound } from './outbound.js';
import type { OutboundContext } from './types.js';

vi.mock('./outbound.js', () => ({ recordOutbound: vi.fn(async () => 'outbound-id') }));
const db = {} as Db;
const config = { apiVersion: 'v25.0', accessToken: 'test-token', phoneNumberId: '12345' };
const ctx: OutboundContext = { userId: 'user-id', to: '+51900000000', catalogId: 'WA-10' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const sent = () => json({ messages: [{ id: 'wamid.test' }] });
function harness(...responses: Response[]) {
  const fetch = vi.fn(async (_url: string, _init: RequestInit) => {
    const response = responses.shift();
    if (!response) throw new Error('unexpected request');
    return response;
  });
  return { channel: new MetaChannel({ db, config, fetch }), fetch };
}
function body(fetch: ReturnType<typeof harness>['fetch'], index = 0) {
  return JSON.parse(String(fetch.mock.calls[index]?.[1].body));
}
const bytes = Buffer.from('fake screenshot bytes');
const metadata = (extra: object = {}) => ({
  url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?id=1',
  mime_type: 'image/jpeg',
  sha256: createHash('sha256').update(bytes).digest('hex'),
  file_size: bytes.length,
  ...extra,
});

describe('MetaChannel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends text with authentication, quoted context and traceability only after acceptance', async () => {
    const { channel, fetch } = harness(sent());
    const context = { ...ctx, replyToWaMessageId: 'wamid.original' };
    await expect(
      channel.sendText(context, { body: 'Tu cierre', previewUrl: true }),
    ).resolves.toEqual({
      waMessageId: 'wamid.test',
      outboundMessageId: 'outbound-id',
    });
    expect(fetch.mock.calls[0]?.[0]).toBe('https://graph.facebook.com/v25.0/12345/messages');
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: { Authorization: 'Bearer test-token' },
    });
    expect(body(fetch)).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '51900000000',
      context: { message_id: 'wamid.original' },
      type: 'text',
      text: { body: 'Tu cierre', preview_url: true },
    });
    expect(recordOutbound).toHaveBeenCalledExactlyOnceWith(db, context, 'wamid.test');
  });

  it('sends reply buttons and images by media id', async () => {
    const { channel, fetch } = harness(sent(), sent());
    await channel.sendButtons(ctx, {
      body: '¿Aceptas?',
      buttons: [{ id: 'consent:accept', title: 'Acepto' }],
      header: 'ALZA',
      footer: 'Privacidad',
    });
    expect(body(fetch)).toMatchObject({
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: '¿Aceptas?' },
        header: { type: 'text', text: 'ALZA' },
        footer: { text: 'Privacidad' },
        action: { buttons: [{ type: 'reply', reply: { id: 'consent:accept', title: 'Acepto' } }] },
      },
    });
    await channel.sendImage(ctx, { mediaId: 'uploaded-id', caption: 'Tu resumen' });
    expect(body(fetch, 1)).toMatchObject({
      type: 'image',
      image: { id: 'uploaded-id', caption: 'Tu resumen' },
    });
  });

  it('enforces limits before calling Meta or recording an outbound message', async () => {
    const { channel, fetch } = harness();
    await expect(channel.sendText(ctx, { body: 'x'.repeat(4097) })).rejects.toMatchObject({
      code: 'limit_exceeded',
    });
    await expect(channel.sendImage(ctx, { mediaId: '' })).rejects.toMatchObject({
      code: 'limit_exceeded',
    });
    await expect(
      channel.sendText({ ...ctx, to: 'invalid' }, { body: 'Hola' }),
    ).rejects.toMatchObject({ code: 'limit_exceeded' });
    expect(fetch).not.toHaveBeenCalled();
    expect(recordOutbound).not.toHaveBeenCalled();
  });

  it('marks as read without adding an outbound message', async () => {
    const { channel, fetch } = harness(json({ success: true }));
    await channel.markAsRead('wamid.inbound');
    expect(body(fetch)).toEqual({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: 'wamid.inbound',
    });
    expect(recordOutbound).not.toHaveBeenCalled();
  });

  it('uploads an image as multipart without overriding the boundary', async () => {
    const { channel, fetch } = harness(json({ id: 'media-id' }));
    await expect(channel.uploadMedia({ bytes, mimeType: 'image/png' })).resolves.toEqual({
      mediaId: 'media-id',
    });
    const request = fetch.mock.calls[0]?.[1];
    expect(request?.body).toBeInstanceOf(FormData);
    const form = request?.body as FormData;
    expect(form.get('messaging_product')).toBe('whatsapp');
    const file = form.get('file') as File;
    expect(Buffer.from(await file.arrayBuffer())).toEqual(bytes);
    expect(request?.headers).not.toHaveProperty('Content-Type');
  });

  it.each(['hex', 'base64'] as const)(
    'downloads fresh authenticated media and verifies its %s hash',
    async (encoding) => {
      const { channel, fetch } = harness(
        json(metadata({ sha256: createHash('sha256').update(bytes).digest(encoding) })),
        new Response(bytes),
      );
      const result = await channel.downloadMedia('incoming-id');
      expect(result.bytes).toEqual(bytes);
      expect(result.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect(fetch.mock.calls[0]?.[0]).toBe(
        'https://graph.facebook.com/v25.0/incoming-id?phone_number_id=12345',
      );
      expect(fetch.mock.calls[1]?.[1]).toMatchObject({
        redirect: 'error',
        headers: { Authorization: 'Bearer test-token' },
      });
    },
  );

  it.each([
    'https://attacker.example/file',
    'https://fbsbx.com.attacker.example/file',
    'http://lookaside.fbsbx.com/file',
    'https://user@lookaside.fbsbx.com/file',
  ])('rejects unsafe download destination %s before forwarding credentials', async (url) => {
    const { channel, fetch } = harness(json(metadata({ url })));
    await expect(channel.downloadMedia('id')).rejects.toMatchObject({ code: 'rejected' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('refuses corrupted media and oversized downloads', async () => {
    const corrupted = harness(json(metadata()), new Response('different bytes'));
    await expect(corrupted.channel.downloadMedia('id')).rejects.toMatchObject({
      code: 'unavailable',
    });
    const oversized = harness(json(metadata({ file_size: 6 * 1024 * 1024 })));
    await expect(oversized.channel.downloadMedia('id')).rejects.toMatchObject({
      code: 'limit_exceeded',
    });
    expect(oversized.fetch).toHaveBeenCalledTimes(1);
    const streamed = harness(
      json(metadata({ file_size: undefined })),
      new Response(new Uint8Array(5 * 1024 * 1024 + 1)),
    );
    await expect(streamed.channel.downloadMedia('id')).rejects.toMatchObject({
      code: 'limit_exceeded',
    });
  });

  it.each([
    [400, 'rejected'],
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [429, 'unavailable'],
    [500, 'unavailable'],
  ] as const)('maps HTTP %s without exposing response content', async (status, code) => {
    const { channel } = harness(
      json({ error: { message: 'secret-token private message' } }, status),
    );
    const error = await channel.sendText(ctx, { body: 'Hola' }).catch((e: Error) => e);
    expect(error).toMatchObject({ code });
    expect(String(error)).not.toMatch(/secret-token|private message/);
    expect(recordOutbound).not.toHaveBeenCalled();
  });

  it.each([
    [130429, 'unavailable'],
    [190, 'unauthorized'],
  ] as const)(
    'handles Graph error code %s even when returned as HTTP 400',
    async (code, expected) => {
      const { channel } = harness(json({ error: { code, message: 'private details' } }, 400));
      await expect(channel.sendText(ctx, { body: 'Hola' })).rejects.toMatchObject({
        code: expected,
      });
      expect(recordOutbound).not.toHaveBeenCalled();
    },
  );

  it('handles expired media and malformed success responses without recording a send', async () => {
    await expect(harness(json({}, 404)).channel.downloadMedia('id')).rejects.toMatchObject({
      code: 'media_not_found',
    });
    await expect(
      harness(json({ messages: [] })).channel.sendText(ctx, { body: 'Hola' }),
    ).rejects.toMatchObject({ code: 'unavailable' });
    expect(recordOutbound).not.toHaveBeenCalled();
  });

  it('sanitizes network failures and timeouts', async () => {
    const channel = new MetaChannel({
      db,
      config,
      fetch: async () => {
        throw new Error('secret URL and token');
      },
    });
    const error = await channel.markAsRead('id').catch((e: Error) => e);
    expect(error).toMatchObject({ code: 'unavailable' });
    expect(String(error)).not.toContain('secret');
  });
});
