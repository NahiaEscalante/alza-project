/**
 * «Descargar mi historial» (4.8, 5.10, HU-14): generates her PDF and Excel, keeps them encrypted
 * in the blob storage (D45) for a few days and hands them back only to her (14.4).
 *
 * - The files come from `render/` (templates and code, never AI) with clients as initials (PR04).
 * - A `reports` row is kept after its files expire, with the keys cleared: it is the count of
 *   reports in the metrics (13.5). Expired files are deleted by the 03:00 job through
 *   `deleteExpiredReports`.
 * - Generation is limited per user (14.5); the count comes from the `reports` rows, so it survives
 *   restarts.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, isNotNull, lte, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { type Report, reports } from '../db/schema.js';
import { DAY_MS, HOUR_MS } from '../domain/index.js';
import {
  loadReportData,
  type ReportPeriod,
  renderReportPdf,
  renderReportXlsx,
} from '../render/index.js';
import type { BlobStorage } from '../storage/blob-storage.js';

export const REPORT_FORMATS = ['pdf', 'xlsx'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export const REPORT_CONTENT_TYPES: Record<ReportFormat, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** How long the files can be downloaded again before the 03:00 job deletes them. */
export const REPORT_RETENTION_MS = 7 * DAY_MS;

export interface ReportRateLimit {
  limit: number;
  windowMs: number;
}

/** A few per hour: she needs one, maybe a second with another period. */
export const DEFAULT_REPORT_RATE_LIMIT: ReportRateLimit = { limit: 5, windowMs: HOUR_MS };

export const REPORT_MESSAGES = {
  rate_limited: 'Ya generaste varios historiales en la última hora. Intenta de nuevo en un rato.',
  expired: 'Este archivo ya no está disponible. Vuelve a descargar tu historial.',
} as const;

const PERIOD_SLUG: Record<ReportPeriod, string> = {
  '4_weeks': '4-semanas',
  '12_weeks': '12-semanas',
  all: 'todo',
};

/** `alza-historial-4-semanas.pdf`, `alza-historial-todo.xlsx`. */
export function reportFileName(period: ReportPeriod, format: ReportFormat): string {
  return `alza-historial-${PERIOD_SLUG[period]}.${format}`;
}

/** Storage key convention of `blob-storage.ts`: `reports/<userId>/<id>.<format>`. */
export function reportStorageKey(userId: string, reportId: string, format: ReportFormat): string {
  return `reports/${userId}/${reportId}.${format}`;
}

export interface ReportDeps {
  db: Db;
  storage: Pick<BlobStorage, 'put' | 'get' | 'delete'>;
}

export interface GeneratedReport {
  id: string;
  period: ReportPeriod;
  createdAt: Date;
  expiresAt: Date;
  pdfSizeBytes: number;
  xlsxSizeBytes: number;
}

export type GenerateReportResult =
  | { ok: true; report: GeneratedReport }
  | { ok: false; error: 'rate_limited'; retryAfterSec: number };

export async function generateReport(
  deps: ReportDeps,
  input: { userId: string; period: ReportPeriod; now: Date; rateLimit?: ReportRateLimit },
): Promise<GenerateReportResult> {
  const { db, storage } = deps;
  const { userId, period, now } = input;
  const rateLimit = input.rateLimit ?? DEFAULT_REPORT_RATE_LIMIT;

  const recent = await db
    .select({ createdAt: reports.createdAt })
    .from(reports)
    .where(
      and(
        eq(reports.userId, userId),
        gt(reports.createdAt, new Date(now.getTime() - rateLimit.windowMs)),
      ),
    )
    .orderBy(asc(reports.createdAt));
  if (recent.length >= rateLimit.limit) {
    const oldest = recent[recent.length - rateLimit.limit]?.createdAt ?? now;
    const retryAfterMs = oldest.getTime() + rateLimit.windowMs - now.getTime();
    return {
      ok: false,
      error: 'rate_limited',
      retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  const data = await loadReportData(db, userId, period, now);
  const [pdf, xlsx] = await Promise.all([renderReportPdf(data), renderReportXlsx(data)]);

  const id = randomUUID();
  const pdfKey = reportStorageKey(userId, id, 'pdf');
  const xlsxKey = reportStorageKey(userId, id, 'xlsx');
  try {
    await storage.put(pdfKey, pdf, { contentType: REPORT_CONTENT_TYPES.pdf });
    await storage.put(xlsxKey, xlsx, { contentType: REPORT_CONTENT_TYPES.xlsx });
    await db.insert(reports).values({
      id,
      userId,
      period,
      pdfStorageKey: pdfKey,
      xlsxStorageKey: xlsxKey,
      createdAt: now,
    });
  } catch (err) {
    // No row → nothing points at the files: do not leave them behind.
    await Promise.allSettled([storage.delete(pdfKey), storage.delete(xlsxKey)]);
    throw err;
  }

  return {
    ok: true,
    report: {
      id,
      period,
      createdAt: now,
      expiresAt: new Date(now.getTime() + REPORT_RETENTION_MS),
      pdfSizeBytes: pdf.byteLength,
      xlsxSizeBytes: xlsx.byteLength,
    },
  };
}

export type ReportFileResult =
  | { ok: true; data: Buffer; contentType: string; fileName: string }
  | { ok: false; error: 'not_found' | 'expired' };

/** One file of one report, only for its owner: another user's id is «not found» (14.4). */
export async function getReportFile(
  deps: ReportDeps,
  input: { userId: string; reportId: string; format: ReportFormat; now: Date },
): Promise<ReportFileResult> {
  const { db, storage } = deps;
  const [row] = await db
    .select()
    .from(reports)
    .where(and(eq(reports.id, input.reportId), eq(reports.userId, input.userId)));
  if (!row) return { ok: false, error: 'not_found' };

  const key = input.format === 'pdf' ? row.pdfStorageKey : row.xlsxStorageKey;
  if (!key || isExpired(row, input.now)) return { ok: false, error: 'expired' };
  const blob = await storage.get(key);
  if (!blob) return { ok: false, error: 'expired' };
  return {
    ok: true,
    data: blob.data,
    contentType: REPORT_CONTENT_TYPES[input.format],
    fileName: reportFileName(row.period as ReportPeriod, input.format),
  };
}

function isExpired(row: Pick<Report, 'createdAt'>, now: Date): boolean {
  return now.getTime() - row.createdAt.getTime() >= REPORT_RETENTION_MS;
}

/**
 * For the 03:00 job (8.4): deletes the files of reports `retentionMs` old or more and clears their
 * keys; the rows stay (metrics, 13.5). Returns how many reports were cleaned. Safe to run again.
 */
export async function deleteExpiredReports(
  db: Db,
  storage: Pick<BlobStorage, 'delete'>,
  now: Date,
  retentionMs: number = REPORT_RETENTION_MS,
): Promise<number> {
  const expired = await db
    .select({ id: reports.id, pdf: reports.pdfStorageKey, xlsx: reports.xlsxStorageKey })
    .from(reports)
    .where(
      and(
        lte(reports.createdAt, new Date(now.getTime() - retentionMs)),
        or(isNotNull(reports.pdfStorageKey), isNotNull(reports.xlsxStorageKey)),
      ),
    );
  for (const row of expired) {
    for (const key of [row.pdf, row.xlsx]) if (key) await storage.delete(key);
    await db
      .update(reports)
      .set({ pdfStorageKey: null, xlsxStorageKey: null })
      .where(eq(reports.id, row.id));
  }
  return expired.length;
}
