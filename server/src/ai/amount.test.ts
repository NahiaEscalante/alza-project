import { describe, expect, it } from 'vitest';
import { MAX_AMOUNT_CENTS as DOMAIN_MAX } from '../domain/index.js';
import {
  amountToCents,
  centsToAmount,
  MAX_AMOUNT_CENTS,
  normalizeAmount,
  sameAmount,
} from './amount.js';

describe('normalizeAmount (aligned with domain parseAmountToCents)', () => {
  it.each([
    ['12.50', '12.50'],
    ['7.5', '7.50'],
    ['2', '2.00'],
    ['3,50', '3.50'],
    ['1,285.00', '1285.00'],
    ['1,285', '1285.00'],
    ['S/ 7.50', '7.50'],
    ['S/1,285.00', '1285.00'],
    [7.5, '7.50'],
    [20, '20.00'],
    ['0.50', '0.50'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeAmount(input)).toBe(expected);
  });

  it.each([
    ['7.505'],
    ['1.285'],
    ['0'],
    ['-5'],
    [''],
    ['doce'],
    ['12 soles'],
    [-3],
    [0],
    [Number.NaN],
    [1e21],
    [null],
    [undefined],
    [{}],
  ])('rejects %s (never guessed)', (input) => {
    expect(normalizeAmount(input)).toBeNull();
  });

  it('uses the domain limit (S/ 99 999,99)', () => {
    expect(MAX_AMOUNT_CENTS).toBe(DOMAIN_MAX);
    expect(normalizeAmount('99999.99')).toBe('99999.99');
    expect(normalizeAmount('100000')).toBeNull();
  });

  it('converts between cents and strings', () => {
    expect(centsToAmount(5)).toBe('0.05');
    expect(centsToAmount(128_500)).toBe('1285.00');
    expect(amountToCents('12.50')).toBe(1250);
    expect(amountToCents('1.285')).toBeNull();
    expect(sameAmount('7.5', 'S/ 7.50')).toBe(true);
    expect(sameAmount(null, null)).toBe(false);
  });
});
