/**
 * Cash check (11.7, D08, PR08).
 *
 * expected change = cash in (sales, other income, unitemized)
 *                 − cash out (inventory, expenses, household, unclassified)
 *                 + cash received in internal moves − cash handed over in internal moves
 *
 * Only live, confirmed cash entries count; `personal` never counts. ALZA never estimates cash sales.
 */
import { formatSoles, sumCents } from './money.js';
import type { CashCheckResult, LedgerEntryView } from './types.js';

export type CashEntry = Pick<
  LedgerEntryView,
  'amountCents' | 'direction' | 'paymentMethod' | 'category' | 'status'
>;

/** variacion_esperada in cents (can be negative). */
export function expectedCashChange(entries: readonly CashEntry[]): number {
  const cash = entries.filter(
    (entry) =>
      entry.status === 'confirmed' &&
      entry.paymentMethod === 'cash' &&
      entry.category !== 'personal',
  );
  return sumCents(cash.map((entry) => (entry.direction === 'in' ? 1 : -1) * entry.amountCents));
}

export type CashCheckPhrasing = 'more' | 'less' | 'same';

/** The three phrasings of the question (11.7). `{monto}` is a formatted amount. */
export const CASH_CHECK_QUESTIONS: Record<CashCheckPhrasing, string> = {
  more: 'Tu caja debería tener {monto} más que en la mañana. ¿Cuadra?',
  less: 'Tu caja debería tener {monto} menos que en la mañana. ¿Cuadra?',
  same: 'Tu caja debería tener lo mismo que en la mañana. ¿Cuadra?',
};

export interface CashCheckQuestion {
  phrasing: CashCheckPhrasing;
  /** Absolute value of the expected change. */
  amountCents: number;
  /** Signed expected change (variacion_centimos in 10.3). */
  expectedChangeCents: number;
  text: string;
}

export function cashCheckQuestion(expectedChangeCents: number): CashCheckQuestion {
  const phrasing: CashCheckPhrasing =
    expectedChangeCents > 0 ? 'more' : expectedChangeCents < 0 ? 'less' : 'same';
  const amountCents = Math.abs(expectedChangeCents);
  return {
    phrasing,
    amountCents,
    expectedChangeCents,
    text: CASH_CHECK_QUESTIONS[phrasing].replace('{monto}', formatSoles(amountCents)),
  };
}

/**
 * What she said about the cash point, as interpreted:
 * - yes: «sí»
 * - no_explained: «no» plus at least one movement she explains (recorded as self-reported, origin
 *   close_reply, by the caller)
 * - no_unexplained: «no» without explanation
 * - unsure: «no sé»
 * - missing: she replied to the close but not to this point
 */
export type CashCheckAnswer = 'yes' | 'no_explained' | 'no_unexplained' | 'unsure' | 'missing';

/** Max clarification rounds per close (WA-11, RF-CI-07). */
export const MAX_CLARIFICATION_ROUNDS = 2;

export type CashCheckOutcome =
  | { kind: 'resolved'; result: CashCheckResult; verified: boolean }
  | { kind: 'ask_again' };

/**
 * Applies her answer (11.7). An unexplained «no» or a missing answer is asked again while
 * clarification rounds remain; after 2 rounds it becomes `unsure` («caja sin revisar»).
 */
export function resolveCashCheck(answer: CashCheckAnswer, roundsUsed: number): CashCheckOutcome {
  switch (answer) {
    case 'yes':
      return { kind: 'resolved', result: 'balanced', verified: true };
    case 'no_explained':
      return { kind: 'resolved', result: 'adjusted', verified: true };
    case 'unsure':
      return { kind: 'resolved', result: 'unsure', verified: false };
    case 'no_unexplained':
    case 'missing':
      return roundsUsed < MAX_CLARIFICATION_ROUNDS
        ? { kind: 'ask_again' }
        : { kind: 'resolved', result: 'unsure', verified: false };
  }
}

/** `cuadra` or `ajustado` = caja verificada; anything else shows «Caja sin revisar». */
export function isCashVerified(result: CashCheckResult | null): boolean {
  return result === 'balanced' || result === 'adjusted';
}
