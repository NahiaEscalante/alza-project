import { describe, expect, it } from 'vitest';
import {
  digitalShortfall,
  evaluateDeclaredTotal,
  recordedCashSales,
  recordedDigitalSales,
  resolveAmbiguousTotal,
} from './declared-totals.js';
import { computeIndicators } from './indicators.js';
import { entry, screenshotEntry } from './test-support.js';

/** 9 cash sales adding up to S/95. */
function ninetyFiveInCash() {
  return [
    ...Array.from({ length: 8 }, () => entry({ amountCents: 1_000 })),
    entry({ amountCents: 1_500 }),
  ];
}

describe('evaluateDeclaredTotal (11.5)', () => {
  it('a total without method never adds: ambiguous_total doubt', () => {
    expect(evaluateDeclaredTotal({ amountCents: 15_000, method: 'unknown' }, [])).toEqual({
      kind: 'ambiguous_total',
    });
  });

  it('cash T > A records T − A as unitemized cash and produces the PR09 notice', () => {
    expect(
      evaluateDeclaredTotal({ amountCents: 20_000, method: 'cash' }, ninetyFiveInCash()),
    ).toEqual({
      kind: 'record_unitemized',
      amountCents: 10_500,
      paymentMethod: 'cash',
      notice: { recordedCents: 9_500, declaredCents: 20_000, addedCents: 10_500 },
    });
  });

  it('cash T < A adds nothing and asks which one is right', () => {
    expect(
      evaluateDeclaredTotal({ amountCents: 8_000, method: 'cash' }, ninetyFiveInCash()),
    ).toEqual({
      kind: 'cash_total_below_recorded',
      recordedCents: 9_500,
      declaredCents: 8_000,
    });
  });

  it('cash T = A does nothing', () => {
    expect(
      evaluateDeclaredTotal({ amountCents: 9_500, method: 'cash' }, ninetyFiveInCash()),
    ).toEqual({
      kind: 'cash_total_matches',
    });
  });

  it('digital T > C adds nothing and leaves a close notice (D40)', () => {
    const entries = [
      screenshotEntry({ amountCents: 20_000 }),
      screenshotEntry({ amountCents: 5_000, paymentMethod: 'plin' }),
    ];
    expect(evaluateDeclaredTotal({ amountCents: 30_000, method: 'digital' }, entries)).toEqual({
      kind: 'digital_shortfall',
      missingCents: 5_000,
      declaredCents: 30_000,
      recordedCents: 25_000,
    });
    expect(evaluateDeclaredTotal({ amountCents: 30_000, method: 'yape' }, entries)).toMatchObject({
      kind: 'digital_shortfall',
      missingCents: 10_000,
    });
  });

  it('digital T ≤ C: the evidence wins', () => {
    const entries = [screenshotEntry({ amountCents: 20_000 })];
    expect(evaluateDeclaredTotal({ amountCents: 20_000, method: 'digital' }, entries)).toEqual({
      kind: 'digital_covered',
    });
    expect(evaluateDeclaredTotal({ amountCents: 15_000, method: 'yape' }, entries)).toEqual({
      kind: 'digital_covered',
    });
  });

  it('A and C only use confirmed sales of the right method', () => {
    const entries = [
      entry({ amountCents: 1_000 }),
      entry({ amountCents: 9_000, status: 'pending' }),
      entry({ amountCents: 9_000, category: 'other_income' }),
      entry({ amountCents: 9_000, direction: 'out', category: 'expense' }),
      screenshotEntry({ amountCents: 2_000 }),
      screenshotEntry({ amountCents: 3_000, paymentMethod: 'bank_transfer' }),
    ];
    expect(recordedCashSales(entries)).toBe(1_000);
    expect(recordedDigitalSales(entries)).toBe(5_000);
    expect(recordedDigitalSales(entries, 'bank_transfer')).toBe(3_000);
  });
});

describe('resolveAmbiguousTotal', () => {
  it('«es todo el día» with T > entró records the difference with unknown method', () => {
    const entries = [entry({ amountCents: 5_000 }), screenshotEntry({ amountCents: 6_000 })];
    expect(resolveAmbiguousTotal(15_000, 'whole_day', entries)).toEqual({
      kind: 'record_unitemized',
      amountCents: 4_000,
      paymentMethod: 'unknown',
      notice: null,
    });
  });

  it('«es todo el día» with T ≤ entró does nothing', () => {
    const entries = [entry({ amountCents: 15_000 })];
    expect(resolveAmbiguousTotal(15_000, 'whole_day', entries)).toEqual({
      kind: 'whole_day_covered',
    });
  });

  it('«solo efectivo» applies the cash rule (PR09)', () => {
    expect(resolveAmbiguousTotal(20_000, 'cash', ninetyFiveInCash())).toMatchObject({
      kind: 'record_unitemized',
      amountCents: 10_500,
      paymentMethod: 'cash',
    });
  });

  it('the unknown-method difference then counts in entró', () => {
    const entries = [entry({ amountCents: 5_000 })];
    const outcome = resolveAmbiguousTotal(8_000, 'whole_day', entries);
    if (outcome.kind !== 'record_unitemized') throw new Error('expected a record');
    const after = [
      ...entries,
      entry({ amountCents: outcome.amountCents, paymentMethod: 'unknown', label: 'unitemized' }),
    ];
    expect(computeIndicators(after).inCents).toBe(8_000);
  });
});

describe('digitalShortfall (close-time D40 line)', () => {
  it('uses the largest gap and disappears once screenshots cover it', () => {
    const declared = [
      { amountCents: 30_000, method: 'digital' as const },
      { amountCents: 10_000, method: 'cash' as const },
      { amountCents: 5_000, method: 'unknown' as const },
    ];
    const before = [screenshotEntry({ amountCents: 25_000 })];
    expect(digitalShortfall(declared, before)).toEqual({
      missingCents: 5_000,
      declaredCents: 30_000,
      recordedCents: 25_000,
    });
    const after = [...before, screenshotEntry({ amountCents: 5_000 })];
    expect(digitalShortfall(declared, after)).toBeNull();
  });
});
