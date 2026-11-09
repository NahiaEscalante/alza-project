import { describe, expect, it } from 'vitest';
import { lima } from './test-support.js';
import { shouldSendUnreadableTip } from './tips.js';

describe('shouldSendUnreadableTip (WA-19, D28, D42, case 28)', () => {
  const base = {
    consecutiveUnreadable: 3,
    userCreatedAt: lima('2026-11-01T10:00'),
    lastTipSentAt: null,
    now: lima('2026-11-10T15:00'),
  };

  it('third unreadable screenshot in a row during the first 2 weeks → tip', () => {
    expect(shouldSendUnreadableTip(base)).toBe(true);
  });

  it('not before the third one, not after 2 weeks, at most once per business day', () => {
    expect(shouldSendUnreadableTip({ ...base, consecutiveUnreadable: 2 })).toBe(false);
    expect(shouldSendUnreadableTip({ ...base, now: lima('2026-11-15T10:00') })).toBe(false);
    expect(shouldSendUnreadableTip({ ...base, lastTipSentAt: lima('2026-11-10T09:00') })).toBe(
      false,
    );
    expect(shouldSendUnreadableTip({ ...base, lastTipSentAt: lima('2026-11-09T22:00') })).toBe(
      true,
    );
  });
});
