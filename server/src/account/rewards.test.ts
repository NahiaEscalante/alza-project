import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestDb, hasTestDb } from '../../test/db.js';
import { rewards } from '../db/schema.js';
import { EXAMPLE_REWARDS, ensureRewardsCatalog, RETIRED_EXAMPLE_REWARDS } from './rewards.js';

class Rollback extends Error {}

describe.skipIf(!hasTestDb)('example rewards catalog (13.2, D76)', () => {
  const { pool, db } = createTestDb();
  afterAll(() => pool.end());

  it('deactivates the retired example rewards without deleting them and adds the new ones', async () => {
    // Inside a transaction that rolls back: the catalog is global and other files read it.
    await expect(
      db.transaction(async (tx) => {
        const [retired] = await tx
          .insert(rewards)
          .values({
            name: 'Descuento en app de comida',
            category: 'food_delivery',
            costPoints: 50,
            isBig: false,
            isExample: true,
            active: true,
          })
          .returning();
        if (!retired) throw new Error('no reward');

        await ensureRewardsCatalog(tx);

        const [after] = await tx.select().from(rewards).where(eq(rewards.id, retired.id));
        expect(after?.active).toBe(false);

        const active = await tx.select().from(rewards).where(eq(rewards.active, true));
        const activeNames = active.map((reward) => reward.name);
        for (const reward of EXAMPLE_REWARDS) expect(activeNames).toContain(reward.name);
        for (const name of RETIRED_EXAMPLE_REWARDS) expect(activeNames).not.toContain(name);
        expect(activeNames).toContain('Descuento en compra de mercadería');
        expect(activeNames).toContain('Descuento en pago de servicios');
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});
