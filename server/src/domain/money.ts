/**
 * Money (RNF-11): integer cents everywhere; formatting only for display.
 *
 * Parsing follows the Peruvian convention used by Yape, Plin and the banks: dot for decimals and
 * comma for thousands («1,285.00»). A lone comma followed by 1–2 digits is read as a decimal
 * comma («3,50»), as people often write it. Anything that could be read two ways, or that has more
 * than 2 decimals, is rejected: a doubt is better than an invented amount.
 *
 * Display format (one for the whole app, spec 8.6 «mismo formato en toda la app»):
 *   «S/ 1 234,50» — space after «S/», space as thousands separator, comma for decimals, and no
 *   decimals when the amount is whole («S/ 232», «S/ 2 140»), as in the spec's examples.
 */

/** Largest single amount accepted from a screenshot, text or audio: S/ 99 999,99 (spec 8.6). */
export const MAX_AMOUNT_CENTS = 9_999_999;

export type ParseAmountError =
  | 'empty'
  | 'invalid_format'
  | 'negative'
  | 'too_many_decimals'
  | 'zero'
  | 'too_large';

export type ParseAmountResult =
  | { ok: true; cents: number }
  | { ok: false; error: ParseAmountError };

export interface ParseAmountOptions {
  /** Default `MAX_AMOUNT_CENTS`. */
  maxCents?: number;
  /** Default false: the ledger only stores positive amounts. */
  allowZero?: boolean;
}

const CURRENCY_PREFIX = /^(?:s\/\.?|pen)\s*/i;
const SPACES = /[\s  ]/;

/**
 * Parses «12.50», «12,50», «1,285.00», «1.285,00», «1 285,50», «S/ 12», «S/. 3.5» to cents.
 * Rejects negatives, more than 2 decimals, ambiguous grouping and anything that is not a number.
 */
export function parseAmountToCents(
  input: string,
  options: ParseAmountOptions = {},
): ParseAmountResult {
  const maxCents = options.maxCents ?? MAX_AMOUNT_CENTS;
  let text = input.trim();
  if (/^[-−]/.test(text)) return { ok: false, error: 'negative' };
  text = text.replace(CURRENCY_PREFIX, '').trim();
  if (text === '') return { ok: false, error: 'empty' };
  if (/^[-−]/.test(text)) return { ok: false, error: 'negative' };
  if (!/^[0-9.,\s  ]+$/.test(text)) return { ok: false, error: 'invalid_format' };
  if (!/^\d/.test(text) || !/\d$/.test(text)) return { ok: false, error: 'invalid_format' };

  const split = splitDecimal(text);
  if (!split.ok) return split;
  const { integerPart, fraction, groupSeparator } = split;

  const digits = parseGroupedInteger(integerPart, groupSeparator);
  if (digits === null) return { ok: false, error: 'invalid_format' };
  if (fraction.length > 2) return { ok: false, error: 'too_many_decimals' };
  if (!/^\d*$/.test(fraction)) return { ok: false, error: 'invalid_format' };

  const significant = digits.replace(/^0+(?=\d)/, '');
  if (significant.length > 12) return { ok: false, error: 'too_large' };
  const cents = Number(significant) * 100 + Number(fraction.padEnd(2, '0'));
  if (cents === 0 && !options.allowZero) return { ok: false, error: 'zero' };
  if (cents > maxCents) return { ok: false, error: 'too_large' };
  return { ok: true, cents };
}

type SplitResult =
  | { ok: true; integerPart: string; fraction: string; groupSeparator: ',' | '.' | null }
  | { ok: false; error: ParseAmountError };

function splitDecimal(text: string): SplitResult {
  const dots = count(text, '.');
  const commas = count(text, ',');

  if (dots > 0 && commas > 0) {
    // Both present: the last one is the decimal separator and must appear once.
    const decimal = text.lastIndexOf('.') > text.lastIndexOf(',') ? '.' : ',';
    const group = decimal === '.' ? ',' : '.';
    if (count(text, decimal) !== 1) return { ok: false, error: 'invalid_format' };
    const index = text.lastIndexOf(decimal);
    if (text.slice(index).includes(group)) return { ok: false, error: 'invalid_format' };
    return decimalParts(text, index, group);
  }

  const separator = dots > 0 ? '.' : commas > 0 ? ',' : null;
  if (separator === null)
    return { ok: true, integerPart: text, fraction: '', groupSeparator: null };
  if (count(text, separator) > 1) {
    // «1,285,000»: thousands only. Repeated dots are never a Peruvian thousands separator.
    if (separator === '.') return { ok: false, error: 'invalid_format' };
    return { ok: true, integerPart: text, fraction: '', groupSeparator: ',' };
  }
  const index = text.indexOf(separator);
  const after = text.slice(index + 1);
  if (separator === ',' && /^\d{3}$/.test(after)) {
    // «1,285» → 1285 (comma for thousands). A dot with 3 digits («1.285») is 3 decimals: rejected.
    return { ok: true, integerPart: text, fraction: '', groupSeparator: ',' };
  }
  return decimalParts(text, index, null);
}

function decimalParts(text: string, index: number, group: ',' | '.' | null): SplitResult {
  const fraction = text.slice(index + 1);
  if (SPACES.test(fraction) || fraction === '') return { ok: false, error: 'invalid_format' };
  return { ok: true, integerPart: text.slice(0, index), fraction, groupSeparator: group };
}

/** Validates thousands groups («1 285», «1,285,000»): first group 1–3 digits, then exactly 3. */
function parseGroupedInteger(integerPart: string, group: ',' | '.' | null): string | null {
  const parts = integerPart.split(
    group === null ? SPACES : new RegExp(`[\\s\\u00a0\\u202f${group}]`),
  );
  if (parts.length === 1) return /^\d+$/.test(parts[0] ?? '') ? (parts[0] ?? null) : null;
  const [first, ...rest] = parts;
  if (first === undefined || !/^\d{1,3}$/.test(first)) return null;
  if (!rest.every((part) => /^\d{3}$/.test(part))) return null;
  return parts.join('');
}

function count(text: string, char: string): number {
  return text.split(char).length - 1;
}

export interface FormatAmountOptions {
  /** 'auto' (default) hides «,00» on whole amounts; 'always' shows two decimals (tables). */
  decimals?: 'auto' | 'always';
}

/** «1 234,50» (no currency). Negative amounts start with «-». */
export function formatAmount(cents: number, options: FormatAmountOptions = {}): string {
  if (!Number.isSafeInteger(cents))
    throw new RangeError('Amount must be an integer number of cents');
  const absolute = Math.abs(cents);
  const soles = Math.floor(absolute / 100);
  const rest = absolute % 100;
  const grouped = String(soles).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const showDecimals = rest !== 0 || options.decimals === 'always';
  const body = showDecimals ? `${grouped},${String(rest).padStart(2, '0')}` : grouped;
  return cents < 0 ? `-${body}` : body;
}

/** «S/ 1 234,50», «S/ 232», «-S/ 50». */
export function formatSoles(cents: number, options: FormatAmountOptions = {}): string {
  const body = formatAmount(Math.abs(cents), options);
  return cents < 0 ? `-S/ ${body}` : `S/ ${body}`;
}

/** Sum of integer cents (throws on non-integers so a float never sneaks into a total). */
export function sumCents(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value)) throw new RangeError('Amounts must be integer cents');
    total += value;
  }
  return total;
}
