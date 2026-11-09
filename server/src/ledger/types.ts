import type { Db } from '../db/client.js';
import type {
  Category,
  CreatedBy,
  Direction,
  LedgerEntrySource,
  PaymentMethod,
} from '../db/schema.js';

/** A drizzle transaction. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Writes accept a database or an open transaction (they nest as savepoints). */
export type DbOrTx = Db | Tx;

/** Runs `fn` in a transaction; inside an existing one it becomes a savepoint. */
export function inTransaction<T>(db: DbOrTx, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return (db as Db).transaction(fn);
}

/**
 * Who makes a change, for `ledger_entry_events.actor` and `ledger_entries.created_by`.
 * Stored as `kind:channel` (e.g. `user:web`, `system:pipeline`) or `admin:<adminUserId>`.
 */
export interface Actor {
  kind: CreatedBy;
  channel: 'web' | 'chat' | 'whatsapp' | 'pipeline' | 'job' | 'panel' | 'seed';
  adminUserId?: string;
}

export const WEB_USER: Actor = { kind: 'user', channel: 'web' };

export function actorLabel(actor: Actor): string {
  if (actor.kind === 'admin' && actor.adminUserId) return `admin:${actor.adminUserId}`;
  return `${actor.kind}:${actor.channel}`;
}

/** Resolutions from the web or the chat end as `resolved_web` (9.2); the rest as `resolved`. */
export function resolvedStatusFor(actor: Actor): 'resolved' | 'resolved_web' {
  return actor.channel === 'web' || actor.channel === 'chat' ? 'resolved_web' : 'resolved';
}

/** Where a new ledger row comes from (RF-LB-02). */
export interface EntryOrigin {
  source: LedgerEntrySource;
  /** Message that originated it. Undefined on a replacement keeps the old entry's message. */
  inboundMessageId?: string | null;
}

/** A row of a «lista de movimientos» (11.10), as stored in `clarifications.detail`. */
export interface ListRowDetail {
  amountCents: number;
  direction: Direction;
  paymentMethod: PaymentMethod;
  counterparty: string | null;
  operationNumber: string | null;
  /** ISO instant. */
  operationAt: string | null;
}

/**
 * `clarifications.detail` (Fase 7 migration 0001): what the doubt is about when the ledger entry
 * does not say it. Every field is optional; the web falls back to generic texts.
 */
export interface ClarificationDetail {
  /** missing_from_list */
  row?: ListRowDetail;
  /** ambiguous_total: the total she declared. */
  declaredTotalCents?: number;
  /** ambiguous_total: «no_method» («hoy vendí 150») or «cash_below_recorded» (11.5 row 3). */
  variant?: 'no_method' | 'cash_below_recorded';
  /** ambiguous_total, cash_below_recorded: cash already recorded when she said the total. */
  recordedCents?: number;
  /** Her words, for «Dijiste «…»» (ambiguous_total, unreadable audio). Shown only to her. */
  quote?: string;
  /** unreadable: what the reader did know. */
  direction?: Direction;
  paymentMethod?: PaymentMethod;
  /** ISO instant of the operation or message, for «una captura de las 11:42 a. m.». */
  at?: string;
}

export type { Category, Direction, PaymentMethod };
