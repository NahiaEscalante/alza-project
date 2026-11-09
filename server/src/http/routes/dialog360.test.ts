import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { buildWebhookPayload } from '../../channel/meta-payload.js';
import { createLogger } from '../../lib/logger.js';
import type { ReceiveDeps } from '../../pipeline/deps.js';
import { receiveMessage } from '../../pipeline/receive.js';
import { createDialog360WebhookRouter } from './dialog360.js';

vi.mock('../../pipeline/receive.js', () => ({
  receiveMessage: vi.fn(async () => ({ outcome: 'accepted' })),
}));
const token = 'private-webhook-token-32-characters';
const receive = { now: () => new Date('2026-11-09T08:00:00Z') } as ReceiveDeps;
const app = new Hono().route(
  '/webhook',
  createDialog360WebhookRouter({
    receive,
    webhookToken: token,
    logger: createLogger({ level: 'silent' }),
  }),
);
const post = (value: unknown, secret = token) =>
  app.request(`/webhook/dialog360/${secret}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });

describe('360dialog sandbox callback', () => {
  it('rejects a wrong callback secret before processing messages', async () => {
    vi.mocked(receiveMessage).mockClear();
    expect((await post({}, 'wrong-secret')).status).toBe(401);
    expect(receiveMessage).not.toHaveBeenCalled();
  });
  it('normalizes a sandbox text and hands it to the idempotent pipeline', async () => {
    vi.mocked(receiveMessage).mockClear();
    const payload = buildWebhookPayload({
      waMessageId: 'wamid.test',
      from: '+51900000000',
      sentAt: receive.now(),
      message: { type: 'text', body: 'Hola' },
    });
    expect((await post(payload)).status).toBe(200);
    expect(receiveMessage).toHaveBeenCalledWith(
      receive,
      expect.objectContaining({ waMessageId: 'wamid.test', from: '+51900000000', text: 'Hola' }),
    );
  });
  it('acknowledges status events without creating messages', async () => {
    vi.mocked(receiveMessage).mockClear();
    expect(
      (
        await post({
          entry: [
            { changes: [{ value: { statuses: [{ id: 'wamid.test', status: 'delivered' }] } }] },
          ],
        })
      ).status,
    ).toBe(200);
    expect(receiveMessage).not.toHaveBeenCalled();
  });
  it('refuses BSUID-only accounts rather than inventing a phone number', async () => {
    vi.mocked(receiveMessage).mockClear();
    expect(
      (
        await post({
          entry: [
            {
              changes: [
                {
                  value: {
                    messages: [
                      {
                        id: 'wamid.test',
                        from_user_id: 'BSUID',
                        type: 'text',
                        text: { body: 'Hola' },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        })
      ).status,
    ).toBe(422);
    expect(receiveMessage).not.toHaveBeenCalled();
  });
});
