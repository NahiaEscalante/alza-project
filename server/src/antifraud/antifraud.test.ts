import { randomBytes } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestDb, hasTestDb } from '../../test/db.js';
import {
  accountHolders,
  alerts,
  dailyCloses,
  ledgerEntries,
  mediaFiles,
  type NewLedgerEntry,
  users,
} from '../db/schema.js';
import { addDays, closeDueAt, DAY_MS, limaInstant, normalizeName } from '../domain/index.js';
import { createActiveUser, uniqueHolder } from '../jobs/test-support.js';
import { createLogger } from '../lib/logger.js';
import { checkHolderConflict, hasOpenHolderConflict } from './holder-conflict.js';
import {
  ACTIVITY_SPIKE_ALERT,
  HOLDER_CONFLICT_ALERT,
  INSTANT_REPLIES_ALERT,
  SHARED_SCREENSHOT_ALERT,
} from './rules.js';
import { runAntifraudScan } from './scan.js';

const CONSENT_AT = limaInstant('2026-09-07', 9);

describe.skipIf(!hasTestDb)('antifraud (13.4)', () => {
  const { pool, db } = createTestDb();
  const logger = createLogger({ level: 'silent' });
  afterAll(async () => {
    await pool.end();
  });

  const newUser = (holder?: string) => createActiveUser(db, { consentAt: CONSENT_AT, holder });
  const alertsOf = (userIds: string[], type: string) =>
    db
      .select()
      .from(alerts)
      .where(and(inArray(alerts.userId, userIds), eq(alerts.type, type)));
  const scan = (userIds: string[], now: Date) => runAntifraudScan({ db, logger }, now, { userIds });

  describe('checkHolderConflict (case 22)', () => {
    it('alerts once for the account that declares a holder another account has', async () => {
      const holder = uniqueHolder();
      const first = await newUser(holder);
      const second = await newUser();

      const result = await checkHolderConflict(db, second, normalizeName(holder));
      expect(result).toMatchObject({ conflict: true, created: true, conflictingUserIds: [first] });
      const again = await checkHolderConflict(db, second, normalizeName(holder));
      expect(again).toEqual({ ...result, created: false });

      const [alert] = await alertsOf([second], HOLDER_CONFLICT_ALERT);
      expect(alert).toMatchObject({ status: 'open', userId: second });
      expect(JSON.stringify(alert?.detail)).not.toContain(normalizeName(holder));
      expect(await hasOpenHolderConflict(db, second)).toBe(true);
      expect(await hasOpenHolderConflict(db, first)).toBe(false);
    });

    it('also matches additional holders (D31), and ignores deleted accounts and her own', async () => {
      const holder = uniqueHolder();
      const owner = await newUser();
      await db
        .insert(accountHolders)
        .values({ userId: owner, name: holder, nameNormalized: normalizeName(holder) });
      const other = await newUser();
      expect(await checkHolderConflict(db, other, holder)).toMatchObject({
        conflict: true,
        conflictingUserIds: [owner],
      });
      // Her own main holder is not a conflict.
      const self = await newUser(holder.toUpperCase());
      await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, owner));
      await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, other));
      expect(await checkHolderConflict(db, self, holder)).toEqual({ conflict: false });
      expect(await checkHolderConflict(db, self, '  ')).toEqual({ conflict: false });
    });
  });

  it('flags the same screenshot sent from another account, once', async () => {
    const [a, b, c] = [await newUser(), await newUser(), await newUser()];
    const now = limaInstant('2026-11-10', 5);
    const shared = randomBytes(32).toString('hex');
    const media = (userId: string, sha256: string, createdAt: Date) => ({
      userId,
      sha256,
      mimeType: 'image/jpeg',
      storageKey: `media/${userId}/${sha256}`,
      deleteAfter: new Date(createdAt.getTime() + 30 * DAY_MS),
      createdAt,
    });
    // `a` sent it 40 days ago (its original is already purged; the row stays), `b` yesterday.
    await db
      .insert(mediaFiles)
      .values([
        media(a, shared, new Date(now.getTime() - 40 * DAY_MS)),
        media(b, shared, new Date(now.getTime() - DAY_MS)),
        media(c, randomBytes(32).toString('hex'), new Date(now.getTime() - DAY_MS)),
      ]);

    expect(await scan([a, b, c], now)).toMatchObject({ sharedScreenshot: 1, failed: 0 });
    const flagged = await alertsOf([a, b, c], SHARED_SCREENSHOT_ALERT);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatchObject({ userId: b, status: 'open' });
    expect(flagged[0]?.detail).toMatchObject({ sha256: shared, firstUserId: a });

    expect((await scan([a, b, c], new Date(now.getTime() + DAY_MS))).sharedScreenshot).toBe(0);
  });

  it('flags an activity spike above 3× her weekly average, once per week', async () => {
    const now = limaInstant('2026-11-17', 5); // Tuesday: the last full week is 9–15 Nov.
    const lastWeek = '2026-11-09';
    const entries = (userId: string, monday: string, count: number): NewLedgerEntry[] =>
      Array.from({ length: count }, (_, i) => ({
        userId,
        businessDay: addDays(monday, i % 7),
        amountCents: 500 + i,
        direction: 'in',
        paymentMethod: 'cash',
        category: 'sale',
        label: 'self_reported',
        status: 'confirmed',
        source: 'text',
        createdBy: 'system',
      }));
    const spiky = await newUser();
    const steady = await newUser();
    for (const userId of [spiky, steady]) {
      for (let week = 1; week <= 4; week++) {
        await db.insert(ledgerEntries).values(entries(userId, addDays(lastWeek, -7 * week), 5));
      }
    }
    await db.insert(ledgerEntries).values(entries(spiky, lastWeek, 16));
    await db.insert(ledgerEntries).values(entries(steady, lastWeek, 15));
    // Web additions are not her WhatsApp activity.
    await db
      .insert(ledgerEntries)
      .values(entries(steady, lastWeek, 10).map((entry) => ({ ...entry, source: 'web' as const })));

    expect((await scan([spiky, steady], now)).activitySpike).toBe(1);
    const [alert] = await alertsOf([spiky, steady], ACTIVITY_SPIKE_ALERT);
    expect(alert).toMatchObject({ userId: spiky });
    expect(alert?.detail).toMatchObject({
      week: '2026-W46',
      currentWeekCount: 16,
      weeklyAverage: 5,
    });
    expect((await scan([spiky, steady], new Date(now.getTime() + DAY_MS))).activitySpike).toBe(0);
  });

  it('flags close replies that always come seconds later and always say «sí»', async () => {
    const now = limaInstant('2026-11-10', 5);
    const replies = async (userId: string, secondsList: number[]) => {
      for (const [i, seconds] of secondsList.entries()) {
        const day = addDays('2026-11-09', -1 - i);
        const sentAt = closeDueAt(day, '21:00');
        await db.insert(dailyCloses).values({
          userId,
          businessDay: day,
          status: 'final',
          sentAt,
          repliedAt: new Date(sentAt.getTime() + seconds * 1000),
          cashCheck: 'balanced',
          level: 'complete',
        });
      }
    };
    const bot = await newUser();
    const human = await newUser();
    await replies(bot, [4, 3, 6, 2, 5, 3]);
    await replies(human, [4, 3, 6, 2, 95, 3]);

    expect((await scan([bot, human], now)).instantCloseReplies).toBe(1);
    const [alert] = await alertsOf([bot, human], INSTANT_REPLIES_ALERT);
    expect(alert).toMatchObject({ userId: bot, status: 'open' });
    expect(alert?.detail).toMatchObject({ closes: 6 });

    // Not again while open, nor after the review without new closes.
    expect((await scan([bot, human], now)).instantCloseReplies).toBe(0);
    await db.update(alerts).set({ status: 'dismissed' }).where(eq(alerts.userId, bot));
    expect((await scan([bot, human], new Date(now.getTime() + 60_000))).instantCloseReplies).toBe(
      0,
    );
  });
});
