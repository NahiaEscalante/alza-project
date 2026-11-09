import { MAX_AMOUNT_CENTS, parseAmountToCents } from '../domain/index.js';

/**
 * Amount strings at the AI boundary (spec 10.2): a decimal string such as «12.50», always with
 * 2 decimals once normalized. Parsing and limits are the domain's (`parseAmountToCents`, Peruvian
 * convention, max S/ 99 999,99): both modules accept exactly the same amounts.
 *
 * Anything the domain rejects (ambiguous «1.285», 3 decimals, zero, too large, text) becomes null:
 * an amount is never guessed (RF-EX-06).
 */

export { MAX_AMOUNT_CENTS };

/** «12.50» from integer cents. */
export function centsToAmount(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/**
 * Canonical «123.45», or null when the input is not an unambiguous positive amount within the
 * domain limits. Accepts what the domain accepts («7.5», «7,50», «1,285.00», «S/ 7.50») and plain
 * numbers from model JSON (7.5).
 */
export function normalizeAmount(input: unknown): string | null {
  let raw: string;
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input <= 0) return null;
    raw = String(input);
    if (/e/i.test(raw)) return null;
  } else if (typeof input === 'string') {
    raw = input;
  } else {
    return null;
  }
  const parsed = parseAmountToCents(raw);
  return parsed.ok ? centsToAmount(parsed.cents) : null;
}

/** Cents for an amount string (any format the domain accepts); null if rejected. */
export function amountToCents(amount: string): number | null {
  const parsed = parseAmountToCents(amount);
  return parsed.ok ? parsed.cents : null;
}

/** True when both inputs normalize to the same amount. */
export function sameAmount(a: unknown, b: unknown): boolean {
  const na = normalizeAmount(a);
  return na !== null && na === normalizeAmount(b);
}
