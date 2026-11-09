/**
 * Activity list reconciliation (11.10, D10).
 *
 * - Overlapping scroll screenshots of one list are merged by removing repeated rows.
 * - A row that matches a live entry (same operation number and method; or same amount, direction
 *   and counterparty within ±2 minutes) is linked and adds nothing.
 * - Any other row becomes a `missing_from_list` doubt (web only). ALZA never records it by itself.
 * - Capture rate = rows already recorded ÷ rows.
 */
import { DUPLICATE_WINDOW_MS, normalizeOperationNumber } from './duplicates.js';
import { type Direction, isLive, type LedgerEntryView, type PaymentMethod } from './types.js';

export interface ActivityListRow {
  amountCents: number;
  direction: Direction;
  paymentMethod: PaymentMethod;
  counterpartyNormalized: string | null;
  operationNumber: string | null;
  operationAt: Date | null;
}

function rowKey(row: ActivityListRow): string {
  const operationNumber = normalizeOperationNumber(row.operationNumber);
  if (operationNumber !== null) return `op:${row.paymentMethod}:${operationNumber}`;
  return [
    'row',
    row.amountCents,
    row.direction,
    row.counterpartyNormalized ?? '',
    row.operationAt?.toISOString() ?? '',
  ].join(':');
}

/**
 * Removes rows repeated by overlapping screenshots of the same list. Rows are the same when they
 * share an operation number, or (without one) amount, direction, counterparty and exact time.
 */
export function dedupeListRows<T extends ActivityListRow>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const row of rows) {
    const key = rowKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  return unique;
}

export type ListEntry = Pick<
  LedgerEntryView,
  | 'id'
  | 'status'
  | 'amountCents'
  | 'direction'
  | 'paymentMethod'
  | 'counterpartyNormalized'
  | 'operationNumber'
  | 'operationAt'
>;

function rowMatches(row: ActivityListRow, entry: ListEntry): boolean {
  const operationNumber = normalizeOperationNumber(row.operationNumber);
  const entryNumber = normalizeOperationNumber(entry.operationNumber);
  if (operationNumber !== null && entryNumber !== null) {
    return operationNumber === entryNumber && row.paymentMethod === entry.paymentMethod;
  }
  return (
    row.amountCents === entry.amountCents &&
    row.direction === entry.direction &&
    row.counterpartyNormalized === entry.counterpartyNormalized &&
    row.operationAt !== null &&
    entry.operationAt !== null &&
    Math.abs(row.operationAt.getTime() - entry.operationAt.getTime()) <= DUPLICATE_WINDOW_MS
  );
}

export interface ListReconciliation<T extends ActivityListRow> {
  matched: { row: T; entryId: string }[];
  /** Each becomes a `missing_from_list` doubt in the web. */
  missing: T[];
  /** «Encontré {k} cobros sin registrar en tu lista» (WA-12) counts incoming ones. */
  missingIncomingCount: number;
  totalRows: number;
  /** Rows already recorded ÷ rows (0 when the list is empty). */
  captureRate: number;
}

/** Each entry links to at most one row, so two equal sales are not hidden behind one entry. */
export function reconcileActivityList<T extends ActivityListRow>(
  rows: readonly T[],
  entries: readonly ListEntry[],
): ListReconciliation<T> {
  const unique = dedupeListRows(rows);
  const live = entries.filter((entry) => isLive(entry) && entry.paymentMethod !== 'cash');
  const used = new Set<string>();
  const matched: { row: T; entryId: string }[] = [];
  const missing: T[] = [];

  for (const row of unique) {
    const entry = live.find((candidate) => !used.has(candidate.id) && rowMatches(row, candidate));
    if (entry) {
      used.add(entry.id);
      matched.push({ row, entryId: entry.id });
    } else {
      missing.push(row);
    }
  }

  return {
    matched,
    missing,
    missingIncomingCount: missing.filter((row) => row.direction === 'in').length,
    totalRows: unique.length,
    captureRate: unique.length === 0 ? 0 : matched.length / unique.length,
  };
}
