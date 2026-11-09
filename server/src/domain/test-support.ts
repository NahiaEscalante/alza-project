/**
 * Builders for domain tests only (not exported by the barrel). Explicit timestamps, no clock.
 */
import type { LedgerEntryView } from './types.js';

let sequence = 0;

/** Lima wall clock → instant: lima('2026-11-10T21:00') is 21:00 in Lima. */
export function lima(localDateTime: string): Date {
  return new Date(`${localDateTime}:00-05:00`);
}

/** A confirmed cash sale of S/10 on Tuesday 10 Nov 2026, unless overridden. */
export function entry(overrides: Partial<LedgerEntryView> = {}): LedgerEntryView {
  sequence += 1;
  return {
    id: `entry-${sequence}`,
    businessDay: '2026-11-10',
    amountCents: 1000,
    direction: 'in',
    paymentMethod: 'cash',
    category: 'sale',
    status: 'confirmed',
    label: 'self_reported',
    source: 'text',
    counterparty: null,
    counterpartyNormalized: null,
    operationNumber: null,
    operationAt: null,
    inboundMessageId: null,
    afterClose: false,
    createdAt: lima('2026-11-10T10:00'),
    ...overrides,
  };
}

/** A confirmed Yape sale read from a screenshot. */
export function screenshotEntry(overrides: Partial<LedgerEntryView> = {}): LedgerEntryView {
  return entry({ paymentMethod: 'yape', label: 'screenshot', source: 'screenshot', ...overrides });
}

/** Marta's Tuesday (11.6): S/298 digital + S/114 cash in; S/150 inventory by Yape + S/30 household. */
export function martaTuesday(): LedgerEntryView[] {
  return [
    screenshotEntry({ amountCents: 20_000 }),
    screenshotEntry({ amountCents: 9_800, paymentMethod: 'plin' }),
    entry({ amountCents: 9_500 }),
    entry({ amountCents: 1_900 }),
    screenshotEntry({ amountCents: 15_000, direction: 'out', category: 'inventory' }),
    entry({ amountCents: 3_000, direction: 'out', category: 'household' }),
  ];
}

export const MARTA_TUESDAY: readonly LedgerEntryView[] = martaTuesday();
