import { describe, expect, it } from 'vitest';
import {
  closeLevelAfterReply,
  closeReplyTiming,
  finalCloseLevel,
  hasCloseActivity,
  improvedLevel,
  onDemandCloseDecision,
  scheduledCloseDecision,
} from './close-level.js';
import { lima } from './test-support.js';

describe('closeLevelAfterReply (11.9)', () => {
  it.each([
    [true, 'balanced', 'complete'],
    [true, 'adjusted', 'complete'],
    [true, 'unsure', 'partial'],
    [true, null, 'partial'],
    [false, 'balanced', 'partial'],
    [false, 'unsure', 'partial'],
  ] as const)('doubts resolved=%s, cash=%s → %s', (resolved, cashCheck, level) => {
    expect(closeLevelAfterReply({ messageClarificationsResolved: resolved, cashCheck })).toBe(
      level,
    );
  });
});

describe('finalCloseLevel (12:00 of D+1)', () => {
  it('no close message or no reply → no_close', () => {
    const base = { messageClarificationsResolved: true, cashCheck: 'balanced' as const };
    expect(finalCloseLevel({ ...base, closeSent: false, repliedInTime: false })).toBe('no_close');
    expect(finalCloseLevel({ ...base, closeSent: true, repliedInTime: false })).toBe('no_close');
    expect(finalCloseLevel({ ...base, closeSent: true, repliedInTime: true })).toBe('complete');
  });

  it('a reply still waiting for a clarification ends up partial', () => {
    expect(
      finalCloseLevel({
        closeSent: true,
        repliedInTime: true,
        messageClarificationsResolved: false,
        cashCheck: 'balanced',
      }),
    ).toBe('partial');
  });
});

describe('improvedLevel (D17)', () => {
  it('records a better level after 12:00, never a worse or equal one', () => {
    expect(
      improvedLevel({ finalLevel: 'no_close', currentImprovedLevel: null, newLevel: 'complete' }),
    ).toBe('complete');
    expect(
      improvedLevel({ finalLevel: 'partial', currentImprovedLevel: null, newLevel: 'partial' }),
    ).toBeNull();
    expect(
      improvedLevel({
        finalLevel: 'no_close',
        currentImprovedLevel: 'complete',
        newLevel: 'partial',
      }),
    ).toBeNull();
    expect(
      improvedLevel({
        finalLevel: 'no_close',
        currentImprovedLevel: 'partial',
        newLevel: 'complete',
      }),
    ).toBe('complete');
  });

  it('closeReplyTiming: before 12:00 of D+1 is on time', () => {
    expect(closeReplyTiming('2026-11-10', lima('2026-11-11T11:50'))).toBe('on_time');
    expect(closeReplyTiming('2026-11-10', lima('2026-11-11T12:30'))).toBe('late');
  });
});

describe('scheduledCloseDecision (8.4, RF-CI-01/02, PR16)', () => {
  const base = {
    now: lima('2026-11-10T21:05'),
    closeTime: '21:00',
    lastMessageAt: lima('2026-11-10T18:00'),
    closeStatus: null,
    entryCount: 3,
    clarificationCount: 0,
  };

  it('sends when due, with a recent message and activity', () => {
    expect(scheduledCloseDecision(base)).toEqual({ decision: 'send', businessDay: '2026-11-10' });
  });

  it.each([
    ['before the close time', { now: lima('2026-11-10T20:55') }, 'not_due'],
    ['close already sent', { closeStatus: 'sent' as const }, 'already_sent'],
    ['nothing written in 24 h', { lastMessageAt: lima('2026-11-09T20:00') }, 'no_recent_message'],
    ['no entries nor doubts (PR16)', { entryCount: 0 }, 'no_activity'],
  ])('%s → %s', (_label, overrides, decision) => {
    expect(scheduledCloseDecision({ ...base, ...overrides }).decision).toBe(decision);
  });

  it('a 1:30 a. m. close is due after midnight, still for the same business day', () => {
    const late = { ...base, closeTime: '01:30' };
    expect(scheduledCloseDecision({ ...late, now: lima('2026-11-11T01:00') }).decision).toBe(
      'not_due',
    );
    expect(scheduledCloseDecision({ ...late, now: lima('2026-11-11T01:35') })).toEqual({
      decision: 'send',
      businessDay: '2026-11-10',
    });
  });

  it('a day with only a doubt still has activity', () => {
    expect(hasCloseActivity({ entryCount: 0, clarificationCount: 1 })).toBe(true);
    expect(hasCloseActivity({ entryCount: 0, clarificationCount: 0 })).toBe(false);
  });
});

describe('onDemandCloseDecision («cierre», RF-CI-03, D39, D49)', () => {
  it.each([
    [null, 2, 'send_close'],
    ['open', 0, 'nothing_recorded'],
    [null, 0, 'nothing_recorded'],
    ['sent', 2, 'already_sent'],
    ['awaiting_clarification', 2, 'already_sent'],
    ['replied', 2, 'already_sent'],
  ] as const)('status %s with %i entries → %s', (closeStatus, entryCount, decision) => {
    expect(onDemandCloseDecision({ closeStatus, entryCount, clarificationCount: 0 })).toBe(
      decision,
    );
  });
});
