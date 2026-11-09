import { describe, expect, it } from 'vitest';
import {
  formatAmount,
  formatSoles,
  MAX_AMOUNT_CENTS,
  parseAmountToCents,
  sumCents,
} from './money.js';

describe('parseAmountToCents', () => {
  it.each([
    ['12.50', 1250],
    ['12,50', 1250],
    ['3,50', 350],
    ['3.5', 350],
    ['12', 1200],
    ['0.50', 50],
    ['1,285.00', 128500],
    ['1,285', 128500],
    ['1.285,00', 128500],
    ['1 285,50', 128550],
    ['1 285', 128500],
    ['S/ 12.50', 1250],
    ['S/12', 1200],
    ['S/. 3.50', 350],
    ['  20  ', 2000],
    ['007', 700],
    ['99,999.99', MAX_AMOUNT_CENTS],
    ['2', 200],
    ['750.00', 75000],
  ])('%s → %i cents', (input, cents) => {
    expect(parseAmountToCents(input)).toEqual({ ok: true, cents });
  });

  it.each([
    ['', 'empty'],
    ['S/', 'empty'],
    ['-5', 'negative'],
    ['−5', 'negative'],
    ['S/ -5', 'negative'],
    ['12.505', 'too_many_decimals'],
    ['1.285', 'too_many_decimals'],
    ['1,2345', 'too_many_decimals'],
    ['0', 'zero'],
    ['0.00', 'zero'],
    ['100,000', 'too_large'],
    ['1,285,000', 'too_large'],
    ['abc', 'invalid_format'],
    ['NaN', 'invalid_format'],
    ['12 soles', 'invalid_format'],
    ['12.', 'invalid_format'],
    ['.50', 'invalid_format'],
    ['12 50', 'invalid_format'],
    ['1.2.3', 'invalid_format'],
    ['1,28,5', 'invalid_format'],
    ['1,285,00.5', 'invalid_format'],
    ['1.285.000', 'invalid_format'],
    ['1e3', 'invalid_format'],
  ])('%s → %s', (input, error) => {
    expect(parseAmountToCents(input)).toEqual({ ok: false, error });
  });

  it('accepts zero only when asked and honors a custom max', () => {
    expect(parseAmountToCents('0', { allowZero: true })).toEqual({ ok: true, cents: 0 });
    expect(parseAmountToCents('600', { maxCents: 50_000 })).toEqual({
      ok: false,
      error: 'too_large',
    });
  });
});

describe('formatSoles / formatAmount', () => {
  it.each([
    [0, 'S/ 0'],
    [1250, 'S/ 12,50'],
    [23200, 'S/ 232'],
    [214000, 'S/ 2 140'],
    [123450, 'S/ 1 234,50'],
    [5, 'S/ 0,05'],
    [9_999_900, 'S/ 99 999'],
    [9_999_999, 'S/ 99 999,99'],
    [-5000, '-S/ 50'],
  ])('%i → %s', (cents, text) => {
    expect(formatSoles(cents)).toBe(text);
  });

  it('can always show decimals and format without the currency', () => {
    expect(formatSoles(1200, { decimals: 'always' })).toBe('S/ 12,00');
    expect(formatAmount(123450)).toBe('1 234,50');
    expect(formatAmount(-350)).toBe('-3,50');
  });

  it('refuses non-integer cents', () => {
    expect(() => formatSoles(12.5)).toThrow(RangeError);
  });
});

describe('sumCents', () => {
  it('adds integer cents and rejects floats', () => {
    expect(sumCents([1250, 350, -100])).toBe(1500);
    expect(() => sumCents([0.1, 0.2])).toThrow(RangeError);
  });
});
