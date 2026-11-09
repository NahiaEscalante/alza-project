import { describe, expect, it } from 'vitest';
import {
  type AttributionInput,
  attributeMessage,
  type CloseRef,
  closeForReply,
  placementFor,
} from './attribution.js';
import { lima } from './test-support.js';

function input(overrides: Partial<AttributionInput>): AttributionInput {
  return {
    receivedAt: lima('2026-11-10T10:00'),
    operationAt: null,
    intent: 'record',
    closes: [],
    ...overrides,
  };
}

const sentYesterday: CloseRef = {
  businessDay: '2026-11-09',
  status: 'sent',
  sentAt: lima('2026-11-09T21:00'),
  repliedAt: null,
};

describe('attributeMessage (11.1)', () => {
  it('text or audio belongs to the day it arrived', () => {
    expect(attributeMessage(input({ receivedAt: lima('2026-11-11T01:00') }))).toMatchObject({
      kind: 'entry',
      businessDay: '2026-11-10',
      dateSource: 'arrival',
      placement: 'normal',
      afterClose: false,
    });
  });

  it('a screenshot with a date belongs to the day of the operation', () => {
    expect(
      attributeMessage(
        input({ operationAt: lima('2026-11-08T20:44'), receivedAt: lima('2026-11-10T09:00') }),
      ),
    ).toMatchObject({ businessDay: '2026-11-08', dateSource: 'screenshot' });
  });

  it('a screenshot dated in the future uses the arrival day and says so', () => {
    expect(
      attributeMessage(
        input({ operationAt: lima('2026-11-12T10:00'), receivedAt: lima('2026-11-10T10:00') }),
      ),
    ).toMatchObject({ businessDay: '2026-11-10', dateSource: 'arrival', futureDateIgnored: true });
    expect(
      attributeMessage(
        input({ operationAt: lima('2026-11-10T10:03'), receivedAt: lima('2026-11-10T10:00') }),
      ),
    ).toMatchObject({ dateSource: 'screenshot', futureDateIgnored: false });
  });

  it('a close reply belongs to the unanswered close, also after midnight', () => {
    const closes = [
      { ...sentYesterday, businessDay: '2026-11-10', sentAt: lima('2026-11-10T21:00') },
    ];
    expect(
      attributeMessage(
        input({ intent: 'close_reply', receivedAt: lima('2026-11-11T00:20'), closes }),
      ),
    ).toEqual({ kind: 'close_reply', businessDay: '2026-11-10', timing: 'on_time' });
  });

  it('an explicit WhatsApp reply to a close message wins', () => {
    expect(
      attributeMessage(
        input({
          intent: 'record',
          repliesToCloseOfDay: '2026-11-09',
          receivedAt: lima('2026-11-10T13:00'),
        }),
      ),
    ).toEqual({ kind: 'close_reply', businessDay: '2026-11-09', timing: 'late' });
  });

  it('intent close_reply without an unanswered close is treated as a normal message', () => {
    const replied = {
      ...sentYesterday,
      status: 'replied' as const,
      repliedAt: lima('2026-11-09T21:10'),
    };
    expect(attributeMessage(input({ intent: 'close_reply', closes: [replied] }))).toMatchObject({
      kind: 'entry',
      businessDay: '2026-11-10',
    });
  });
});

describe('closeForReply / placementFor', () => {
  it('prefers the most recently sent unanswered close of today or yesterday', () => {
    const today: CloseRef = {
      businessDay: '2026-11-10',
      status: 'sent',
      sentAt: lima('2026-11-10T21:00'),
      repliedAt: null,
    };
    const old: CloseRef = {
      ...sentYesterday,
      businessDay: '2026-11-05',
      sentAt: lima('2026-11-05T21:00'),
    };
    expect(closeForReply([sentYesterday, today, old], lima('2026-11-10T21:30'))).toBe(today);
    expect(closeForReply([old], lima('2026-11-10T21:30'))).toBeNull();
    const expiredNoReply: CloseRef = { ...sentYesterday, status: 'final' };
    expect(closeForReply([expiredNoReply], lima('2026-11-10T12:30'))).toBe(expiredNoReply);
  });

  it.each([
    [null, 'normal'],
    ['open', 'normal'],
    ['sent', 'joins_sent_close'],
    ['awaiting_clarification', 'joins_sent_close'],
    ['replied', 'after_close'],
    ['expired', 'after_close'],
    ['final', 'after_close'],
    ['no_activity', 'after_close'],
  ] as const)('close %s → %s', (status, placement) => {
    expect(placementFor(status)).toBe(placement);
  });
});
