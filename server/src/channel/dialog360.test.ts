import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/client.js';
import { errorCodeOf } from '../pipeline/errors.js';
import { Dialog360SandboxChannel } from './dialog360.js';
import { recordOutbound } from './outbound.js';

vi.mock('./outbound.js', () => ({ recordOutbound: vi.fn(async () => 'outbound-id') }));
const db = {} as Db;
const ctx = { userId: 'user-id', to: '+51900000000', catalogId: 'WA-10' };
const json = (body: unknown, status = 201) => new Response(JSON.stringify(body), { status });
const sent = () => json({ messages: [{ id: 'wamid.test' }] });
function harness(response = sent()) {
  const fetch = vi.fn(async (_url: string, _init: RequestInit) => response);
  return { fetch, channel: new Dialog360SandboxChannel({ db, apiKey: 'test-private-key', fetch }) };
}

describe('360dialog sandbox transport', () => {
  beforeEach(() => vi.clearAllMocks());
  it('sends catalog text with the sandbox key and stores only an accepted message', async () => {
    const { channel, fetch } = harness();
    await expect(channel.sendText(ctx, { body: 'Tu cierre' })).resolves.toEqual({
      waMessageId: 'wamid.test',
      outboundMessageId: 'outbound-id',
    });
    expect(fetch.mock.calls[0]?.[0]).toBe('https://waba-sandbox.360dialog.io/v1/messages');
    const init = fetch.mock.calls[0]?.[1];
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: { 'D360-API-KEY': 'test-private-key' },
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      to: '51900000000',
      type: 'text',
      text: { body: 'Tu cierre' },
    });
    expect(recordOutbound).toHaveBeenCalledExactlyOnceWith(db, ctx, 'wamid.test');
  });
  it('preserves reply button ids needed for onboarding', async () => {
    const { channel, fetch } = harness();
    await channel.sendButtons(ctx, {
      body: '¿Aceptas?',
      buttons: [{ id: 'consent:accept', title: 'Acepto' }],
    });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1].body))).toMatchObject({
      type: 'interactive',
      interactive: {
        action: { buttons: [{ type: 'reply', reply: { id: 'consent:accept', title: 'Acepto' } }] },
      },
    });
  });
  it('rejects oversized or invalid destinations before consuming a sandbox request', async () => {
    const { channel, fetch } = harness();
    await expect(channel.sendText(ctx, { body: 'x'.repeat(4097) })).rejects.toMatchObject({
      code: 'limit_exceeded',
    });
    await expect(channel.sendText({ ...ctx, to: 'wrong' }, { body: 'Hola' })).rejects.toMatchObject(
      { code: 'limit_exceeded' },
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not call unsupported media or read endpoints', async () => {
    const { channel, fetch } = harness();
    await channel.markAsRead('wamid.in');
    await expect(
      channel.uploadMedia({ bytes: Buffer.from('image'), mimeType: 'image/png' }),
    ).rejects.toMatchObject({ code: 'unsupported' });
    await expect(channel.downloadMedia('id')).rejects.toMatchObject({ code: 'unsupported' });
    await expect(channel.sendImage(ctx, { mediaId: 'id' })).rejects.toMatchObject({
      code: 'unsupported',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    [401, 'unauthorized', false],
    [403, 'rejected', false],
    [429, 'quota_exhausted', false],
    [502, 'unavailable', true],
  ] as const)(
    'maps HTTP %s safely and applies the correct retry policy',
    async (status, code, retryable) => {
      const { channel } = harness(json({ error: 'private key and message content' }, status));
      const error = await channel.sendText(ctx, { body: 'Hola' }).catch((e: Error) => e);
      expect(error).toMatchObject({ code });
      expect(errorCodeOf(error).retryable).toBe(retryable);
      expect(String(error)).not.toContain('private');
      expect(recordOutbound).not.toHaveBeenCalled();
    },
  );
  it('does not record success without a message id', async () => {
    await expect(harness(json({})).channel.sendText(ctx, { body: 'Hola' })).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect(recordOutbound).not.toHaveBeenCalled();
  });
});
