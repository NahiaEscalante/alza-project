/**
 * Indicators (11.6): entró, salió, te quedó and por confirmar.
 *
 * Only live, confirmed entries count (never pending, voided, superseded or duplicate), and never
 * `personal` or `internal`. Pending ones are summed apart in «por confirmar». The app never calls
 * the result «ganancia».
 */
import { sumCents } from './money.js';
import { isDigitalMethod, isExcludedFromTotals, type LedgerEntryView } from './types.js';

export type IndicatorEntry = Pick<
  LedgerEntryView,
  'amountCents' | 'direction' | 'paymentMethod' | 'category' | 'status'
>;

export interface Indicators {
  /** Sales by Yape, Plin and transfer. */
  digitalSalesCents: number;
  cashSalesCents: number;
  /** Sales with unknown method («es todo el día» difference, 11.5). */
  unknownMethodSalesCents: number;
  /** entró = digital + cash + unknown-method sales. */
  inCents: number;
  inventoryCents: number;
  expensesCents: number;
  householdCents: number;
  unclassifiedCents: number;
  /** salió = inventory + expenses + household + unclassified. */
  outCents: number;
  /** te quedó = entró − salió (can be negative). */
  leftCents: number;
  /** Por confirmar: pending entries, both directions. Never part of the totals. */
  pendingCents: number;
  pendingInCents: number;
  pendingOutCents: number;
}

export function computeIndicators(entries: readonly IndicatorEntry[]): Indicators {
  const counted = entries.filter((entry) => !isExcludedFromTotals(entry.category));
  const confirmed = counted.filter((entry) => entry.status === 'confirmed');
  const pending = counted.filter((entry) => entry.status === 'pending');

  const sales = confirmed.filter((entry) => entry.direction === 'in' && entry.category === 'sale');
  const outflows = confirmed.filter((entry) => entry.direction === 'out');
  const sum = (list: readonly IndicatorEntry[]) => sumCents(list.map((entry) => entry.amountCents));
  const outBy = (category: IndicatorEntry['category']) =>
    sum(outflows.filter((entry) => entry.category === category));

  const digitalSalesCents = sum(sales.filter((entry) => isDigitalMethod(entry.paymentMethod)));
  const cashSalesCents = sum(sales.filter((entry) => entry.paymentMethod === 'cash'));
  const unknownMethodSalesCents = sum(sales.filter((entry) => entry.paymentMethod === 'unknown'));
  const inCents = digitalSalesCents + cashSalesCents + unknownMethodSalesCents;

  const inventoryCents = outBy('inventory');
  const expensesCents = outBy('expense');
  const householdCents = outBy('household');
  const unclassifiedCents = outBy('unclassified');
  const outCents = inventoryCents + expensesCents + householdCents + unclassifiedCents;

  const pendingInCents = sum(pending.filter((entry) => entry.direction === 'in'));
  const pendingOutCents = sum(pending.filter((entry) => entry.direction === 'out'));

  return {
    digitalSalesCents,
    cashSalesCents,
    unknownMethodSalesCents,
    inCents,
    inventoryCents,
    expensesCents,
    householdCents,
    unclassifiedCents,
    outCents,
    leftCents: inCents - outCents,
    pendingCents: pendingInCents + pendingOutCents,
    pendingInCents,
    pendingOutCents,
  };
}
