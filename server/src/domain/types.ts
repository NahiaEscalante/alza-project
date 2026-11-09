/**
 * Shared domain types. Enum values come from `db/schema.ts` (types only, erased at runtime), so the
 * domain and the database stay aligned without the domain depending on drizzle.
 */
import type {
  Category,
  Direction,
  LedgerEntrySource,
  LedgerEntryStatus,
  LedgerLabel,
  PaymentMethod,
} from '../db/schema.js';

export type {
  CashCheckResult,
  Category,
  ClarificationType,
  CloseLevel,
  DailyCloseStatus,
  Direction,
  Intent,
  LedgerEntrySource,
  LedgerEntryStatus,
  LedgerLabel,
  PaymentMethod,
  PointsEntryType,
  Scope,
} from '../db/schema.js';

/** Business day as `YYYY-MM-DD` (4:00–3:59 America/Lima, D12). */
export type IsoDate = string;

/**
 * A ledger entry as the domain sees it. Field names match `ledgerEntries.$inferSelect`, so database
 * rows can be passed as they are. Functions take a `Pick<>` of only the fields they need.
 */
export interface LedgerEntryView {
  id: string;
  businessDay: IsoDate;
  amountCents: number;
  direction: Direction;
  paymentMethod: PaymentMethod;
  category: Category;
  status: LedgerEntryStatus;
  label: LedgerLabel;
  source: LedgerEntrySource;
  counterparty: string | null;
  counterpartyNormalized: string | null;
  operationNumber: string | null;
  operationAt: Date | null;
  inboundMessageId: string | null;
  afterClose: boolean;
  createdAt: Date;
}

/** «Vigente»: still in the ledger (not duplicate, voided or superseded). */
export const LIVE_STATUSES = [
  'confirmed',
  'pending',
] as const satisfies readonly LedgerEntryStatus[];

export function isLive(entry: Pick<LedgerEntryView, 'status'>): boolean {
  return entry.status === 'confirmed' || entry.status === 'pending';
}

/** Digital payment methods (11.6: yape, plin, transferencia). */
export const DIGITAL_METHODS = [
  'yape',
  'plin',
  'bank_transfer',
] as const satisfies readonly PaymentMethod[];

export function isDigitalMethod(method: PaymentMethod): boolean {
  return method === 'yape' || method === 'plin' || method === 'bank_transfer';
}

/** Categories that never count in sales, outflows or «por confirmar» (11.6). */
export function isExcludedFromTotals(category: Category): boolean {
  return category === 'personal' || category === 'internal';
}

/** Categories that make up «salió» (11.6). */
export const OUTFLOW_CATEGORIES = [
  'inventory',
  'expense',
  'household',
  'unclassified',
] as const satisfies readonly Category[];

export function isOutflowCategory(category: Category): boolean {
  return (OUTFLOW_CATEGORIES as readonly Category[]).includes(category);
}
