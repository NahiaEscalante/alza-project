import { randomBytes, randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestDb, hasTestDb, testEncryptionKey } from '../../../../test/db.js';
import {
  accountHolders,
  consents,
  ledgerEntries,
  mediaFiles,
  pins,
  pointsEntries,
  redemptions,
  rewards,
  storageObjects,
  trustedDevices,
  users,
  waitlistSignups,
} from '../../../db/schema.js';
import { MINUTE_MS } from '../../../domain/index.js';
import { PostgresBlobStorage } from '../../../storage/postgres-blob-storage.js';
import {
  addEntry,
  createTestApi,
  createTestUser,
  signedInBrowser,
  TestClock,
  TUESDAY_NIGHT,
} from './test-support.js';

describe.skipIf(!hasTestDb)('web account API', () => {
  const { pool, db } = createTestDb();
  const testRewardIds: string[] = [];
  afterAll(async () => {
    // Rewards are global: leave none of ours active for other tests.
    if (testRewardIds.length > 0) {
      await db.update(rewards).set({ active: false }).where(inArray(rewards.id, testRewardIds));
    }
    await pool.end();
  });

  async function setup() {
    const clock = new TestClock(TUESDAY_NIGHT);
    const storage = new PostgresBlobStorage(db, testEncryptionKey());
    const app = createTestApi(db, clock, { storage });
    const user = await createTestUser(db);
    const phone = await signedInBrowser(app, db, user.id, clock.now());
    return { clock, app, user, phone, storage };
  }

  async function testReward(costPoints: number, isBig = false) {
    const [reward] = await db
      .insert(rewards)
      .values({
        name: `Premio de prueba ${randomUUID().slice(0, 8)}`,
        category: 'test',
        costPoints,
        isBig,
        isExample: true,
        active: true,
      })
      .returning();
    if (!reward) throw new Error('no reward');
    testRewardIds.push(reward.id);
    return reward;
  }

  async function givePoints(userId: string, points: number) {
    await db.insert(pointsEntries).values({ userId, type: 'adjustment', points });
  }

  describe('HU-12 · redeeming', () => {
    it('340 points and a 100-point reward: code DEMO-XXXX and the balance drops to 240', async () => {
      const { user, phone } = await setup();
      await givePoints(user.id, 340);
      const reward = await testReward(100);

      const view = await (await phone.get('/api/rewards')).json();
      expect(view.exampleNotice).toBe('Premios de ejemplo para la demo.');
      const group = view.milestones.find((m: { points: number }) => m.points === 100);
      expect(group.rewards).toContainEqual(
        expect.objectContaining({ id: reward.id, canRedeem: true, missingPoints: 0 }),
      );

      const res = await phone.post('/api/redemptions', { rewardId: reward.id });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.balance).toBe(240);
      expect(body.redemption).toMatchObject({ status: 'delivered', statusText: 'Entregado' });
      expect(body.redemption.code).toMatch(/^DEMO-[A-HJ-NP-Z2-9]{4}$/);
      expect(body.message).toBe(`¡Listo! Tu código es ${body.redemption.code}.`);

      const home = await (await phone.get('/api/home')).json();
      expect(home.points.balance).toBe(240);
      const history = await (await phone.get('/api/rewards')).json();
      expect(history.redemptions[0]).toMatchObject({ code: body.redemption.code, points: 100 });
      const ledger = await db.select().from(pointsEntries).where(eq(pointsEntries.userId, user.id));
      expect(ledger.map((row) => row.points).sort((a, b) => a - b)).toEqual([-100, 340]);
    });

    it('a big reward with fewer than 8 active weeks says how many are missing and is not redeemed', async () => {
      const { user, phone } = await setup();
      await givePoints(user.id, 2_600);
      const big = await testReward(2_500, true);
      const res = await phone.post('/api/redemptions', { rewardId: big.id });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body).toMatchObject({ error: 'needs_active_weeks', missingWeeks: 8 });
      expect(body.message).toContain('Te faltan 8');
      expect(await db.select().from(redemptions).where(eq(redemptions.userId, user.id))).toEqual(
        [],
      );
      expect((await (await phone.get('/api/home')).json()).points.balance).toBe(2_600);
    });

    it('without enough points, or without a fresh PIN, nothing is redeemed', async () => {
      const { clock, user, phone } = await setup();
      await givePoints(user.id, 40);
      const reward = await testReward(50);
      const poor = await phone.post('/api/redemptions', { rewardId: reward.id });
      expect(poor.status).toBe(409);
      expect(await poor.json()).toMatchObject({
        error: 'insufficient_points',
        missingPoints: 10,
        message: 'Te faltan 10 puntos para este premio.',
      });
      await givePoints(user.id, 100);
      clock.advance(11 * MINUTE_MS);
      expect((await phone.post('/api/redemptions', { rewardId: reward.id })).status).toBe(403);
      expect((await phone.post('/api/redemptions', { rewardId: randomUUID() })).status).toBe(403);
    });

    it('two taps at once never spend the points twice', async () => {
      const { user, phone } = await setup();
      await givePoints(user.id, 150);
      const reward = await testReward(100);
      const results = await Promise.all([
        phone.post('/api/redemptions', { rewardId: reward.id }),
        phone.post('/api/redemptions', { rewardId: reward.id }),
      ]);
      expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
      expect((await (await phone.get('/api/home')).json()).points.balance).toBe(50);
    });
  });

  describe('Ajustes', () => {
    it('switches the summary to «solo texto» (D27)', async () => {
      const { user, phone } = await setup();
      const before = await (await phone.get('/api/settings')).json();
      expect(before).toMatchObject({
        summaryImage: true,
        closeTime: '21:00',
        additionalHolders: [],
      });
      const res = await phone.patch('/api/settings', { summaryImage: false });
      expect((await res.json()).summaryImage).toBe(false);
      const [row] = await db.select().from(users).where(eq(users.id, user.id));
      expect(row?.summaryImage).toBe(false);
    });

    it('accepts at most 2 additional account holders (D31)', async () => {
      const { user, phone } = await setup();
      const three = await phone.patch('/api/settings', {
        additionalHolders: ['Juan Pérez', 'Rosa Quispe', 'Luis Huamán'],
      });
      expect(three.status).toBe(400);
      expect(await three.json()).toEqual({
        error: 'too_many_holders',
        message: 'Puedes agregar hasta 2 titulares más.',
      });

      const two = await phone.patch('/api/settings', {
        additionalHolders: ['Juan Pérez', 'Rosa Quispe'],
      });
      expect(two.status).toBe(200);
      expect((await two.json()).additionalHolders.map((h: { name: string }) => h.name)).toEqual([
        'Juan Pérez',
        'Rosa Quispe',
      ]);

      expect(
        (
          await phone.patch('/api/settings', {
            additionalHolders: ['Juan Pérez', 'Rosa Quispe', 'Luis Huamán'],
          })
        ).status,
      ).toBe(400);
      const dup = await phone.patch('/api/settings', {
        additionalHolders: ['marta quispe huaman'],
      });
      expect((await dup.json()).error).toBe('duplicate_holder');

      const swap = await phone.patch('/api/settings', {
        additionalHolders: ['Rosa Quispe', 'Luis Huamán'],
      });
      expect(swap.status).toBe(200);
      const rows = await db.select().from(accountHolders).where(eq(accountHolders.userId, user.id));
      expect(rows.map((row) => row.nameNormalized).sort()).toEqual(['luis huaman', 'rosa quispe']);
    });
  });

  describe('HU-15 · deleting the account (RF-PV-01)', () => {
    it('needs confirmation and a fresh PIN', async () => {
      const { clock, phone } = await setup();
      expect((await phone.post('/api/account/delete', {})).status).toBe(400);
      clock.advance(11 * MINUTE_MS);
      expect((await phone.post('/api/account/delete', { confirm: true })).status).toBe(403);
    });

    it('deletes her data and files and keeps only an anonymous record', async () => {
      const { user, phone, storage } = await setup();
      await addEntry(db, user.id);
      await db.insert(consents).values({ userId: user.id, textVersion: 'v1', accepted: true });
      await givePoints(user.id, 30);
      const key = `media/${user.id}/${randomBytes(8).toString('hex')}`;
      await storage.put(key, Buffer.from('captura'), { contentType: 'image/jpeg' });
      await db.insert(mediaFiles).values({
        userId: user.id,
        sha256: randomBytes(32).toString('hex'),
        mimeType: 'image/jpeg',
        storageKey: key,
        deleteAfter: new Date(Date.now() + 30 * 24 * 3_600_000),
      });
      await db.insert(waitlistSignups).values({
        phoneE164: user.phoneE164,
        name: 'Marta',
        consentVersion: 'waitlist-v1',
      });

      const res = await phone.post('/api/account/delete', { confirm: true });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        status: 'deleted',
        message: 'Listo, borré tus datos. Gracias por usar ALZA.',
      });

      const [row] = await db.select().from(users).where(eq(users.id, user.id));
      expect(row).toMatchObject({
        phoneE164: `deleted:${user.id}`,
        businessName: null,
        accountHolderName: null,
        accountHolderNormalized: null,
        closeTime: null,
      });
      expect(row?.deletedAt).toBeInstanceOf(Date);
      for (const table of [
        ledgerEntries,
        consents,
        pointsEntries,
        mediaFiles,
        pins,
        trustedDevices,
      ]) {
        expect(await db.select().from(table).where(eq(table.userId, user.id))).toEqual([]);
      }
      expect(await db.select().from(storageObjects).where(eq(storageObjects.key, key))).toEqual([]);
      expect(
        await db
          .select()
          .from(waitlistSignups)
          .where(eq(waitlistSignups.phoneE164, user.phoneE164)),
      ).toEqual([]);
      expect((await phone.get('/api/home')).status).toBe(401);
    });
  });
});
