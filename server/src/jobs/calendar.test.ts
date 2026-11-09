import { describe, expect, it } from 'vitest';
import { limaInstant, pointsDeadline } from '../domain/index.js';
import { daysFromTo, lastFinalizableDay, monthsBefore } from './calendar.js';

describe('lastFinalizableDay', () => {
  it.each([
    // [calendar date, hour, minute, expected day]
    ['2026-11-10', 12, 0, '2026-11-09'],
    ['2026-11-10', 18, 30, '2026-11-09'],
    ['2026-11-10', 11, 59, '2026-11-08'],
    // 02:00 of Tuesday still belongs to Monday's business day; Monday is not due yet.
    ['2026-11-10', 2, 0, '2026-11-08'],
    ['2026-11-10', 4, 0, '2026-11-08'],
  ])('at %s %i:%i → %s', (date, hour, minute, expected) => {
    expect(lastFinalizableDay(limaInstant(date, hour, minute))).toBe(expected);
  });

  it('is always a day whose deadline passed, and the next one is not due', () => {
    for (let h = 0; h < 48; h++) {
      const now = new Date(limaInstant('2026-11-09', 0).getTime() + h * 3_600_000 + 1);
      const day = lastFinalizableDay(now);
      expect(pointsDeadline(day).getTime()).toBeLessThanOrEqual(now.getTime());
      const next = daysFromTo(day, '2026-12-31')[1] as string;
      expect(pointsDeadline(next).getTime()).toBeGreaterThan(now.getTime());
    }
  });
});

describe('monthsBefore', () => {
  it('keeps the Lima wall clock and clamps the month end', () => {
    expect(monthsBefore(limaInstant('2026-11-10', 3, 0), 6)).toEqual(limaInstant('2026-05-10', 3));
    expect(monthsBefore(limaInstant('2026-08-31', 3, 0), 6)).toEqual(limaInstant('2026-02-28', 3));
  });
});

describe('daysFromTo', () => {
  it('includes both ends and is empty when reversed', () => {
    expect(daysFromTo('2026-11-08', '2026-11-10')).toEqual([
      '2026-11-08',
      '2026-11-09',
      '2026-11-10',
    ]);
    expect(daysFromTo('2026-11-10', '2026-11-09')).toEqual([]);
  });
});
