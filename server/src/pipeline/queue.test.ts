import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestDb, hasTestDb, TEST_DATABASE_URL } from '../../test/db.js';
import { inboundMessages, ledgerEntries } from '../db/schema.js';
import { createBoss, startBoss, stopBoss } from '../queue/boss.js';
import { createInboundQueue, startInboundWorker } from './queue.js';
import { cashSale, createHarness, createOnboardedUser, silentLogger } from './test-support.js';

describe.skipIf(!hasTestDb)('pg-boss inbound queue', () => {
  const { pool, db } = createTestDb();
  afterAll(() => pool.end());

  it('webhook → pg-boss → worker records the message; a repeated enqueue is a no-op', async () => {
    const boss = createBoss(TEST_DATABASE_URL, silentLogger);
    await startBoss(boss);
    try {
      const h = createHarness(db);
      const queue = await createInboundQueue(boss, { retryDelaySeconds: 1 });
      // Route the harness' webhook into the real queue.
      h.queue.enqueue = (job, options) => queue.enqueue(job, options);
      await startInboundWorker(boss, h.deps, { pollingIntervalSeconds: 0.5 });

      const user = await createOnboardedUser(db);
      h.ai.text('vendí 9 de gaseosa', cashSale('9.00', 'gaseosa'));
      const waMessageId = await h.sendText(user.phoneE164, 'vendí 9 de gaseosa');
      const [row] = await db
        .select()
        .from(inboundMessages)
        .where(eq(inboundMessages.waMessageId, waMessageId));
      await queue.enqueue({ inboundMessageId: row?.id as string, userId: user.id });

      const deadline = Date.now() + 15_000;
      let status = row?.status;
      while (status !== 'recorded' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        const [current] = await db
          .select({ status: inboundMessages.status })
          .from(inboundMessages)
          .where(eq(inboundMessages.waMessageId, waMessageId));
        status = current?.status;
      }
      expect(status).toBe('recorded');
      const entries = await db
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.userId, user.id));
      expect(entries).toMatchObject([{ amountCents: 900, paymentMethod: 'cash' }]);
    } finally {
      await stopBoss(boss, 2_000);
    }
  });
});
