/**
 * Review screens of the panel (RF-AD-01, RF-AD-02). All behind `requireAdmin`; every POST writes
 * the audit log (RF-AD-04).
 *
 * | Route                                  | Answer                                          |
 * |----------------------------------------|-------------------------------------------------|
 * | GET  /errors?userId=                   | { items, counts, retryAvailable }               |
 * | POST /errors/:id/retry                 | { status: 'ok' } · 404 · 409 not_failed · 503   |
 * | POST /errors/retry-all                 | { retried }                                     |
 * | GET  /redemptions                      | { inReview, reviewed }                          |
 * | POST /redemptions/:id/approve          | { status: 'delivered' } · 404 · 409             |
 * | POST /redemptions/:id/reject           | { status: 'rejected', pointsReturned } · 404 · 409 |
 * | GET  /alerts?status=open|closed&userId=| { items, openCount }                            |
 * | POST /alerts/:id/review { outcome? }   | { status } · 404 · 409                          |
 */
import { eq } from 'drizzle-orm';
import type { Hono, MiddlewareHandler } from 'hono';
import { z } from 'zod';
import {
  approveRedemption,
  listAlerts,
  listFailedMessages,
  listRedemptionsForReview,
  rejectRedemption,
  retryAllFailedMessages,
  retryFailedMessage,
  reviewAlert,
} from '../../../admin/index.js';
import { inboundMessages } from '../../../db/schema.js';
import { isUuid, jsonBodyLimit, readJson } from '../app/http.js';
import { ADMIN_MESSAGES, type AdminEnv, type AdminRouteDeps, adminError } from './deps.js';

const emptyBody = z.object({});
const reviewBody = z.object({ outcome: z.enum(['reviewed', 'dismissed']).default('reviewed') });

export function registerAdminReviewRoutes(
  router: Hono<AdminEnv>,
  deps: AdminRouteDeps,
  requireAdmin: MiddlewareHandler<AdminEnv>,
): void {
  const { db, now } = deps;

  // Failed messages (RF-AD-01) ------------------------------------------------

  /** `?userId=` narrows a list to one user (bad ids are ignored). */
  const userFilter = (value: string | undefined) => (isUuid(value) ? value : undefined);

  router.get('/errors', requireAdmin, async (c) => {
    const view = await listFailedMessages(db, { userId: userFilter(c.req.query('userId')) });
    return c.json({ ...view, retryAvailable: deps.queue !== null });
  });

  router.post('/errors/retry-all', requireAdmin, jsonBodyLimit, async (c) => {
    const body = await readJson(c, emptyBody);
    if (!body.ok) return body.response;
    if (!deps.queue) {
      return adminError(c, 503, 'queue_unavailable', ADMIN_MESSAGES.queue_unavailable);
    }
    const result = await retryAllFailedMessages({ db, queue: deps.queue }, c.var.admin, now());
    return c.json(result);
  });

  router.post('/errors/:id/retry', requireAdmin, jsonBodyLimit, async (c) => {
    const body = await readJson(c, emptyBody);
    if (!body.ok) return body.response;
    const id = c.req.param('id');
    if (!isUuid(id)) return adminError(c, 404, 'not_found', ADMIN_MESSAGES.not_found);
    if (!deps.queue) {
      return adminError(c, 503, 'queue_unavailable', ADMIN_MESSAGES.queue_unavailable);
    }
    const retried = await retryFailedMessage({ db, queue: deps.queue }, c.var.admin, id, now());
    if (retried) return c.json({ status: 'ok' });
    const [exists] = await db
      .select({ id: inboundMessages.id })
      .from(inboundMessages)
      .where(eq(inboundMessages.id, id));
    return exists
      ? adminError(c, 409, 'not_failed', ADMIN_MESSAGES.not_failed)
      : adminError(c, 404, 'not_found', ADMIN_MESSAGES.not_found);
  });

  // Big rewards in review (13.3) ---------------------------------------------

  router.get('/redemptions', requireAdmin, async (c) => {
    return c.json(await listRedemptionsForReview(db));
  });

  for (const decision of ['approve', 'reject'] as const) {
    router.post(`/redemptions/:id/${decision}`, requireAdmin, jsonBodyLimit, async (c) => {
      const body = await readJson(c, emptyBody);
      if (!body.ok) return body.response;
      const id = c.req.param('id');
      if (!isUuid(id)) return adminError(c, 404, 'not_found', ADMIN_MESSAGES.not_found);
      const decide = decision === 'approve' ? approveRedemption : rejectRedemption;
      const result = await decide(db, c.var.admin, id, now());
      if (!result.ok) {
        return result.error === 'not_found'
          ? adminError(c, 404, 'not_found', ADMIN_MESSAGES.not_found)
          : adminError(c, 409, 'not_in_review', ADMIN_MESSAGES.not_in_review);
      }
      return c.json({ status: result.status, pointsReturned: result.pointsReturned });
    });
  }

  // Alerts (13.4, D28) -------------------------------------------------------

  router.get('/alerts', requireAdmin, async (c) => {
    const filter = c.req.query('status') === 'closed' ? 'closed' : 'open';
    return c.json(await listAlerts(db, { filter, userId: userFilter(c.req.query('userId')) }));
  });

  router.post('/alerts/:id/review', requireAdmin, jsonBodyLimit, async (c) => {
    const body = await readJson(c, reviewBody);
    if (!body.ok) return body.response;
    const id = c.req.param('id');
    if (!isUuid(id)) return adminError(c, 404, 'not_found', ADMIN_MESSAGES.not_found);
    const result = await reviewAlert(db, c.var.admin, id, body.data.outcome, now());
    if (!result.ok) {
      return result.error === 'not_found'
        ? adminError(c, 404, 'not_found', ADMIN_MESSAGES.not_found)
        : adminError(c, 409, 'not_open', ADMIN_MESSAGES.not_open);
    }
    return c.json({ status: result.status });
  });
}
