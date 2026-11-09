/** Reads the pipeline needs about her: consent, holders, counterparty rules, closes, entries. */
import { and, desc, eq, gte, inArray, lte, or } from 'drizzle-orm';
import {
  accountHolders,
  consents,
  counterpartyRules,
  dailyCloses,
  type LedgerEntry,
  ledgerEntries,
  type User,
} from '../db/schema.js';
import {
  addDays,
  businessDayOf,
  type CloseRef,
  type CounterpartyRuleView,
  DUPLICATE_WINDOW_MS,
  type IsoDate,
  LIVE_STATUSES,
} from '../domain/index.js';
import type { DbOrTx } from '../ledger/types.js';
import { CONSENT_TEXT_VERSION } from '../messages/catalog.js';

/**
 * RF-ON-02, 14.1: her latest consent answer is «Acepto» to the current notice. An «Acepto» to an
 * older version counts as no consent: WA-01 is asked again before anything is processed (D68).
 */
export async function hasAcceptedConsent(db: DbOrTx, userId: string): Promise<boolean> {
  const [latest] = await db
    .select({ accepted: consents.accepted, textVersion: consents.textVersion })
    .from(consents)
    .where(eq(consents.userId, userId))
    .orderBy(desc(consents.createdAt))
    .limit(1);
  return latest?.accepted === true && latest.textVersion === CONSENT_TEXT_VERSION;
}

/** Principal holder plus the additional ones (D31), for `coincide()` (11.2). */
export async function loadHolders(db: DbOrTx, user: User): Promise<string[]> {
  const extra = await db
    .select({ name: accountHolders.name })
    .from(accountHolders)
    .where(eq(accountHolders.userId, user.id));
  return [user.accountHolderName, ...extra.map((row) => row.name)].filter(
    (name): name is string => typeof name === 'string' && name.trim() !== '',
  );
}

export async function loadCounterpartyRules(
  db: DbOrTx,
  userId: string,
): Promise<CounterpartyRuleView[]> {
  const rows = await db
    .select()
    .from(counterpartyRules)
    .where(and(eq(counterpartyRules.userId, userId), eq(counterpartyRules.active, true)));
  return rows.map((row) => ({
    counterpartyNormalized: row.counterpartyNormalized,
    direction: row.direction,
    category: row.category,
    source: row.source,
    active: row.active,
  }));
}

export interface CloseInfo extends CloseRef {
  id: string;
  closeWaMessageId: string | null;
}

/** Closes of today and yesterday (relative to `at`) plus any extra days (a screenshot's date). */
export async function loadCloses(
  db: DbOrTx,
  userId: string,
  at: Date,
  extraDays: readonly IsoDate[] = [],
): Promise<CloseInfo[]> {
  const today = businessDayOf(at);
  const days = [...new Set([today, addDays(today, -1), ...extraDays])];
  const rows = await db
    .select({
      id: dailyCloses.id,
      businessDay: dailyCloses.businessDay,
      status: dailyCloses.status,
      sentAt: dailyCloses.sentAt,
      repliedAt: dailyCloses.repliedAt,
      closeWaMessageId: dailyCloses.closeWaMessageId,
    })
    .from(dailyCloses)
    .where(and(eq(dailyCloses.userId, userId), inArray(dailyCloses.businessDay, days)));
  return rows;
}

/** The close she answered with WhatsApp's «responder», if the quoted message is one. */
export async function closeRepliedTo(
  db: DbOrTx,
  userId: string,
  replyToWaMessageId: string | null,
): Promise<CloseInfo | null> {
  if (!replyToWaMessageId) return null;
  const [row] = await db
    .select({
      id: dailyCloses.id,
      businessDay: dailyCloses.businessDay,
      status: dailyCloses.status,
      sentAt: dailyCloses.sentAt,
      repliedAt: dailyCloses.repliedAt,
      closeWaMessageId: dailyCloses.closeWaMessageId,
    })
    .from(dailyCloses)
    .where(
      and(eq(dailyCloses.userId, userId), eq(dailyCloses.closeWaMessageId, replyToWaMessageId)),
    );
  return row ?? null;
}

/** Live entries of some business days. */
export async function liveEntriesOfDays(
  db: DbOrTx,
  userId: string,
  days: readonly IsoDate[],
): Promise<LedgerEntry[]> {
  if (days.length === 0) return [];
  return db
    .select()
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.userId, userId),
        inArray(ledgerEntries.businessDay, [...new Set(days)]),
        inArray(ledgerEntries.status, LIVE_STATUSES),
      ),
    );
}

/**
 * Live entries that could duplicate an operation (11.4): same operation number (any day), or an
 * operation time within ±2 minutes.
 */
export async function duplicateCandidates(
  db: DbOrTx,
  userId: string,
  operationNumbers: readonly string[],
  operationTimes: readonly Date[],
): Promise<LedgerEntry[]> {
  const conditions = [
    ...(operationNumbers.length > 0
      ? [inArray(ledgerEntries.operationNumber, [...operationNumbers])]
      : []),
    ...operationTimes.map((at) =>
      and(
        gte(ledgerEntries.operationAt, new Date(at.getTime() - DUPLICATE_WINDOW_MS)),
        lte(ledgerEntries.operationAt, new Date(at.getTime() + DUPLICATE_WINDOW_MS)),
      ),
    ),
  ];
  if (conditions.length === 0) return [];
  return db
    .select()
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.userId, userId),
        inArray(ledgerEntries.status, LIVE_STATUSES),
        or(...conditions),
      ),
    );
}

/** Her live entries created from messages in the correction window (case 13). */
export async function recentEntries(
  db: DbOrTx,
  userId: string,
  since: Date,
): Promise<LedgerEntry[]> {
  return db
    .select()
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.userId, userId),
        inArray(ledgerEntries.status, LIVE_STATUSES),
        gte(ledgerEntries.createdAt, since),
      ),
    )
    .orderBy(desc(ledgerEntries.createdAt));
}
