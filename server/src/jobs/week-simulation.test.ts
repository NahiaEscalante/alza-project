/**
 * Fase 6 «Listo cuando»: HU-08 over two simulated weeks with a fake clock. Every scheduled task
 * runs at its Lima time each day (03:00, 04:00, 05:00, 12:00), the 12:00 one twice.
 *
 * Week A (Mon 9 – Sun 15 Nov 2026): C C C – C C C   (– = no close: freeze 1 of 2)
 * Week B (Mon 16 – Sun 22 Nov 2026): C P – – – C s  (s = sent, never answered)
 */
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestDb, hasTestDb } from '../../test/db.js';
import { dailyCloses } from '../db/schema.js';
import { addDays, type IsoDate, isoWeekOf, limaInstant } from '../domain/index.js';
import { createLogger } from '../lib/logger.js';
import { createJobRunner, type ScheduledJobName } from './registry.js';
import {
  createActiveUser,
  type DayScript,
  getClose,
  getPoints,
  getStreak,
  recordClose,
  total,
} from './test-support.js';

const WEEK_A = '2026-11-09';
const WEEK_B = addDays(WEEK_A, 7);
const PLAN: (DayScript | null)[] = [
  // Week A
  'complete',
  'complete',
  'complete',
  null,
  'complete',
  'complete',
  'complete',
  // Week B
  'complete',
  'partial',
  null,
  null,
  null,
  'complete',
  'sent',
];

describe.skipIf(!hasTestDb)('a simulated fortnight (HU-08, 13.1)', () => {
  const { pool, db } = createTestDb();
  afterAll(async () => {
    await pool.end();
  });

  it('gives points, streak, freezes, the first-streak bonus and the Monday bonus', async () => {
    const userId = await createActiveUser(db, { consentAt: limaInstant('2026-11-08', 10) });
    const runner = createJobRunner({
      db,
      storage: { delete: async () => false },
      logger: createLogger({ level: 'silent' }),
    });
    const scope = { userIds: [userId] };
    const runAt = (name: ScheduledJobName, day: IsoDate, hour: number) =>
      runner.runJobNow(name, limaInstant(day, hour), scope);

    /** One calendar day of the fake clock: the close of `day` is sent at night. */
    const live = async (index: number) => {
      const day = addDays(WEEK_A, index);
      await runAt('retention-cleanup', day, 3);
      await runAt('points-expiry', day, 4);
      await runAt('antifraud-scan', day, 5);
      await runAt('close-finalize', day, 12);
      await runAt('close-finalize', day, 12);
      const script = PLAN[index];
      if (script) await recordClose(db, userId, day, script);
    };

    const streakAfter: Record<number, { days: number; freezesUsed: number }> = {};
    for (let i = 0; i < PLAN.length; i++) {
      await live(i);
      const streak = await getStreak(db, userId);
      if (streak) streakAfter[i] = { days: streak.days, freezesUsed: streak.freezesUsed };
    }
    // Monday after week B: Sunday B becomes final.
    await live(PLAN.length);
    const final = await getStreak(db, userId);

    // Week A, read on the next day at 12:00: 1, 2, 3, freeze, 4, 5, then Sunday (6) on Monday B.
    expect(streakAfter[1]).toEqual({ days: 1, freezesUsed: 0 });
    expect(streakAfter[4]).toEqual({ days: 3, freezesUsed: 1 });
    expect(streakAfter[7]).toEqual({ days: 6, freezesUsed: 1 });
    // Monday B (read Tuesday): day 7 of the streak, freezes renewed on Monday.
    expect(streakAfter[8]).toEqual({ days: 7, freezesUsed: 0 });
    // Wed and Thu B use both freezes; Friday B breaks the streak.
    expect(streakAfter[11]).toEqual({ days: 8, freezesUsed: 2 });
    expect(streakAfter[12]).toEqual({ days: 0, freezesUsed: 2 });
    expect(streakAfter[13]).toEqual({ days: 1, freezesUsed: 2 });
    // Sunday B, sent and unanswered, no freezes left: the streak breaks again.
    expect(final).toMatchObject({
      days: 0,
      freezesUsed: 2,
      isoWeek: isoWeekOf(WEEK_B),
      firstStreakAwarded: true,
    });

    const points = await getPoints(db, userId);
    const byType = (type: string) => points.filter((p) => p.type === type);
    expect(total(byType('complete_close'))).toBe(80);
    expect(total(byType('partial_close'))).toBe(4);
    expect(byType('streak_7')).toMatchObject([
      { points: 20, createdAt: limaInstant(addDays(WEEK_B, 1), 12) },
    ]);
    expect(byType('first_streak')).toMatchObject([{ points: 30 }]);
    expect(byType('streak_30')).toEqual([]);

    // Monday 12:00 of week B: +15 for week A (6 complete), referencing Sunday A's close.
    const sundayA = await getClose(db, userId, addDays(WEEK_A, 6));
    expect(byType('weekly_bonus')).toEqual([
      {
        type: 'weekly_bonus',
        points: 15,
        referenceId: sundayA?.id,
        createdAt: limaInstant(WEEK_B, 12),
      },
    ]);

    // Week B had only 2 complete closes: no bonus on the Monday after.
    expect(total(points)).toBe(149);

    // Every day of both weeks is final, with one row per day.
    const closes = await db
      .select({ status: dailyCloses.status, level: dailyCloses.level })
      .from(dailyCloses)
      .where(eq(dailyCloses.userId, userId));
    expect(closes).toHaveLength(14);
    expect(closes.every((close) => close.status === 'final')).toBe(true);
    expect(closes.filter((close) => close.level === 'no_close')).toHaveLength(5);
  });
});
