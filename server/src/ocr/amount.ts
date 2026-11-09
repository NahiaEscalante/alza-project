import { normalizeAmount } from '../ai/amount.js';
import type { OcrLineRead } from './types.js';

/** Characters allowed when re-reading the amount: digits and separators only once the raised
 * sign was removed, so nothing can be read as «/» or «S»; with an inline «S/», the sign too. */
export const DIGITS_WHITELIST = '0123456789.,';
export const AMOUNT_WHITELIST = 'S/0123456789.,';

export type AmountReadFailure =
  | 'no_glyphs'
  | 'raised_glyphs'
  | 'irregular_row'
  | 'no_digits'
  | 'glyph_count_mismatch'
  | 'format';

export interface AmountRead {
  /** Canonical «12.50», or null. */
  amount: string | null;
  /** «S/» found: removed as a raised sign by segmentation, or read as text before the digits. */
  prefixFound: boolean;
  /** Lowest OCR confidence (0..100) among the digits. */
  minDigitConfidence: number;
  /** Digits and separators kept, for tests and debugging. */
  text: string;
  failure?: AmountReadFailure;
}

/**
 * Turns one OCR read of the cleaned amount image into an amount.
 * `glyphCount` is the number of glyphs segmentation drew: the OCR text (inline «S/» included) must
 * have exactly that many characters, so a merged, split or dropped character fails the read.
 */
export function amountFromLine(
  line: OcrLineRead,
  glyphCount: number,
  signRemoved: boolean,
): AmountRead {
  const raw = line.text.replace(/\s+/g, '');
  // An inline sign must start with «S»: a lone «/» is a misread digit («7» → «/»), never a sign.
  const sign = signRemoved ? '' : (/^S\/?/i.exec(raw)?.[0] ?? '');
  const text = raw.slice(sign.length);
  const digits = line.symbols.filter((s) => /^\d$/.test(s.text));
  const minDigitConfidence = digits.length ? Math.min(...digits.map((d) => d.confidence)) : 0;
  const base = {
    amount: null,
    prefixFound: signRemoved || sign.length > 0,
    minDigitConfidence,
    text,
  };

  if (!/\d/.test(text)) return { ...base, failure: 'no_digits' };
  if (raw.length !== glyphCount) return { ...base, failure: 'glyph_count_mismatch' };
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:[.,]\d{1,2})?$/.test(text)) {
    return { ...base, failure: 'format' };
  }
  const amount = normalizeAmount(text);
  return amount ? { ...base, amount } : { ...base, failure: 'format' };
}
