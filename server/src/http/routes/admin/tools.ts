/**
 * Metrics, audit log and demo tools (RF-AD-03, RF-AD-04, 17.6). All behind `requireAdmin`.
 *
 * | Route                                   | Body                                              |
 * |-----------------------------------------|---------------------------------------------------|
 * | GET  /metrics                           |                                                   |
 * | GET  /audit-log                         |                                                   |
 * | GET  /tools                             | → { today, lastFinalizableDay, technicalIssue }   |
 * | POST /tools/close-finalize              | { confirm: true, businessDay?, userId? | allUsers: true } |
 * | POST /tools/antifraud-scan              | { confirm: true, userId? | allUsers: true }       |
 * | POST /tools/technical-issue             | { confirm: true, startedAt }                      |
 *
 * Tools need `confirm: true` and an explicit scope (one user, or `allUsers: true`): a demo
 * click never finalizes everyone's day by accident.
 */
import type { Context, Hono, MiddlewareHandler } from 'hono';
import { z } from 'zod';
import {
  computeMetrics,
  listAuditLog,
  runAntifraudScanNow,
  runCloseFinalize,
  sendTechnicalIssueNotice,
  type ToolResult,
  type ToolScope,
} from '../../../admin/index.js';
import { businessDayOf, DAY_MS, HOUR_MS } from '../../../domain/index.js';
import { lastFinalizableDay } from '../../../jobs/calendar.js';
import { businessDaySchema, jsonBodyLimit, readJson } from '../app/http.js';
import { ADMIN_MESSAGES, type AdminEnv, type AdminRouteDeps, adminError } from './deps.js';

const scopeFields = {
  confirm: z.literal(true),
  userId: z.uuid().optional(),
  allUsers: z.literal(true).optional(),
};
const hasOneScope = (body: { userId?: string; allUsers?: true }) =>
  (body.userId !== undefined) !== (body.allUsers === true);

const finalizeBody = z
  .object({ ...scopeFields, businessDay: businessDaySchema.optional() })
  .refine(hasOneScope, { path: ['userId'] });
const scanBody = z.object(scopeFields).refine(hasOneScope, { path: ['userId'] });
const technicalIssueBody = z.object({ confirm: z.literal(true), startedAt: z.iso.datetime() });

function toScope(body: { userId?: string }): ToolScope {
  return body.userId ? { userId: body.userId } : { allUsers: true };
}

function toolResponse(c: Context, result: ToolResult): Response {
  if (result.ok) return c.json(result);
  return result.error === 'future_day'
    ? adminError(c, 400, 'future_day', ADMIN_MESSAGES.future_day)
    : adminError(c, 500, 'job_failed', ADMIN_MESSAGES.job_failed);
}

export function registerAdminToolRoutes(
  router: Hono<AdminEnv>,
  deps: AdminRouteDeps,
  requireAdmin: MiddlewareHandler<AdminEnv>,
): void {
  const { db, now } = deps;

  router.get('/metrics', requireAdmin, async (c) => c.json(await computeMetrics(db, now())));

  router.get('/audit-log', requireAdmin, async (c) =>
    c.json({ items: await listAuditLog(db, { limit: 100 }) }),
  );

  router.get('/tools', requireAdmin, (c) => {
    const at = now();
    return c.json({
      today: businessDayOf(at),
      lastFinalizableDay: lastFinalizableDay(at),
      technicalIssue: deps.broadcastTechnicalIssue !== null,
    });
  });

  router.post('/tools/close-finalize', requireAdmin, jsonBodyLimit, async (c) => {
    const body = await readJson(c, finalizeBody);
    if (!body.ok) return body.response;
    const result = await runCloseFinalize({ db, jobs: deps.jobs() }, c.var.admin, {
      businessDay: body.data.businessDay,
      scope: toScope(body.data),
      now: now(),
    });
    return toolResponse(c, result);
  });

  router.post('/tools/antifraud-scan', requireAdmin, jsonBodyLimit, async (c) => {
    const body = await readJson(c, scanBody);
    if (!body.ok) return body.response;
    const result = await runAntifraudScanNow({ db, jobs: deps.jobs() }, c.var.admin, {
      scope: toScope(body.data),
      now: now(),
    });
    return toolResponse(c, result);
  });

  router.post('/tools/technical-issue', requireAdmin, jsonBodyLimit, async (c) => {
    const body = await readJson(c, technicalIssueBody);
    if (!body.ok) return body.response;
    const broadcast = deps.broadcastTechnicalIssue;
    if (!broadcast) {
      return adminError(c, 503, 'broadcast_unavailable', ADMIN_MESSAGES.broadcast_unavailable);
    }
    const at = now();
    const startedAt = new Date(body.data.startedAt);
    // An incident starts in the past, at most a week ago (WA-17 goes inside the 24 h window).
    if (
      startedAt.getTime() > at.getTime() + HOUR_MS ||
      startedAt.getTime() < at.getTime() - 7 * DAY_MS
    ) {
      return c.json(
        { error: 'invalid_request', fields: ['startedAt'], message: 'Revisa la hora de inicio.' },
        400,
      );
    }
    const result = await sendTechnicalIssueNotice({ db, broadcast }, c.var.admin, {
      startedAt,
      now: at,
    });
    return c.json(result);
  });
}
