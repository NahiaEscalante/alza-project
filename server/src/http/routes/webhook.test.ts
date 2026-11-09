import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestDb, hasTestDb } from '../../../test/db.js';
import { buildWebhookPayload, signPayload } from '../../channel/index.js';
import { inboundMessages, users } from '../../db/schema.js';
import {
  createHarness,
  randomPhone,
  silentLogger,
  TEST_APP_SECRET,
  TEST_VERIFY_TOKEN,
  TestQueue,
} from '../../pipeline/test-support.js';
import { createApp } from '../app.js';

describe.skipIf(!hasTestDb)('POST /webhook/whatsapp', () => {
  const { pool, db } = createTestDb();
  afterAll(() => pool.end());

  const payload = (phone: string, waMessageId: string) =>
    JSON.stringify(
      buildWebhookPayload({
        waMessageId,
        from: phone,
        sentAt: new Date(),
        message: { type: 'text', body: 'vendí 5 de pan' },
      }),
    );
  const post = (app: ReturnType<typeof createApp>, raw: string, signature?: string) =>
    app.request('/webhook/whatsapp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(signature ? { 'x-hub-signature-256': signature } : {}),
      },
      body: raw,
    });

  it('a signed message → 200 fast, stored once as `received`, enqueued, marked as read', async () => {
    const h = createHarness(db);
    const phone = randomPhone();
    const id = `wamid.W${Date.now()}`;
    h.store.addInbound(phone, id, { type: 'text', body: 'vendí 5 de pan' });
    const raw = payload(phone, id);
    const started = performance.now();
    const res = await post(h.app, raw, signPayload(raw, TEST_APP_SECRET));
    const ms = performance.now() - started;
    expect(res.status).toBe(200);
    expect(ms).toBeLessThan(2_000);
    const [row] = await db
      .select()
      .from(inboundMessages)
      .where(eq(inboundMessages.waMessageId, id));
    expect(row).toMatchObject({ status: 'received', type: 'text', attempts: 0 });
    expect(h.queue.jobs).toEqual([{ inboundMessageId: row?.id, userId: row?.userId }]);
    expect(h.store.tickOf(id)).toBe('read');
    const [user] = await db.select().from(users).where(eq(users.phoneE164, phone));
    expect(user?.lastMessageAt).not.toBeNull();
  });

  it('rejects a missing or wrong signature (401) and stores nothing', async () => {
    const h = createHarness(db);
    const phone = randomPhone();
    const raw = payload(phone, `wamid.BAD${Date.now()}`);
    expect((await post(h.app, raw)).status).toBe(401);
    expect((await post(h.app, raw, signPayload(raw, 'not-the-secret'))).status).toBe(401);
    expect((await post(h.app, raw, signPayload(`${raw} `, TEST_APP_SECRET))).status).toBe(401);
    expect(await db.select().from(users).where(eq(users.phoneE164, phone))).toEqual([]);
    expect(h.queue.jobs).toEqual([]);
  });

  it('without a configured secret the webhook is closed (503)', async () => {
    const queue = new TestQueue();
    const app = createApp({
      db,
      logger: silentLogger,
      webhook: {
        receive: {
          db,
          logger: silentLogger,
          channel: { markAsRead: async () => undefined },
          queue,
          now: () => new Date(),
        },
        logger: silentLogger,
        appSecret: null,
        verifyToken: null,
      },
    });
    const raw = payload(randomPhone(), 'wamid.X');
    expect((await post(app, raw, signPayload(raw, 'anything'))).status).toBe(503);
    // The simulator is only mounted with a secret.
    expect((await app.request('/dev/simulador')).status).toBe(404);
  });

  it('answers 200 to delivery statuses and unsupported types, and 400 to garbage', async () => {
    const h = createHarness(db);
    const statuses = JSON.stringify({
      entry: [{ changes: [{ value: { statuses: [{ id: 'x' }] } }] }],
    });
    expect((await post(h.app, statuses, signPayload(statuses, TEST_APP_SECRET))).status).toBe(200);
    const notJson = 'not json';
    expect((await post(h.app, notJson, signPayload(notJson, TEST_APP_SECRET))).status).toBe(400);
    const wrong = JSON.stringify({ entry: 'x' });
    expect((await post(h.app, wrong, signPayload(wrong, TEST_APP_SECRET))).status).toBe(400);
    expect(h.queue.jobs).toEqual([]);
  });

  it('GET answers Meta’s verification challenge only with the verify token', async () => {
    const h = createHarness(db);
    const ok = await h.app.request(
      `/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=${TEST_VERIFY_TOKEN}&hub.challenge=12345`,
    );
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('12345');
    const bad = await h.app.request(
      '/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345',
    );
    expect(bad.status).toBe(403);
  });

  it('a repeated delivery of a message still `received` is enqueued again (idempotent job)', async () => {
    const h = createHarness(db);
    const phone = randomPhone();
    const id = `wamid.R${Date.now()}`;
    await h.deliver(phone, { type: 'text', body: 'hola' }, { waMessageId: id });
    await h.deliver(phone, { type: 'text', body: 'hola' }, { waMessageId: id });
    // TestQueue, like pg-boss with job id = message id, keeps one job.
    expect(h.queue.jobs).toHaveLength(1);
    await h.drain();
    await h.deliver(phone, { type: 'text', body: 'hola' }, { waMessageId: id });
    expect(h.queue.jobs).toHaveLength(1);
  });
});
