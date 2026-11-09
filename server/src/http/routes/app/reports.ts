/**
 * «Descargar mi historial» (4.8, 5.10, 10.4, HU-14). 🔒 = PIN in the last 10 minutes.
 *
 * | Route                      | Body / answer                                                 |
 * |----------------------------|---------------------------------------------------------------|
 * | POST /reports 🔒           | { period: '4_weeks' \| '12_weeks' \| 'all' } → 201 + URLs     |
 * | GET  /reports/:id/pdf      | the PDF, as an attachment (`alza-historial-4-semanas.pdf`)    |
 * | GET  /reports/:id/xlsx     | the Excel, as an attachment                                   |
 *
 * Downloads need her session only (10.4): the PIN was asked when the report was made, and the
 * files are hers alone (another user's id answers 404, 14.4). Sharing them is her decision (14.1).
 */
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import type { AuthEnv } from '../../../auth/index.js';
import { REPORT_PERIODS } from '../../../render/index.js';
import {
  generateReport,
  getReportFile,
  REPORT_MESSAGES,
  type ReportFormat,
} from '../../../reports/index.js';
import type { RouteDeps } from './deps.js';
import { isUuid, jsonBodyLimit, noStore, notFound, readJson } from './http.js';

const createBody = z.object({ period: z.enum(REPORT_PERIODS) });

const fileUrl = (id: string, format: ReportFormat) => `/api/reports/${id}/${format}`;

export function registerReportRoutes(router: Hono<AuthEnv>, deps: RouteDeps): void {
  const { db, now, requireSession, requireRecentPin } = deps;
  const reportDeps = () => ({ db, storage: deps.reportStorage() });

  router.post('/reports', noStore, requireSession, requireRecentPin, jsonBodyLimit, async (c) => {
    const body = await readJson(c, createBody);
    if (!body.ok) return body.response;
    const result = await generateReport(reportDeps(), {
      userId: c.var.session.userId,
      period: body.data.period,
      now: now(),
    });
    if (!result.ok) {
      c.header('Retry-After', String(result.retryAfterSec));
      return c.json({ error: 'rate_limited', message: REPORT_MESSAGES.rate_limited }, 429);
    }
    const { report } = result;
    return c.json(
      {
        id: report.id,
        period: report.period,
        createdAt: report.createdAt.toISOString(),
        expiresAt: report.expiresAt.toISOString(),
        pdfUrl: fileUrl(report.id, 'pdf'),
        xlsxUrl: fileUrl(report.id, 'xlsx'),
        pdfSizeBytes: report.pdfSizeBytes,
        xlsxSizeBytes: report.xlsxSizeBytes,
      },
      201,
    );
  });

  const download = (format: ReportFormat) => async (c: Context<AuthEnv>) => {
    const reportId = c.req.param('id');
    if (!isUuid(reportId)) return notFound(c);
    const file = await getReportFile(reportDeps(), {
      userId: c.var.session.userId,
      reportId,
      format,
      now: now(),
    });
    if (!file.ok) {
      return file.error === 'expired'
        ? c.json({ error: 'report_expired', message: REPORT_MESSAGES.expired }, 410)
        : notFound(c);
    }
    return c.body(new Uint8Array(file.data), 200, {
      'Content-Type': file.contentType,
      'Content-Length': String(file.data.byteLength),
      'Content-Disposition': `attachment; filename="${file.fileName}"`,
    });
  };

  router.get('/reports/:id/pdf', noStore, requireSession, download('pdf'));
  router.get('/reports/:id/xlsx', noStore, requireSession, download('xlsx'));
}
