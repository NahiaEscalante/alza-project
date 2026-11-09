import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestDb, hasTestDb } from '../../test/db.js';
import { pointsEntries, streaks, users } from '../db/schema.js';
import { businessDayOf, limaInstant, pointsBalance } from '../domain/index.js';
import { getDayEntries, getWeekView, listDays, listPending } from '../ledger/index.js';
import { DEMO_PHONE, seedDemo } from './demo-data.js';

describe.skipIf(!hasTestDb)('seed:demo', () => {
  const { pool, db } = createTestDb();
  afterAll(() => pool.end());

  it('creates Marta with consistent points and is idempotent', async () => {
    const now = limaInstant('2026-11-08', 15, 30);
    const first = await seedDemo(db, { now, baseUrl: 'http://localhost:5173' });
    const second = await seedDemo(db, { now, baseUrl: 'http://localhost:5173' });
    expect(second.userId).not.toBe(first.userId);
    expect(await db.select().from(users).where(eq(users.phoneE164, DEMO_PHONE))).toHaveLength(1);

    const { userId } = second;
    expect(second.activationUrl).toMatch(/^http:\/\/localhost:5173\/app\/activar\/[\w-]{43}$/);
    expect(second.accessUrl).toMatch(/\/app\/entrar\/[\w-]{43}$/);
    expect(second.balance).toBeGreaterThanOrEqual(300);
    expect(second.balance).toBeLessThanOrEqual(400);
    const rows = await db.select().from(pointsEntries).where(eq(pointsEntries.userId, userId));
    expect(pointsBalance(rows)).toBe(second.balance);
    const [streak] = await db.select().from(streaks).where(eq(streaks.userId, userId));
    expect(streak?.days).toBe(second.streakDays);
    expect(second.streakDays).toBeGreaterThan(7);

    const pending = await listPending(db, userId);
    expect(pending.map((item) => item.type).sort()).toEqual([
      'category',
      'missing_from_list',
      'possible_duplicate',
    ]);

    const today = businessDayOf(now);
    const days = await listDays(db, userId, { from: '2026-11-01', to: today }, now);
    const tuesday = days.find((day) => day.businessDay === '2026-11-03');
    expect(tuesday).toMatchObject({ inCents: 41_200, outCents: 18_000, leftCents: 23_200 });
    expect(tuesday?.levelText).toBe('completo');
    expect(days.some((day) => day.cashUnreviewed && day.levelText === 'a medias')).toBe(true);
    expect(days.some((day) => day.levelText === 'sin cierre')).toBe(true);
    const tuesdayEntries = await getDayEntries(db, userId, '2026-11-03', now);
    expect(tuesdayEntries.entries.some((e) => e.labelText === 'Con captura')).toBe(true);
    expect(tuesdayEntries.entries.some((e) => e.labelText === 'Lo contaste tú')).toBe(true);
    const week = await getWeekView(db, userId, today, now);
    expect(week.inCents).toBeGreaterThan(0);
  });
});
