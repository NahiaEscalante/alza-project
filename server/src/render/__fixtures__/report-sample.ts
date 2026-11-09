/**
 * Deterministic ledger rows for 4 weeks of a bodega, with every case the report must show:
 * screenshots and self-reported cash, all outflow types, a pending entry, a correction, a removed
 * entry, a repeated screenshot, an entry after the close (PR03), a «sin detalle» difference
 * (PR09), a personal entry and days with «caja sin revisar».
 */
import type { DailyClose, LedgerEntry, LedgerEntryEventRow } from '../../db/schema.js';
import { addDays, limaInstant } from '../../domain/index.js';
import { buildReportData, type ReportData, type ReportRows } from '../report-model.js';
import type { ReportPeriod } from '../report-texts.js';

export const SAMPLE_USER_ID = '00000000-0000-4000-8000-00000000a1a1';
export const SAMPLE_NOW = limaInstant('2026-11-15', 22, 10);
export const SAMPLE_FROM = '2026-10-19';
export const SAMPLE_TO = '2026-11-15';

/** Full names that must never reach the report (PR04). */
export const SAMPLE_CLIENTS = [
  'Rosa María Quispe',
  'Juan Carlos Mendoza Ríos',
  'Lucía de la Cruz',
  'Distribuidora Santa Rosa SAC',
  'Pedro Huamán',
  'Carmen Flores',
] as const;

function prng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

