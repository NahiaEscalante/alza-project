import { describe, expect, it } from 'vitest';
import { entry, screenshotEntry } from './test-support.js';
import { addDays } from './time.js';
import type { CloseLevel } from './types.js';
import {
  buildWeeklySummary,
  compareWeeks,
  NO_COMPARISON_TEXT,
  pendingWeeklySummaryWeek,
} from './weekly-summary.js';

const MONDAY = '2026-11-09';
const SUNDAY = '2026-11-15';

function closes(monday: string, levels: (CloseLevel | null)[]) {
  return levels.map((level, i) => ({ businessDay: addDays(monday, i), level }));
}

describe('buildWeeklySummary (11.11, D38)', () => {
  const entries = [
    screenshotEntry({ businessDay: MONDAY, amountCents: 10_000 }),
    entry({ businessDay: SUNDAY, amountCents: 5_000 }),
    entry({
      businessDay: '2026-11-12',
      amountCents: 2_000,
      direction: 'out',
      category: 'inventory',
    }),
    entry({ businessDay: '2026-11-16', amountCents: 99_000 }),
    entry({ businessDay: '2026-11-08', amountCents: 99_000 }),
  ];
  const week = closes(MONDAY, [
    'complete',
    'complete',
    'partial',
    'complete',
    null,
    'complete',
    'complete',
  ]);

  it('on Sunday: amounts Monday–Sunday, levels Monday–Saturday', () => {
    const summary = buildWeeklySummary({
      week: '2026-11-12',
      sendDay: SUNDAY,
      entries,
      closes: week,
      pointsEntries: [
        { points: 10, businessDay: '2026-11-10' },
        { points: -100, businessDay: '2026-11-11' },
        { points: 50, businessDay: '2026-11-16' },
      ],
      streakDays: 12,
      freezesUsed: 1,
    });
    expect(summary.weekStart).toBe(MONDAY);
    expect(summary.weekEnd).toBe(SUNDAY);
    expect(summary.indicators.inCents).toBe(15_000);
    expect(summary.indicators.outCents).toBe(2_000);
    expect(summary.indicators.leftCents).toBe(13_000);
    expect(summary.countedDays).toHaveLength(6);
    expect(summary).toMatchObject({
      completeCount: 4,
      partialCount: 1,
      noCloseCount: 1,
      pointsEarned: 10,
      streakDays: 12,
      freezesUsed: 1,
    });
  });

  it('sent later (no close on Sunday): all 7 days are final and counted', () => {
    const summary = buildWeeklySummary({
      week: MONDAY,
      sendDay: '2026-11-17',
      entries,
      closes: week,
    });
    expect(summary.countedDays).toHaveLength(7);
    expect(summary.completeCount).toBe(5);
  });
});

describe('compareWeeks (PR02)', () => {
  const build = (monday: string, levels: CloseLevel[]) =>
    buildWeeklySummary({
      week: monday,
      sendDay: addDays(monday, 6),
      entries: [entry({ businessDay: monday, amountCents: monday === MONDAY ? 30_000 : 20_000 })],
      closes: closes(monday, levels),
    });

  it('compares when both weeks have ≥ 4 complete closes (Monday–Saturday counts)', () => {
    const current = build(MONDAY, [
      'complete',
      'complete',
      'complete',
      'complete',
      'partial',
      'partial',
      'complete',
    ]);
    const previous = build('2026-11-02', [
      'complete',
      'complete',
      'complete',
      'complete',
      'no_close',
      'no_close',
    ]);
    expect(compareWeeks(current, previous)).toEqual({
      comparable: true,
      inDeltaCents: 10_000,
      outDeltaCents: 0,
      leftDeltaCents: 10_000,
    });
  });

  it('a Sunday complete close does not count yet: 3 + Sunday is not enough', () => {
    const current = build(MONDAY, [
      'complete',
      'complete',
      'complete',
      'partial',
      'partial',
      'partial',
      'complete',
    ]);
    const previous = build('2026-11-02', [
      'complete',
      'complete',
      'complete',
      'complete',
      'complete',
      'complete',
    ]);
    expect(compareWeeks(current, previous)).toEqual({
      comparable: false,
      text: NO_COMPARISON_TEXT,
    });
    expect(compareWeeks(previous, null)).toEqual({ comparable: false, text: NO_COMPARISON_TEXT });
  });
});

describe('pendingWeeklySummaryWeek', () => {
  it('Sunday carries its own week once', () => {
    expect(pendingWeeklySummaryWeek({ closeDay: SUNDAY, lastSummaryWeekStart: '2026-11-02' })).toBe(
      MONDAY,
    );
    expect(pendingWeeklySummaryWeek({ closeDay: SUNDAY, lastSummaryWeekStart: MONDAY })).toBeNull();
  });

  it('the first close after a Sunday without close carries the previous week', () => {
    expect(
      pendingWeeklySummaryWeek({ closeDay: '2026-11-17', lastSummaryWeekStart: '2026-11-02' }),
    ).toBe(MONDAY);
    expect(
      pendingWeeklySummaryWeek({ closeDay: '2026-11-17', lastSummaryWeekStart: MONDAY }),
    ).toBeNull();
    expect(
      pendingWeeklySummaryWeek({ closeDay: '2026-11-11', lastSummaryWeekStart: '2026-11-02' }),
    ).toBeNull();
  });
});
