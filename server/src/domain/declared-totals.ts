/**
 * Declared day totals (11.5, D03, PR09, D40). A total is never added on top of what is recorded.
 *
 * | Declared                     | Rule                                                          |
 * |------------------------------|---------------------------------------------------------------|
 * | no method («hoy vendí 150»)  | nothing recorded; doubt `ambiguous_total`                    |
 * | cash T > recorded cash A     | record T − A as an unitemized cash sale + close notice (PR09) |
 * | cash T < A                   | nothing recorded; doubt «¿Cuál es correcto?»                  |
 * | cash T = A                   | nothing                                                       |
 * | digital T > recorded C       | nothing recorded; close notice «Faltan S/X en capturas» (D40) |
 * | digital T ≤ C                | nothing: the evidence wins                                    |
 * | «es todo el día» T > entró E | record T − E as an unitemized sale, unknown method            |
 *
 * Cash sales recorded after the total are new sales and add on top (case 26): applying the rule
 * again with the new A only adds the new difference, so nothing is counted twice.
 */
import { computeIndicators, type IndicatorEntry } from './indicators.js';
import { sumCents } from './money.js';
import { isDigitalMethod, type PaymentMethod } from './types.js';

export type DeclaredTotalMethod =
  | 'cash'
  | 'digital'
  | 'yape'
  | 'plin'
  | 'bank_transfer'
  | 'unknown';

export interface DeclaredTotal {
  amountCents: number;
  method: DeclaredTotalMethod;
}

/** Data for the PR09 close line: «Ojo: anotaste S/A en efectivo pero dijiste … Registré S/D más». */
export interface UnitemizedCashNotice {
  recordedCents: number;
  declaredCents: number;
  addedCents: number;
}

export type DeclaredTotalOutcome =
  /** Doubt `ambiguous_total` (priority 1): «¿Es todo el día o solo efectivo?». */
  | { kind: 'ambiguous_total' }
  /** Record an unitemized sale (`label: unitemized`, `category: sale`, `direction: in`). */
  | {
      kind: 'record_unitemized';
      amountCents: number;
      paymentMethod: Extract<PaymentMethod, 'cash' | 'unknown'>;
      notice: UnitemizedCashNotice | null;
    }
  /**
   * Doubt «Anotaste S/A en efectivo pero dijiste S/T. ¿Cuál es correcto?». Stored as type
   * `ambiguous_total` (decision: the closest of the 7 types).
   */
  | { kind: 'cash_total_below_recorded'; recordedCents: number; declaredCents: number }
  | { kind: 'cash_total_matches' }
  /** Close notice (D40), recomputed when the close is composed: see `digitalShortfall`. */
  | {
      kind: 'digital_shortfall';
      missingCents: number;
      declaredCents: number;
      recordedCents: number;
    }
  | { kind: 'digital_covered' }
  /** «Es todo el día» with T ≤ entró: nothing to do. */
  | { kind: 'whole_day_covered' };

type TotalsEntry = IndicatorEntry;

function confirmedSales(entries: readonly TotalsEntry[]): TotalsEntry[] {
  return entries.filter(
    (entry) =>
      entry.status === 'confirmed' && entry.direction === 'in' && entry.category === 'sale',
  );
}

/** A: confirmed cash sales of the day, including earlier unitemized differences. */
export function recordedCashSales(entries: readonly TotalsEntry[]): number {
  return sumCents(
    confirmedSales(entries)
      .filter((entry) => entry.paymentMethod === 'cash')
      .map((entry) => entry.amountCents),
  );
}

/** C: confirmed digital sales of the day, for one method or all digital methods. */
export function recordedDigitalSales(
  entries: readonly TotalsEntry[],
  method: Extract<DeclaredTotalMethod, 'digital' | 'yape' | 'plin' | 'bank_transfer'> = 'digital',
): number {
  return sumCents(
    confirmedSales(entries)
      .filter((entry) =>
        method === 'digital'
          ? isDigitalMethod(entry.paymentMethod)
          : entry.paymentMethod === method,
      )
      .map((entry) => entry.amountCents),
  );
}

/** Applies 11.5 to a declared day total, given the day's ledger entries. */
export function evaluateDeclaredTotal(
  total: DeclaredTotal,
  entries: readonly TotalsEntry[],
): DeclaredTotalOutcome {
  const declaredCents = total.amountCents;
  if (total.method === 'unknown') return { kind: 'ambiguous_total' };

  if (total.method === 'cash') {
    const recordedCents = recordedCashSales(entries);
    if (declaredCents > recordedCents) {
      const addedCents = declaredCents - recordedCents;
      return {
        kind: 'record_unitemized',
        amountCents: addedCents,
        paymentMethod: 'cash',
        notice: { recordedCents, declaredCents, addedCents },
      };
    }
    if (declaredCents < recordedCents) {
      return { kind: 'cash_total_below_recorded', recordedCents, declaredCents };
    }
    return { kind: 'cash_total_matches' };
  }

  const recordedCents = recordedDigitalSales(entries, total.method);
  if (declaredCents > recordedCents) {
    return {
      kind: 'digital_shortfall',
      missingCents: declaredCents - recordedCents,
      declaredCents,
      recordedCents,
    };
  }
  return { kind: 'digital_covered' };
}

/** Her answer to an `ambiguous_total` doubt. */
export type AmbiguousTotalAnswer = 'whole_day' | Exclude<DeclaredTotalMethod, 'unknown'>;

/**
 * Resolves an ambiguous total. «Solo efectivo» (or a digital method) applies the matching rule;
 * «es todo el día» compares with entró: if T > E, records T − E as an unitemized sale with
 * unknown method; otherwise nothing.
 */
export function resolveAmbiguousTotal(
  amountCents: number,
  answer: AmbiguousTotalAnswer,
  entries: readonly TotalsEntry[],
): DeclaredTotalOutcome {
  if (answer !== 'whole_day')
    return evaluateDeclaredTotal({ amountCents, method: answer }, entries);
  const inCents = computeIndicators(entries).inCents;
  if (amountCents > inCents) {
    return {
      kind: 'record_unitemized',
      amountCents: amountCents - inCents,
      paymentMethod: 'unknown',
      notice: null,
    };
  }
  return { kind: 'whole_day_covered' };
}

/**
 * D40 line at close time: the largest digital total she declared that day minus what the
 * screenshots add up to now. Null when covered (later screenshots may have closed the gap).
 */
export function digitalShortfall(
  declared: readonly DeclaredTotal[],
  entries: readonly TotalsEntry[],
): { missingCents: number; declaredCents: number; recordedCents: number } | null {
  let worst: { missingCents: number; declaredCents: number; recordedCents: number } | null = null;
  for (const total of declared) {
    if (total.method === 'cash' || total.method === 'unknown') continue;
    const outcome = evaluateDeclaredTotal(total, entries);
    if (outcome.kind === 'digital_shortfall' && outcome.missingCents > (worst?.missingCents ?? 0)) {
      worst = {
        missingCents: outcome.missingCents,
        declaredCents: outcome.declaredCents,
        recordedCents: outcome.recordedCents,
      };
    }
  }
  return worst;
}
