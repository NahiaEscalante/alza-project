import { afterAll, describe, expect, it } from 'vitest';
import { createTestDb, hasTestDb } from '../../test/db.js';
import { dailyCloses, pointsEntries } from '../db/schema.js';
import { limaInstant } from '../domain/index.js';
import { createLogger } from '../lib/logger.js';
import { expireInactivePoints } from './points-expiry.js';
import { createActiveUser, getPoints, total } from './test-support.js';

const AT_4AM = limaInstant('2026-11-10', 4);

describe.skipIf(!hasTestDb)('04:00 points expiry (D29, 13.2)', () => {
  const { pool, db } = createTestDb();
  const logger = createLogger({ level: 'silent' });
  afterAll(async () => {
    await pool.end();
  });

  async function userWithPoints(
    lastCloseDay: string | null,
    field: 'level' | 'improvedLevel' = 'level',
  ) {
    const userId = await createActiveUser(db, { consentAt: limaInstant('2026-01-05', 9) });
    await db.insert(pointsEntries).values([
      { userId, type: 'complete_close', points: 60, createdAt: limaInstant('2026-01-20', 12) },
      { userId, type: 'redemption', points: -50, createdAt: limaInstant('2026-02-01', 12) },
      { userId, type: 'weekly_bonus', points: 15, createdAt: limaInstant('2026-02-02', 12) },
    ]);
    if (lastCloseDay) {
      await db.insert(dailyCloses).values({
        userId,
        businessDay: lastCloseDay,
        status: 'final',
        [field]: 'partial',
        ...(field === 'improvedLevel' ? { level: 'no_close' as const } : {}),
      });
    }
    return userId;
  }
  const run = (userId: string, now = AT_4AM) =>
    expireInactivePoints({ db, logger }, now, { userIds: [userId] });

  it('expires the whole balance after 6 months without any close', async () => {
    const userId = await userWithPoints('2026-05-10');
    const summary = await run(userId);
    expect(summary).toMatchObject({ usersExpired: 1, pointsExpired: 25 });
    const points = await getPoints(db, userId);
    expect(points.at(-1)).toMatchObject({ type: 'expiration', points: -25, createdAt: AT_4AM });
    expect(total(points)).toBe(0);

    // Idempotent: nothing left to expire.
    expect((await run(userId)).usersExpired).toBe(0);
    expect(await getPoints(db, userId)).toHaveLength(4);
  });

  it('any close restarts the term (also one improved after 12:00)', async () => {
    const recent = await userWithPoints('2026-05-11');
    expect((await run(recent)).usersExpired).toBe(0);
    const improved = await userWithPoints('2026-06-01', 'improvedLevel');
    expect((await run(improved)).usersExpired).toBe(0);
    // A day without close does not restart it.
    const userId = await createActiveUser(db, { consentAt: limaInstant('2026-01-05', 9) });
    await db.insert(pointsEntries).values({ userId, type: 'adjustment', points: 30 });
    await db
      .insert(dailyCloses)
      .values({ userId, businessDay: '2026-10-01', status: 'final', level: 'no_close' });
    expect((await run(userId)).pointsExpired).toBe(30);
  });

  it('never closed: the term runs from her consent', async () => {
    const userId = await userWithPoints(null);
    expect((await run(userId, limaInstant('2026-07-05', 3, 59))).usersExpired).toBe(0);
    expect((await run(userId, limaInstant('2026-07-05', 4))).usersExpired).toBe(1);
  });
});
