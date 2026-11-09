/**
 * Render (8.1 «Generador»): the summary image of the close (8.6, D26) and the downloadable report
 * (5.10). Templates and code only, never AI; fonts ship with the server (`assets/fonts`).
 *
 * - Fase 5: `renderSummaryImage(data)` → PNG to upload to WhatsApp (and not keep). If it throws,
 *   the close goes out as text only (RF-CI-10). Not called when she chose «solo texto» (D27).
 * - Fase 8: `loadReportData(db, userId, period, now)` → `renderReportPdf` / `renderReportXlsx`.
 */
export { initials } from './format.js';
export { loadReportData } from './report-data.js';
export {
  buildReportData,
  entryRef,
  type ReportChange,
  type ReportChartBucket,
  type ReportData,
  type ReportDay,
  type ReportEntry,
  type ReportOriginRow,
  type ReportRows,
  type ReportTraceRow,
  rangeText,
  reportRange,
} from './report-model.js';
export { renderReportPdf } from './report-pdf.js';
export { isReportPeriod, PERIOD_TEXT, REPORT_PERIODS, type ReportPeriod } from './report-texts.js';
export { renderReportXlsx, SHEET_NAMES } from './report-xlsx.js';
export { MAX_IMAGE_BYTES, renderSummaryImage, renderSummarySvg } from './summary-image.js';
export {
  type SummaryFigures,
  type SummaryImageData,
  type SummaryPoints,
  type SummaryWeek,
  summaryWeekFrom,
} from './summary-types.js';
