import { describe, expect, it } from 'vitest';
import {
  applyDailyClose,
  INITIAL_STREAK,
  pointsBalance,
  pointsExpiration,
  type StreakState,
  weeklyBonus,
} from './points.js';
import { addDays } from './time.js';
import type { CloseLevel } from './types.js';

/** Applies levels from `start` on, one per day, returning every daily result. */
function run(levels: CloseLevel[], start = '2026-11-09', state: StreakState = INITIAL_STREAK) {
  let current = state;
  return levels.map((level, i) => {
    const result = applyDailyClose(current, addDays(start, i), level);
    current = result.state;
    return result;
  });
}

describe('applyDailyClose (13.1)', () => {
  it('complete → +10 and streak +1; partial → +4 and streak +1', () => {
    const [complete, partial] = run(['complete', 'partial']);
    expect(complete?.awards).toEqual([{ type: 'complete_close', points: 10 }]);
    expect(complete?.state.days).toBe(1);
    expect(partial?.awards).toEqual([{ type: 'partial_close', points: 4 }]);
    expect(partial?.state.days).toBe(2);
    expect(partial?.freezeUsed).toBe(false);
  });

  it('no_close uses a freeze (streak kept, no points) while freezes remain', () => {
    const results = run(['complete', 'no_close', 'no_close', 'no_close']);
    expect(results[1]).toMatchObject({ points: 0, freezeUsed: true, streakBroken: false });
    expect(results[1]?.state).toMatchObject({ days: 1, freezesUsed: 1 });
    expect(results[2]).toMatchObject({ freezeUsed: true, streakBroken: false });
    expect(results[2]?.state).toMatchObject({ days: 1, freezesUsed: 2 });
    expect(results[3]).toMatchObject({ freezeUsed: false, streakBroken: true });
    expect(results[3]?.state.days).toBe(0);
  });

  it('freezes renew on Monday and do not accumulate', () => {
    // Sat + Sun without close spend both freezes of week 46; Monday starts week 47 with 2 again.
    const start = '2026-11-13';
    const results = run(
      ['complete', 'no_close', 'no_close', 'no_close', 'no_close', 'no_close'],
      start,
    );
    expect(results[2]?.state).toMatchObject({ isoWeek: '2026-W46', freezesUsed: 2, days: 1 });
    expect(results[3]?.state).toMatchObject({ isoWeek: '2026-W47', freezesUsed: 1, days: 1 });
    expect(results[4]?.state).toMatchObject({ freezesUsed: 2, days: 1 });
    expect(results[5]).toMatchObject({ streakBroken: true });
    expect(results[5]?.state.freezesUsed).toBe(2);
  });

  it('day 7 gives +20 and the first-streak +30 once; day 14 only +20', () => {
    const results = run(Array.from({ length: 14 }, () => 'complete' as const));
    expect(results[6]?.awards).toEqual([
      { type: 'complete_close', points: 10 },
      { type: 'streak_7', points: 20 },
      { type: 'first_streak', points: 30 },
    ]);
    expect(results[6]?.state.firstStreakAwarded).toBe(true);
    expect(results[13]?.awards).toEqual([
      { type: 'complete_close', points: 10 },
      { type: 'streak_7', points: 20 },
    ]);
  });

  it('day 30 gives +50 (and not +20, 30 is not a multiple of 7)', () => {
    const state: StreakState = {
      days: 29,
      isoWeek: '2026-W46',
      freezesUsed: 0,
      firstStreakAwarded: true,
    };
    const result = applyDailyClose(state, '2026-11-10', 'partial');
    expect(result.awards).toEqual([
      { type: 'partial_close', points: 4 },
      { type: 'streak_30', points: 50 },
    ]);
  });

  it('a second 7-day streak after a break gets +20 but not the first-streak bonus again', () => {
    const state: StreakState = {
      days: 6,
      isoWeek: '2026-W46',
      freezesUsed: 0,
      firstStreakAwarded: true,
    };
    expect(applyDailyClose(state, '2026-11-10', 'complete').points).toBe(30);
  });

  it('a freeze day does not add a streak day, so the bonus moves one day later', () => {
    const results = run([
      'complete',
      'complete',
      'complete',
      'no_close',
      'complete',
      'complete',
      'complete',
      'complete',
    ]);
    expect(results[6]?.state.days).toBe(6);
    expect(results[7]?.awards.map((a) => a.type)).toContain('streak_7');
  });

  it('a first full week of complete closes: 70 + 20 (streak) + 30 (first streak) + 15 (week)', () => {
    const week = run(Array.from({ length: 7 }, () => 'complete' as const));
    expect(week.reduce((total, r) => total + r.points, 0)).toBe(120);
    expect(weeklyBonus(week.map(() => 'complete'))?.points).toBe(15);
  });
});

describe('weeklyBonus', () => {
  it('+15 with 5 or more complete closes', () => {
    expect(
      weeklyBonus([
        'complete',
        'complete',
        'complete',
        'complete',
        'complete',
        'partial',
        'no_close',
      ]),
    ).toEqual({
      type: 'weekly_bonus',
      points: 15,
    });
    expect(
      weeklyBonus([
        'complete',
        'complete',
        'complete',
        'complete',
        'partial',
        'partial',
        'partial',
      ]),
    ).toBeNull();
  });
});

describe('balance and expiry (D29)', () => {
  it('adds positive and negative entries', () => {
    expect(pointsBalance([{ points: 10 }, { points: 30 }, { points: -25 }])).toBe(15);
  });

  it('expires the whole balance after 6 months without any close', () => {
    const base = { balance: 340, lastCloseDay: '2026-05-10', sinceDay: '2026-01-01' };
    expect(pointsExpiration({ ...base, today: '2026-11-09' })).toBeNull();
    expect(pointsExpiration({ ...base, today: '2026-11-10' })).toEqual({
      type: 'expiration',
      points: -340,
    });
    expect(pointsExpiration({ ...base, balance: 0, today: '2027-01-01' })).toBeNull();
    expect(
      pointsExpiration({
        balance: 15,
        lastCloseDay: null,
        sinceDay: '2026-01-15',
        today: '2026-07-15',
      }),
    ).toEqual({ type: 'expiration', points: -15 });
  });
});
