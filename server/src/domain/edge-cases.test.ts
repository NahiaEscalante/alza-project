/**
 * Spec 11.12 «Casos límite»: one test per row that does not depend on the AI. Rows 9, 14–17, 22,
 * 24, 27, 29 and 32 are about interpretation, messaging or antifraud flows outside the domain.
 */
import { describe, expect, it } from 'vitest';
import {
  attributeMessage,
  businessDayOf,
  type CloseRef,
  checkOperationDuplicate,
  closeReplyTiming,
  computeIndicators,
  decideCategory,
  decideDirection,
  evaluateDeclaredTotal,
  findCorrectionTarget,
  INITIAL_PIN_ATTEMPTS,
  improvedLevel,
  isoWeekday,
  isSameFile,
  type LedgerEntryView,
  type OperationCandidate,
  onDemandCloseDecision,
  parseAmountToCents,
  registerPinAttempt,
  shouldOfferPersonalRule,
  shouldSendUnreadableTip,
} from './index.js';
import { entry, lima, screenshotEntry } from './test-support.js';

const HOLDERS = ['Marta Quispe Huamán'];

function asCandidate(e: LedgerEntryView): OperationCandidate {
  return {
    amountCents: e.amountCents,
    direction: e.direction,
    paymentMethod: e.paymentMethod,
    counterpartyNormalized: e.counterpartyNormalized,
    operationNumber: e.operationNumber,
    operationAt: e.operationAt,
  };
}

const yesterday = '2026-11-09';
const sentClose = (status: CloseRef['status'], repliedAt: Date | null = null): CloseRef => ({
  businessDay: yesterday,
  status,
  sentAt: lima('2026-11-09T21:00'),
  repliedAt,
});

