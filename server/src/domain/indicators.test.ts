import { describe, expect, it } from 'vitest';
import { computeIndicators } from './indicators.js';
import { entry, MARTA_TUESDAY, screenshotEntry } from './test-support.js';

describe('computeIndicators (11.6)', () => {
  it('reproduces the Marta example: entró S/412, salió S/180, te quedó S/232', () => {
    expect(computeIndicators(MARTA_TUESDAY)).toEqual({
      digitalSalesCents: 29_800,
      cashSalesCents: 11_400,
      unknownMethodSalesCents: 0,
      inCents: 41_200,
      inventoryCents: 15_000,
      expensesCents: 0,
      householdCents: 3_000,
      unclassifiedCents: 0,
      outCents: 18_000,
      leftCents: 23_200,
      pendingCents: 0,
      pendingInCents: 0,
      pendingOutCents: 0,
    });
  });

  it('only counts live confirmed entries; pending ones go to «por confirmar»', () => {
    const result = computeIndicators([
      ...MARTA_TUESDAY,
      screenshotEntry({ amountCents: 8_000, status: 'pending' }),
      entry({ amountCents: 6_000, direction: 'out', category: 'expense', status: 'pending' }),
      screenshotEntry({ amountCents: 1_000, status: 'duplicate' }),
      entry({ amountCents: 1_000, status: 'voided' }),
      entry({ amountCents: 1_000, status: 'superseded' }),
    ]);
    expect(result.inCents).toBe(41_200);
    expect(result.outCents).toBe(18_000);
    expect(result.pendingCents).toBe(14_000);
    expect(result.pendingInCents).toBe(8_000);
    expect(result.pendingOutCents).toBe(6_000);
  });

  it('never counts personal or internal, and other income is not a sale', () => {
    const result = computeIndicators([
      screenshotEntry({ amountCents: 10_000, category: 'personal' }),
      screenshotEntry({ amountCents: 5_000, category: 'internal' }),
      entry({ amountCents: 5_000, direction: 'out', category: 'internal' }),
      entry({ amountCents: 20_000, category: 'other_income' }),
      screenshotEntry({ amountCents: 7_000, category: 'personal', status: 'pending' }),
    ]);
    expect(result.inCents).toBe(0);
    expect(result.outCents).toBe(0);
    expect(result.pendingCents).toBe(0);
  });

  it('adds unknown-method unitemized sales to entró and unclassified outflows to salió', () => {
    const result = computeIndicators([
      entry({ amountCents: 4_000, paymentMethod: 'unknown', label: 'unitemized' }),
      screenshotEntry({ amountCents: 1_500, paymentMethod: 'bank_transfer' }),
      screenshotEntry({ amountCents: 6_000, direction: 'out', category: 'unclassified' }),
      entry({ amountCents: 2_000, direction: 'out', category: 'expense' }),
    ]);
    expect(result.unknownMethodSalesCents).toBe(4_000);
    expect(result.digitalSalesCents).toBe(1_500);
    expect(result.inCents).toBe(5_500);
    expect(result.outCents).toBe(8_000);
    expect(result.leftCents).toBe(-2_500);
  });

  it('D69: a screenshot of an unknown app (read, or answered «Lo contaste tú») is Yape y Plin, not «sin detalle»', () => {
    const result = computeIndicators([
      screenshotEntry({ amountCents: 700, paymentMethod: 'unknown' }),
      entry({ amountCents: 1_200, paymentMethod: 'unknown', label: 'self_reported' }),
      entry({ amountCents: 4_000, paymentMethod: 'unknown', label: 'unitemized' }),
    ]);
    expect(result.digitalSalesCents).toBe(1_900);
    expect(result.unknownMethodSalesCents).toBe(4_000);
    expect(result.inCents).toBe(5_900);
    // Without a label (older callers) unknown stays «sin detalle».
    const { label: _label, ...noLabel } = entry({ amountCents: 300, paymentMethod: 'unknown' });
    expect(computeIndicators([noLabel]).unknownMethodSalesCents).toBe(300);
  });

  it('is all zeros for an empty day', () => {
    expect(computeIndicators([]).leftCents).toBe(0);
  });
});
