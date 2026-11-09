/**
 * Reports (5.10, HU-14): generation, owner-only download and expiry of the files.
 * The 03:00 job calls `deleteExpiredReports(db, storage, now)`.
 */
export {
  DEFAULT_REPORT_RATE_LIMIT,
  deleteExpiredReports,
  type GeneratedReport,
  type GenerateReportResult,
  generateReport,
  getReportFile,
  REPORT_CONTENT_TYPES,
  REPORT_FORMATS,
  REPORT_MESSAGES,
  REPORT_RETENTION_MS,
  type ReportDeps,
  type ReportFileResult,
  type ReportFormat,
  type ReportRateLimit,
  reportFileName,
  reportStorageKey,
} from './service.js';