export function sampleReportRows(period: ReportPeriod = '4_weeks'): ReportRows {
  const random = prng(7);
  let counter = 0;
  const id = () => `00000000-0000-4000-8000-${(++counter).toString(16).padStart(12, '0')}`;
  const entries: LedgerEntry[] = [];
  const events: LedgerEntryEventRow[] = [];
  const closes: DailyClose[] = [];

  const add = (
    values: Partial<LedgerEntry> &
      Pick<LedgerEntry, 'businessDay' | 'amountCents' | 'direction' | 'paymentMethod' | 'category'>,
    actor = 'system:pipeline',
    reason: string | null = null,
  ): LedgerEntry => {
    const createdAt = values.createdAt ?? values.operationAt ?? limaInstant(values.businessDay, 12);
    const entry: LedgerEntry = {
      id: id(),
      userId: SAMPLE_USER_ID,
      operationAt: null,
      counterparty: null,
      counterpartyNormalized: null,
      operationNumber: null,
      label: 'screenshot',
      status: 'confirmed',
      source: 'screenshot',
      inboundMessageId: null,
      replacesEntryId: null,
      createdBy: 'system',
      afterClose: false,
      ...values,
      createdAt,
    };
    entries.push(entry);
    events.push({
      id: id(),
      ledgerEntryId: entry.id,
      event: 'created',
      detail: { source: entry.source, reason },
      actor,
      createdAt,
    });
    return entry;
  };

  for (let day = SAMPLE_FROM; day <= SAMPLE_TO; day = addDays(day, 1)) {
    const sales = 4 + Math.floor(random() * 5);
    for (let i = 0; i < sales; i++) {
      const at = limaInstant(day, 8 + i, Math.floor(random() * 59));
      add({
        businessDay: day,
        operationAt: at,
        amountCents: (5 + Math.floor(random() * 60)) * 100 + (random() < 0.3 ? 50 : 0),
        direction: 'in',
        paymentMethod: random() < 0.7 ? 'yape' : 'plin',
        category: 'sale',
        counterparty: SAMPLE_CLIENTS[i % 5] ?? null,
        operationNumber: `${day.replace(/-/g, '')}${i}`,
      });
    }
    add(
      {
        businessDay: day,
        createdAt: limaInstant(day, 20, 30),
        amountCents: (60 + Math.floor(random() * 80)) * 100,
        direction: 'in',
        paymentMethod: 'cash',
        category: 'sale',
        label: 'self_reported',
        source: random() < 0.5 ? 'audio' : 'text',
      },
      'system:pipeline',
    );
    if (random() < 0.45) {
      add({
        businessDay: day,
        operationAt: limaInstant(day, 10, 15),
        amountCents: (80 + Math.floor(random() * 120)) * 100,
        direction: 'out',
        paymentMethod: 'yape',
        category: 'inventory',
        counterparty: 'Distribuidora Santa Rosa SAC',
      });
    }
    if (random() < 0.3) {
      add({
        businessDay: day,
        createdAt: limaInstant(day, 19, 0),
        amountCents: (20 + Math.floor(random() * 30)) * 100,
        direction: 'out',
        paymentMethod: 'cash',
        category: random() < 0.5 ? 'household' : 'expense',
        label: 'self_reported',
        source: 'text',
      });
    }

    const level =
      day === SAMPLE_TO
        ? null
        : random() < 0.75
          ? 'complete'
          : random() < 0.6
            ? 'partial'
            : 'no_close';
    // Every close went out at 21:00; a «sin cierre» day simply got no answer.
    const sentAt = limaInstant(day, 21);
    closes.push({
      id: id(),
      userId: SAMPLE_USER_ID,
      businessDay: day,
      status: level === null ? 'sent' : 'final',
      sentAt,
      repliedAt: level === 'no_close' || level === null ? null : limaInstant(day, 21, 40),
      finalAt: level === null ? null : limaInstant(addDays(day, 1), 12),
      expectedCashChangeCents: 8_400,
      cashCheck:
        level === 'complete'
          ? 'balanced'
          : level === 'partial'
            ? 'unsure'
            : level === 'no_close'
              ? 'no_answer'
              : null,
      level,
      improvedLevel: null,
      clarificationRounds: 0,
      closeWaMessageId: null,
      createdAt: limaInstant(day, 4),
    });
  }

  // A correction from the web (D16): S/ 12 with screenshot → S/ 120 «lo contaste tú».
  const original = add({
    businessDay: '2026-11-10',
    operationAt: limaInstant('2026-11-10', 11, 42),
    amountCents: 1_200,
    direction: 'in',
    paymentMethod: 'yape',
    category: 'sale',
    counterparty: 'Carmen Flores',
  });
  original.status = 'superseded';
  const fixedAt = limaInstant('2026-11-11', 9, 12);
  const fixed = add(
    {
      businessDay: '2026-11-10',
      operationAt: original.operationAt,
      amountCents: 12_000,
      direction: 'in',
      paymentMethod: 'yape',
      category: 'sale',
      counterparty: 'Carmen Flores',
      label: 'self_reported',
      source: 'web',
      replacesEntryId: original.id,
      createdBy: 'user',
      createdAt: fixedAt,
    },
    'user:web',
    'web_correction',
  );
  events.push({
    id: id(),
    ledgerEntryId: original.id,
    event: 'superseded',
    detail: { replacedBy: fixed.id, reason: 'web_correction' },
    actor: 'user:web',
    createdAt: fixedAt,
  });

  // Removed from the web.
  const removed = add({
    businessDay: '2026-11-04',
    operationAt: limaInstant('2026-11-04', 16, 5),
    amountCents: 3_500,
    direction: 'in',
    paymentMethod: 'plin',
    category: 'sale',
    counterparty: 'Pedro Huamán',
  });
  removed.status = 'voided';
  events.push({
    id: id(),
    ledgerEntryId: removed.id,
    event: 'voided',
    detail: { reason: 'web_void' },
    actor: 'user:web',
    createdAt: limaInstant('2026-11-05', 8, 30),
  });

  // The same screenshot sent twice (11.4).
  add({
    businessDay: '2026-11-06',
    operationAt: limaInstant('2026-11-06', 13, 20),
    amountCents: 2_450,
    direction: 'in',
    paymentMethod: 'yape',
    category: 'sale',
    counterparty: 'Rosa María Quispe',
    status: 'duplicate',
  });

  // Pending: an unreadable amount, and a doubt on an outflow.
  add({
    businessDay: '2026-11-12',
    operationAt: limaInstant('2026-11-12', 11, 42),
    amountCents: 4_500,
    direction: 'in',
    paymentMethod: 'yape',
    category: 'sale',
    counterparty: 'Lucía de la Cruz',
    status: 'pending',
  });
  add({
    businessDay: '2026-11-12',
    operationAt: limaInstant('2026-11-12', 15, 0),
    amountCents: 1_500,
    direction: 'out',
    paymentMethod: 'yape',
    category: 'unclassified',
    counterparty: 'Juan Carlos Mendoza Ríos',
  });

  // PR03: arrived after the close was answered.
  add({
    businessDay: '2026-11-09',
    operationAt: limaInstant('2026-11-09', 19, 50),
    createdAt: limaInstant('2026-11-10', 8, 5),
    amountCents: 1_800,
    direction: 'in',
    paymentMethod: 'plin',
    category: 'sale',
    counterparty: 'Juan Carlos Mendoza Ríos',
    afterClose: true,
  });

  // PR09: «hoy vendí 200 en efectivo» with less recorded.
  add({
    businessDay: '2026-11-03',
    createdAt: limaInstant('2026-11-03', 21, 45),
    amountCents: 10_500,
    direction: 'in',
    paymentMethod: 'cash',
    category: 'sale',
    label: 'unitemized',
    source: 'close_reply',
  });

  // Personal: does not count.
  add({
    businessDay: '2026-11-07',
    operationAt: limaInstant('2026-11-07', 18, 0),
    amountCents: 5_000,
    direction: 'in',
    paymentMethod: 'yape',
    category: 'personal',
    counterparty: 'Pedro Huamán',
  });

  // Added from the web for a past day (D16).
  add(
    {
      businessDay: '2026-11-08',
      createdAt: limaInstant('2026-11-13', 10, 0),
      amountCents: 2_000,
      direction: 'out',
      paymentMethod: 'cash',
      category: 'expense',
      label: 'self_reported',
      source: 'web',
      createdBy: 'user',
    },
    'user:web',
    'added_past_day',
  );

  return {
    period,
    from: SAMPLE_FROM,
    to: SAMPLE_TO,
    now: SAMPLE_NOW,
    businessName: 'Bodega Sol',
    entries,
    events,
    closes,
  };
}

export function sampleReportData(period: ReportPeriod = '4_weeks'): ReportData {
  return buildReportData(sampleReportRows(period));
}
