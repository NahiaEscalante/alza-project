import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../lib/logger.js';
import { handleTelegramUpdate, type TelegramInboundDeps } from '../../pipeline/telegram-inbound.js';
import {
  createTelegramWebhookRouter,
  isValidTelegramSecret,
  TELEGRAM_SECRET_HEADER,
} from './telegram.js';

vi.mock('../../pipeline/telegram-inbound.js', () => ({
  handleTelegramUpdate: vi.fn(async () => 'accepted'),
}));

const SECRET = 'telegram-webhook-secret-with-48-characters-xxxx';
const inbound = { logger: createLogger({ level: 'silent' }) } as TelegramInboundDeps;
const app = new Hono().route(
  '/webhook',
  createTelegramWebhookRouter({ ...inbound, secret: SECRET }),
);
const post = (body: string, secret: string | null = SECRET) =>
  app.request('/webhook/telegram', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secret === null ? {} : { [TELEGRAM_SECRET_HEADER]: secret }),
    },
    body,
  });

describe('POST /webhook/telegram', () => {
  it('rejects a missing or wrong secret before reading the update', async () => {
    vi.mocked(handleTelegramUpdate).mockClear();
    expect((await post('{"update_id":1}', null)).status).toBe(401);
    expect((await post('{"update_id":1}', `${SECRET}x`)).status).toBe(401);
    expect((await post('{"update_id":1}', 'x'.repeat(SECRET.length))).status).toBe(401);
    expect(handleTelegramUpdate).not.toHaveBeenCalled();
  });

  it('hands a valid update to the inbound handler and answers 200, without caching', async () => {
    vi.mocked(handleTelegramUpdate).mockClear();
    const res = await post('{"update_id":7,"message":{"message_id":1}}');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ ok: true });
    expect(handleTelegramUpdate).toHaveBeenCalledWith(expect.objectContaining({ secret: SECRET }), {
      update_id: 7,
      message: { message_id: 1 },
    });
  });

  it('answers 400 to a body that is not JSON', async () => {
    expect((await post('not json')).status).toBe(400);
  });

  it('compares secrets in constant time and never accepts an empty one', () => {
    expect(isValidTelegramSecret(SECRET, SECRET)).toBe(true);
    expect(isValidTelegramSecret(undefined, SECRET)).toBe(false);
    expect(isValidTelegramSecret('', '')).toBe(false);
  });
});