describe('11.12 edge cases', () => {
  it('case 1: the same screenshot forwarded again is an exact duplicate (no doubt)', () => {
    expect(isSameFile('f00d', ['beef', 'f00d'])).toBe(true);
    const first = screenshotEntry({ operationNumber: '32811444', amountCents: 200 });
    expect(checkOperationDuplicate(asCandidate(first), [first])).toEqual({
      kind: 'exact_duplicate',
      entryId: first.id,
    });
  });

  it('case 2: two S/2 Yapes from the same kid with different operation numbers are two sales', () => {
    const kid = {
      amountCents: 200,
      counterpartyNormalized: 'fernando sar*',
      operationAt: lima('2026-11-10T16:00'),
    };
    const first = screenshotEntry({ ...kid, operationNumber: '111' });
    const second = screenshotEntry({ ...kid, operationNumber: '112' });
    expect(checkOperationDuplicate(asCandidate(second), [first])).toEqual({ kind: 'new' });
    expect(computeIndicators([first, second]).inCents).toBe(400);
  });

  it('case 3: two screenshots without number, same amount and counterparty, 1 minute apart → possible duplicate', () => {
    const first = screenshotEntry({
      amountCents: 2_000,
      counterpartyNormalized: 'rosa m',
      operationAt: lima('2026-11-10T15:10'),
    });
    const second = screenshotEntry({
      amountCents: 2_000,
      counterpartyNormalized: 'rosa m',
      operationAt: lima('2026-11-10T15:11'),
    });
    expect(checkOperationDuplicate(asCandidate(second), [first])).toEqual({
      kind: 'possible_duplicate',
      entryId: first.id,
    });
  });

  it('case 4: yesterday’s Yape sent today, while yesterday’s close waits for an answer → joins that close', () => {
    expect(
      attributeMessage({
        receivedAt: lima('2026-11-10T09:00'),
        operationAt: lima('2026-11-09T19:30'),
        intent: 'record',
        closes: [sentClose('sent')],
      }),
    ).toMatchObject({ businessDay: yesterday, placement: 'joins_sent_close', afterClose: false });
  });

  it('case 5: yesterday’s Yape after yesterday’s close was answered or is final → silent adjustment (PR03)', () => {
    for (const close of [
      sentClose('replied', lima('2026-11-09T21:10')),
      sentClose('final', lima('2026-11-09T21:10')),
    ]) {
      expect(
        attributeMessage({
          receivedAt: lima('2026-11-10T13:00'),
          operationAt: lima('2026-11-09T19:30'),
          intent: 'record',
          closes: [close],
        }),
      ).toMatchObject({ businessDay: yesterday, placement: 'after_close', afterClose: true });
    }
  });

  it('case 6: photo of a client’s phone showing a payment to her → in, as a sale', () => {
    const direction = decideDirection({
      header: '¡Yapeaste!',
      counterpartyName: 'Marta Q.',
      visibleHolderName: null,
      holderRole: 'payer',
      holders: HOLDERS,
    });
    expect(direction).toMatchObject({ kind: 'resolved', direction: 'in' });
    expect(
      decideCategory({ direction: 'in', counterpartyNormalized: null, rules: [] }).category,
    ).toBe('sale');
  });

  it('case 7: payment to the distributor → out, category per 11.3', () => {
    expect(
      decideDirection({
        header: '¡Yapeaste!',
        counterpartyName: 'Distribuidora Sur',
        visibleHolderName: null,
        holderRole: 'payer',
        holders: HOLDERS,
      }),
    ).toMatchObject({ kind: 'resolved', direction: 'out' });
    expect(
      decideDirection({
        header: null,
        counterpartyName: 'Distribuidora Sur',
        visibleHolderName: 'Marta Quispe H.',
        holderRole: 'payer',
        holders: HOLDERS,
      }),
    ).toMatchObject({ kind: 'resolved', direction: 'out' });
    expect(
      decideCategory({ direction: 'out', counterpartyNormalized: 'distribuidora sur', rules: [] }),
    ).toEqual({ category: 'unclassified', fromHistory: false, needsCategoryDoubt: true });
  });

  it('case 8: an unreadable amount is never invented: the parser refuses and a doubt is created', () => {
    for (const unreadable of ['', '1?.50', '12.505', 'S/ ..']) {
      expect(parseAmountToCents(unreadable).ok).toBe(false);
    }
  });

  it('case 10: «hoy vendí 150» without method adds nothing → ambiguous_total', () => {
    expect(evaluateDeclaredTotal({ amountCents: 15_000, method: 'unknown' }, [])).toEqual({
      kind: 'ambiguous_total',
    });
  });

  const ninetyFive = () => [entry({ amountCents: 4_500 }), entry({ amountCents: 5_000 })];

  it('case 11: «hoy vendí 200 en efectivo» with S/95 recorded → +S/105 unitemized (PR09)', () => {
    const outcome = evaluateDeclaredTotal({ amountCents: 20_000, method: 'cash' }, ninetyFive());
    expect(outcome).toMatchObject({
      kind: 'record_unitemized',
      amountCents: 10_500,
      paymentMethod: 'cash',
    });
  });

  it('case 12: «hoy vendí 80 en efectivo» with S/95 recorded → nothing added, cash doubt', () => {
    expect(evaluateDeclaredTotal({ amountCents: 8_000, method: 'cash' }, ninetyFive())).toEqual({
      kind: 'cash_total_below_recorded',
      recordedCents: 9_500,
      declaredCents: 8_000,
    });
  });

  it('case 13: «eso no, eran 52» corrects her last entry of the last 15 min; 2 candidates → doubt', () => {
    const now = lima('2026-11-10T15:00');
    const last = entry({ id: 'last', inboundMessageId: 'm9', createdAt: lima('2026-11-10T14:50') });
    expect(findCorrectionTarget([last], now)).toEqual({ kind: 'target', entryId: 'last' });
    const two = [
      entry({ id: 'a', inboundMessageId: 'audio', createdAt: lima('2026-11-10T14:50') }),
      entry({ id: 'b', inboundMessageId: 'audio', createdAt: lima('2026-11-10T14:50') }),
    ];
    expect(findCorrectionTarget(two, now).kind).toBe('ambiguous');
  });

  it('case 18: «cierre» with today’s close sent and unanswered → WA-22', () => {
    expect(
      onDemandCloseDecision({ closeStatus: 'sent', entryCount: 4, clarificationCount: 1 }),
    ).toBe('already_sent');
  });

  it('case 19: answering the close at 11:50 of the next day is valid with points', () => {
    expect(closeReplyTiming('2026-11-10', lima('2026-11-11T11:50'))).toBe('on_time');
  });

  it('case 20: answering at 12:30 is applied as improved level, without points (WA-18)', () => {
    expect(closeReplyTiming('2026-11-10', lima('2026-11-11T12:30'))).toBe('late');
    expect(
      improvedLevel({ finalLevel: 'no_close', currentImprovedLevel: null, newLevel: 'complete' }),
    ).toBe('complete');
  });

  it('case 21: an audio of 20:59 that arrives at 21:05 after the close goes to that day', () => {
    const close: CloseRef = {
      businessDay: '2026-11-10',
      status: 'sent',
      sentAt: lima('2026-11-10T21:00'),
      repliedAt: null,
    };
    const unanswered = attributeMessage({
      receivedAt: lima('2026-11-10T21:05'),
      operationAt: null,
      intent: 'record',
      closes: [close],
    });
    expect(unanswered).toMatchObject({ businessDay: '2026-11-10', placement: 'joins_sent_close' });
    const answered = attributeMessage({
      receivedAt: lima('2026-11-10T21:05'),
      operationAt: null,
      intent: 'record',
      closes: [{ ...close, status: 'replied', repliedAt: lima('2026-11-10T21:03') }],
    });
    expect(answered).toMatchObject({
      businessDay: '2026-11-10',
      placement: 'after_close',
      afterClose: true,
    });
  });

  it('case 23: a Yape from her brother counts as a sale (D09)', () => {
    expect(
      decideCategory({ direction: 'in', counterpartyNormalized: 'juan quispe', rules: [] })
        .category,
    ).toBe('sale');
  });

  it('case 25: the third «personal» mark for «Carlos R.» offers the rule; it applies only if accepted', () => {
    expect(shouldOfferPersonalRule({ personalMarks: 3, hasActiveRule: false })).toBe(true);
    expect(
      decideCategory({ direction: 'in', counterpartyNormalized: 'carlos r', rules: [] }).category,
    ).toBe('sale');
  });

  it('case 26: S/95 recorded, «hoy vendí 200 en efectivo», then «vendí 5 de pan» → +S/105 and +S/5', () => {
    const entries = ninetyFive();
    const outcome = evaluateDeclaredTotal({ amountCents: 20_000, method: 'cash' }, entries);
    if (outcome.kind !== 'record_unitemized') throw new Error('expected a record');
    entries.push(entry({ amountCents: outcome.amountCents, label: 'unitemized' }));
    entries.push(entry({ amountCents: 500 }));
    expect(computeIndicators(entries).cashSalesCents).toBe(20_500);
  });

  it('case 28: third unreadable screenshot in a row in her first 2 weeks → tip, once a day', () => {
    expect(
      shouldSendUnreadableTip({
        consecutiveUnreadable: 3,
        userCreatedAt: lima('2026-11-05T10:00'),
        lastTipSentAt: null,
        now: lima('2026-11-10T10:00'),
      }),
    ).toBe(true);
  });

  it('case 30: 5 wrong PINs lock for 15 minutes and add a line to the next close', () => {
    let result = registerPinAttempt(INITIAL_PIN_ATTEMPTS, false, lima('2026-11-10T19:00'));
    for (let i = 1; i < 5; i++)
      result = registerPinAttempt(result.state, false, lima('2026-11-10T19:00'));
    expect(result).toMatchObject({ event: 'locked', notifyInNextClose: true });
    expect(result.state.lockedUntil).toEqual(lima('2026-11-10T19:15'));
  });

  it('case 31: a Yape received at 00:30 on Saturday night counts for Saturday', () => {
    const day = businessDayOf(lima('2026-11-15T00:30'));
    expect(day).toBe('2026-11-14');
    expect(isoWeekday(day)).toBe(6);
  });

  it('case 33: a payment to her husband’s account, declared as additional holder, is a sale (D31)', () => {
    const holders = ['Marta Quispe Huamán', 'Pedro Rojas Vega'];
    expect(
      decideDirection({
        header: null,
        counterpartyName: 'Ana T.',
        visibleHolderName: 'Pedro Rojas V.',
        holderRole: 'payee',
        holders,
      }),
    ).toMatchObject({ kind: 'resolved', direction: 'in' });
    expect(
      decideDirection({
        header: '¡Te Yapearon!',
        counterpartyName: 'Ana T.',
        visibleHolderName: null,
        holderRole: 'payee',
        holders,
      }),
    ).toMatchObject({ kind: 'resolved', direction: 'in' });
  });

  it('case 34: «cierre» on a day without entries or doubts → WA-21, no close (PR16, D39)', () => {
    expect(onDemandCloseDecision({ closeStatus: null, entryCount: 0, clarificationCount: 0 })).toBe(
      'nothing_recorded',
    );
  });
});
