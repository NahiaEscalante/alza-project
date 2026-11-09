import { describe, expect, it } from 'vitest';
import {
  detectActivitySpike,
  detectInstantYesReplies,
  holderKey,
  INSTANT_REPLY_MAX_MS,
  sharedScreenshotFlags,
} from './rules.js';

describe('detectActivitySpike (13.4)', () => {
  it('flags more than 3× the weekly average', () => {
    expect(
      detectActivitySpike({ currentWeekCount: 61, baselineWeekCounts: [20, 20, 20, 20] }),
    ).toEqual({ currentWeekCount: 61, weeklyAverage: 20, baselineWeeks: 4 });
  });

  it('exactly 3× is not «más del triple»', () => {
    expect(
      detectActivitySpike({ currentWeekCount: 60, baselineWeekCounts: [20, 20, 20] }),
    ).toBeNull();
  });

  it('needs at least 2 weeks of history with some activity', () => {
    expect(detectActivitySpike({ currentWeekCount: 100, baselineWeekCounts: [5] })).toBeNull();
    expect(detectActivitySpike({ currentWeekCount: 100, baselineWeekCounts: [0, 0] })).toBeNull();
    expect(
      detectActivitySpike({ currentWeekCount: 31, baselineWeekCounts: [0, 20] }),
    ).toMatchObject({
      weeklyAverage: 10,
    });
  });
});

describe('detectInstantYesReplies (13.4)', () => {
  const at = (seconds: number) => new Date(Date.UTC(2026, 10, 9, 2, 0, seconds));
  const reply = (seconds: number, cashCheck: 'balanced' | 'adjusted' = 'balanced') => ({
    sentAt: at(0),
    repliedAt: at(seconds),
    cashCheck,
  });

  it('flags 5+ replies, all within seconds and all «sí»', () => {
    expect(detectInstantYesReplies([3, 4, 5, 2, 8].map((s) => reply(s)))).toEqual({
      closes: 5,
      slowestReplyMs: 8_000,
    });
  });

  it('«siempre»: one slow reply, one adjustment or too few replies clear it', () => {
    const slow = INSTANT_REPLY_MAX_MS / 1000 + 1;
    expect(detectInstantYesReplies([3, 4, 5, 2, slow].map((s) => reply(s)))).toBeNull();
    expect(
      detectInstantYesReplies([...[3, 4, 5, 2].map((s) => reply(s)), reply(3, 'adjusted')]),
    ).toBeNull();
    expect(detectInstantYesReplies([3, 4, 5, 2].map((s) => reply(s)))).toBeNull();
  });
});

describe('sharedScreenshotFlags (13.4)', () => {
  const seen = (userId: string, sha256: string, minute: number) => ({
    userId,
    sha256,
    mediaFileId: `${userId}-${sha256}`,
    firstSeenAt: new Date(Date.UTC(2026, 10, 9, 15, minute)),
  });

  it('flags every account after the first one that sent the same file', () => {
    expect(
      sharedScreenshotFlags([
        seen('b', 'x', 5),
        seen('a', 'x', 1),
        seen('c', 'x', 9),
        seen('a', 'y', 2),
      ]),
    ).toEqual([
      { userId: 'b', sha256: 'x', mediaFileId: 'b-x', firstUserId: 'a' },
      { userId: 'c', sha256: 'x', mediaFileId: 'c-x', firstUserId: 'a' },
    ]);
  });

  it('the same account sending it twice is a duplicate (11.4), not fraud', () => {
    expect(sharedScreenshotFlags([seen('a', 'x', 1), seen('a', 'x', 3)])).toEqual([]);
  });
});

describe('holderKey', () => {
  it('is stable and does not contain the name', () => {
    expect(holderKey('marta quispe')).toBe(holderKey('marta quispe'));
    expect(holderKey('marta quispe')).not.toContain('marta');
    expect(holderKey('marta quispe')).not.toBe(holderKey('marta quispe h'));
  });
});
