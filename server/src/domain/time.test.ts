import { describe, expect, it } from 'vitest';
import { lima } from './test-support.js';
import {
  addDays,
  addMonths,
  businessDayEnd,
  businessDayOf,
  businessDayStart,
  closeDueAt,
  closeTimeMinutes,
  compareCloseTimes,
  daysBetween,
  isBeforePointsDeadline,
  isIsoDate,
  isoWeekday,
  isoWeekOf,
  isSunday,
  isWithinLast24Hours,
  LIMA_UTC_OFFSET_MINUTES,
  limaInstant,
  limaWallClock,
  parseCloseTime,
  pointsDeadline,
  weekDays,
  weekStart,
} from './time.js';

describe('Lima offset', () => {
  it('matches the tz database (UTC−5, no daylight saving) across the year', () => {
    const format = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Lima',
      timeZoneName: 'longOffset',
    });
    for (const month of [0, 3, 6, 9, 11]) {
      const offset = format
        .formatToParts(new Date(Date.UTC(2026, month, 15, 12)))
        .find((part) => part.type === 'timeZoneName')?.value;
      expect(offset).toBe('GMT-05:00');
    }
    expect(LIMA_UTC_OFFSET_MINUTES).toBe(-300);
  });
});

describe('businessDayOf (D12)', () => {
  it.each([
    ['2026-11-10T04:00', '2026-11-10'],
    ['2026-11-10T03:59', '2026-11-09'],
    ['2026-11-10T12:00', '2026-11-10'],
    ['2026-11-10T23:59', '2026-11-10'],
    ['2026-11-11T00:30', '2026-11-10'],
    ['2026-11-11T03:59', '2026-11-10'],
    ['2026-01-01T02:00', '2025-12-31'],
  ])('%s Lima → %s', (local, day) => {
    expect(businessDayOf(lima(local))).toBe(day);
  });

  it('does not depend on the instant being written in UTC', () => {
    expect(businessDayOf(new Date('2026-11-11T05:30:00Z'))).toBe('2026-11-10');
    expect(businessDayOf(new Date('2026-11-11T09:00:00Z'))).toBe('2026-11-11');
  });

  it('has start and end (exclusive) at 4:00 a. m. Lima', () => {
    expect(businessDayStart('2026-11-10').toISOString()).toBe('2026-11-10T09:00:00.000Z');
    expect(businessDayEnd('2026-11-10').toISOString()).toBe('2026-11-11T09:00:00.000Z');
  });
});

describe('calendar helpers', () => {
  it('adds days and months (clamped), and validates dates', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonths('2026-05-10', 6)).toBe('2026-11-10');
    expect(daysBetween('2026-11-09', '2026-11-15')).toBe(6);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(() => addDays('10/11/2026', 1)).toThrow(RangeError);
  });

  it('reads the Lima wall clock', () => {
    expect(limaWallClock(new Date('2026-11-11T05:30:00Z'))).toEqual({
      date: '2026-11-11',
      hour: 0,
      minute: 30,
    });
    expect(limaInstant('2026-11-11', 12).toISOString()).toBe('2026-11-11T17:00:00.000Z');
  });
});

describe('week (Monday 4:00 to Monday 3:59)', () => {
  it('knows weekdays and the Monday–Sunday business week', () => {
    expect(isoWeekday('2026-11-09')).toBe(1);
    expect(isoWeekday('2026-11-15')).toBe(7);
    expect(isSunday('2026-11-15')).toBe(true);
    expect(weekStart('2026-11-15')).toBe('2026-11-09');
    expect(weekDays('2026-11-11')).toEqual([
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
      '2026-11-15',
    ]);
  });

  it('puts Monday 3:59 a. m. in the previous week and 4:00 in the new one', () => {
    expect(isoWeekOf(businessDayOf(lima('2026-11-16T03:59')))).toBe('2026-W46');
    expect(isoWeekOf(businessDayOf(lima('2026-11-16T04:00')))).toBe('2026-W47');
  });

  it.each([
    ['2026-01-01', '2026-W01'],
    ['2026-11-10', '2026-W46'],
    ['2026-12-31', '2026-W53'],
    ['2027-01-03', '2026-W53'],
    ['2027-01-04', '2027-W01'],
    ['2024-12-30', '2025-W01'],
  ])('ISO week of %s is %s', (day, week) => {
    expect(isoWeekOf(day)).toBe(week);
  });
});

describe('points deadline (12:00 of D+1)', () => {
  it('accepts 11:50 and rejects 12:00 and 12:30 of the next day', () => {
    expect(pointsDeadline('2026-11-10')).toEqual(lima('2026-11-11T12:00'));
    expect(isBeforePointsDeadline('2026-11-10', lima('2026-11-11T11:50'))).toBe(true);
    expect(isBeforePointsDeadline('2026-11-10', lima('2026-11-11T12:00'))).toBe(false);
    expect(isBeforePointsDeadline('2026-11-10', lima('2026-11-11T12:30'))).toBe(false);
  });
});

describe('close time (04:00 to 02:00)', () => {
  it.each([
    ['20:00', 960],
    ['21:00:00', 1020],
    ['22:30', 1110],
    ['00:30', 1230],
    ['1:00', 1260],
    ['02:00', 1320],
    ['04:00', 0],
    ['15:00', 660],
  ])('%s is %i minutes after 4:00', (value, minutes) => {
    expect(parseCloseTime(value)).toBe(minutes);
  });

  it.each(['02:01', '03:30', '24:00', '21:60', 'nueve', ''])(
    '%s is not a valid close time',
    (value) => {
      expect(parseCloseTime(value)).toBeNull();
    },
  );

  it('orders close times within the business day and computes when the close is due', () => {
    expect(compareCloseTimes('01:00', '22:00')).toBeGreaterThan(0);
    expect(compareCloseTimes('20:00', '21:00')).toBeLessThan(0);
    expect(closeDueAt('2026-11-10', '21:00')).toEqual(lima('2026-11-10T21:00'));
    expect(closeDueAt('2026-11-10', '01:30')).toEqual(lima('2026-11-11T01:30'));
    expect(() => closeTimeMinutes('03:00')).toThrow(RangeError);
  });
});

describe('isWithinLast24Hours', () => {
  const now = lima('2026-11-10T21:00');
  it('is true up to exactly 24 hours before', () => {
    expect(isWithinLast24Hours(lima('2026-11-09T21:00'), now)).toBe(true);
    expect(isWithinLast24Hours(lima('2026-11-10T08:00'), now)).toBe(true);
    expect(isWithinLast24Hours(lima('2026-11-09T20:59'), now)).toBe(false);
    expect(isWithinLast24Hours(null, now)).toBe(false);
    expect(isWithinLast24Hours(lima('2026-11-10T21:01'), now)).toBe(false);
  });
});
