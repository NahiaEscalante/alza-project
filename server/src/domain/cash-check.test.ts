import { describe, expect, it } from 'vitest';
import {
  cashCheckQuestion,
  expectedCashChange,
  isCashVerified,
  resolveCashCheck,
} from './cash-check.js';
import { entry, MARTA_TUESDAY, screenshotEntry } from './test-support.js';

describe('expectedCashChange (11.7)', () => {
  it('Marta: S/114 cash in − S/30 cash out = +S/84', () => {
    expect(expectedCashChange(MARTA_TUESDAY)).toBe(8_400);
  });

  it('S/50 cash handed over for a neighbour’s Yape (internal) → +S/34', () => {
    const internal = [
      entry({ amountCents: 5_000, direction: 'out', category: 'internal' }),
      screenshotEntry({ amountCents: 5_000, category: 'internal' }),
    ];
    expect(expectedCashChange([...MARTA_TUESDAY, ...internal])).toBe(3_400);
  });

  it('adds other income, unitemized cash and internal cash received; ignores the rest', () => {
    const result = expectedCashChange([
      entry({ amountCents: 10_000, category: 'other_income' }),
      entry({ amountCents: 10_500, label: 'unitemized' }),
      entry({ amountCents: 2_000, category: 'internal' }),
      entry({ amountCents: 1_000, direction: 'out', category: 'unclassified' }),
      entry({ amountCents: 1_000, direction: 'out', category: 'expense' }),
      entry({ amountCents: 9_999, category: 'personal' }),
      entry({ amountCents: 9_999, status: 'pending' }),
      entry({ amountCents: 9_999, status: 'voided' }),
      entry({ amountCents: 9_999, paymentMethod: 'unknown', label: 'unitemized' }),
      screenshotEntry({ amountCents: 9_999 }),
    ]);
    expect(result).toBe(20_500);
  });
});

describe('cashCheckQuestion', () => {
  it.each([
    [8_400, 'more', 'Tu caja debería tener S/ 84 más que en la mañana. ¿Cuadra?'],
    [-2_550, 'less', 'Tu caja debería tener S/ 25,50 menos que en la mañana. ¿Cuadra?'],
    [0, 'same', 'Tu caja debería tener lo mismo que en la mañana. ¿Cuadra?'],
  ] as const)('%i → %s', (cents, phrasing, text) => {
    expect(cashCheckQuestion(cents)).toEqual({
      phrasing,
      amountCents: Math.abs(cents),
      expectedChangeCents: cents,
      text,
    });
  });
});

describe('resolveCashCheck', () => {
  it.each([
    ['yes', 0, { kind: 'resolved', result: 'balanced', verified: true }],
    ['no_explained', 0, { kind: 'resolved', result: 'adjusted', verified: true }],
    ['unsure', 0, { kind: 'resolved', result: 'unsure', verified: false }],
    ['no_unexplained', 0, { kind: 'ask_again' }],
    ['no_unexplained', 1, { kind: 'ask_again' }],
    ['no_unexplained', 2, { kind: 'resolved', result: 'unsure', verified: false }],
    ['missing', 0, { kind: 'ask_again' }],
    ['missing', 2, { kind: 'resolved', result: 'unsure', verified: false }],
  ] as const)('%s after %i rounds', (answer, rounds, outcome) => {
    expect(resolveCashCheck(answer, rounds)).toEqual(outcome);
  });

  it('only balanced and adjusted count as verified', () => {
    expect(isCashVerified('balanced')).toBe(true);
    expect(isCashVerified('adjusted')).toBe(true);
    expect(isCashVerified('unsure')).toBe(false);
    expect(isCashVerified('no_answer')).toBe(false);
    expect(isCashVerified(null)).toBe(false);
  });
});
