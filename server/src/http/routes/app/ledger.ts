/**
 * Inicio, Movimientos and Pendientes (10.4, RF-WP-01..04). Every query uses the session's user
 * (14.4); another user's ids answer 404. 🔒 = PIN verified in the last 10 minutes (PR11).
 *
 * | Route                           | Body / query                                   |
 * |---------------------------------|------------------------------------------------|
 * | GET  /home                      |                                                |
 * | GET  /days                      | ?from=YYYY-MM-DD&to=YYYY-MM-DD (default: week) |
 * | GET  /days/:date/entries        |                                                |
 * | PATCH /entries/:id 🔒           | { amountCents?, category? }                    |
 * | POST /entries/:id/void 🔒       | {}                                             |
 * | POST /entries 🔒                | { businessDay, amountCents, direction, paymentMethod, category?, counterparty? } |
 * | GET  /entries/:id/history       |                                                |
 * | GET  /pending                   |                                                |
 * | POST /pending/:id/resolve       | { action, … } (see `options[].resolution`)     |
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { Hono } from 'hono';
import { z } from 'zod';
import { getPointsSummary } from '../../../account/index.js';
import type { AuthEnv } from '../../../auth/index.js';
import { clarifications, users } from '../../../db/schema.js';
import {
  addDays,
  businessDayOf,
  daysBetween,
  isIsoDate,
  weekStart,
} from '../../../domain/index.js';
import {
  addPastDayEntry,
  correctEntry,
  getDayEntries,
  getEntryHistory,
  getWeekView,
  listDays,
  listPending,
  MAX_DAYS_RANGE,
  PENDING_LIST_STATUSES,
  pendingNotice,
  resolveClarification,
  toEntryView,
  voidEntry,
  WEB_USER,
  weekLabel,
} from '../../../ledger/index.js';
import type { RouteDeps } from './deps.js';
import {
  amountCentsSchema,
  businessDaySchema,
  categorySchema,
  directionSchema,
  isUuid,
  jsonBodyLimit,
  ledgerErrorResponse,
  notFound,
  readJson,
  webPaymentMethodSchema,
} from './http.js';

const patchBody = z
  .object({ amountCents: amountCentsSchema.optional(), category: categorySchema.optional() })
  .refine((body) => body.amountCents !== undefined || body.category !== undefined);

const addBody = z.object({
  businessDay: businessDaySchema,
  amountCents: amountCentsSchema,
  direction: directionSchema,
  paymentMethod: webPaymentMethodSchema,
  category: categorySchema.optional(),
  counterparty: z.string().trim().max(80).nullish(),
});

const resolveBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('confirm') }),
  z.object({ action: z.literal('mark_duplicate') }),
  z.object({
    action: z.literal('set_direction'),
    direction: directionSchema,
    category: categorySchema.optional(),
  }),
  z.object({ action: z.literal('set_day'), businessDay: businessDaySchema }),
  z.object({ action: z.literal('set_category'), category: categorySchema }),
  z.object({
    action: z.literal('set_amount'),
    amountCents: amountCentsSchema,
    direction: directionSchema.optional(),
    paymentMethod: webPaymentMethodSchema.optional(),
    category: categorySchema.optional(),
  }),
  z.object({ action: z.literal('cash_only') }),
  z.object({ action: z.literal('whole_day') }),
  z.object({ action: z.literal('add_from_list'), category: categorySchema.optional() }),
  z.object({ action: z.literal('dismiss') }),
]);

async function countPending(deps: RouteDeps, userId: string): Promise<number> {
  const rows = await deps.db
    .select({ id: clarifications.id })
    .from(clarifications)
    .where(
      and(eq(clarifications.userId, userId), inArray(clarifications.status, PENDING_LIST_STATUSES)),
    );
  return rows.length;
}

export function registerLedgerRoutes(router: Hono<AuthEnv>, deps: RouteDeps): void {
  const { db, now, requireSession, requireRecentPin } = deps;

  router.get('/home', requireSession, async (c) => {
    const { userId } = c.var.session;
    const at = now();
    const [[user], points, week, pending] = await Promise.all([
      db
        .select({ businessName: users.businessName, holder: users.accountHolderName })
        .from(users)
        .where(eq(users.id, userId)),
      getPointsSummary(db, userId, at),
      getWeekView(db, userId, businessDayOf(at), at),
      countPending(deps, userId),
    ]);
    return c.json({
      greeting: {
        firstName: user?.holder?.trim().split(/\s+/)[0] ?? null,
        businessName: user?.businessName ?? null,
      },
      points,
      week,
      pending: { count: pending, notice: pendingNotice(pending) },
    });
  });

  router.get('/days', requireSession, async (c) => {
    const today = businessDayOf(now());
    const fromQuery = c.req.query('from');
    const toQuery = c.req.query('to');
    if ((fromQuery && !isIsoDate(fromQuery)) || (toQuery && !isIsoDate(toQuery))) {
      return c.json({ error: 'invalid_day', message: 'Esa fecha no es válida.' }, 400);
    }
    const from = fromQuery ?? weekStart(toQuery ?? today);
    const to = toQuery ?? (fromQuery ? addDays(fromQuery, 6) : today);
    if (from > to || daysBetween(from, to) + 1 > MAX_DAYS_RANGE) {
      return c.json({ error: 'invalid_range', message: 'Elige un periodo más corto.' }, 400);
    }
    const days = await listDays(db, c.var.session.userId, { from, to }, now());
    const isWeek = from === weekStart(from) && to === addDays(from, 6);
    return c.json({ from, to, label: isWeek ? weekLabel(from, to) : null, days });
  });

  router.get('/days/:date/entries', requireSession, async (c) => {
    const date = c.req.param('date');
    const at = now();
    const today = businessDayOf(at);
    if (!isIsoDate(date) || date > today) {
      return c.json({ error: 'invalid_day', message: 'Esa fecha no es válida.' }, 400);
    }
    const result = await getDayEntries(db, c.var.session.userId, date, at);
    return c.json({ ...result, canAddEntries: date < today });
  });

  router.patch('/entries/:id', requireSession, requireRecentPin, jsonBodyLimit, async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return notFound(c);
    const body = await readJson(c, patchBody);
    if (!body.ok) return body.response;
    try {
      const { entry, replaced } = await correctEntry(db, {
        userId: c.var.session.userId,
        entryId: id,
        patch: body.data,
        actor: WEB_USER,
        now: now(),
        reason: 'web_correction',
      });
      return c.json({ entry: toEntryView(entry), replacedEntryId: replaced.id });
    } catch (err) {
      return ledgerErrorResponse(c, err);
    }
  });

  router.post('/entries/:id/void', requireSession, requireRecentPin, async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return notFound(c);
    try {
      const entry = await voidEntry(db, {
        userId: c.var.session.userId,
        entryId: id,
        actor: WEB_USER,
        now: now(),
        reason: 'web_void',
      });
      return c.json({ entry: toEntryView(entry) });
    } catch (err) {
      return ledgerErrorResponse(c, err);
    }
  });

  router.post('/entries', requireSession, requireRecentPin, jsonBodyLimit, async (c) => {
    const body = await readJson(c, addBody);
    if (!body.ok) return body.response;
    try {
      const entry = await addPastDayEntry(db, {
        userId: c.var.session.userId,
        ...body.data,
        counterparty: body.data.counterparty ?? null,
        actor: WEB_USER,
        now: now(),
      });
      return c.json({ entry: toEntryView(entry) }, 201);
    } catch (err) {
      return ledgerErrorResponse(c, err);
    }
  });

  router.get('/entries/:id/history', requireSession, async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return notFound(c);
    const history = await getEntryHistory(db, c.var.session.userId, id);
    return history ? c.json(history) : notFound(c);
  });

  router.get('/pending', requireSession, async (c) => {
    const items = await listPending(db, c.var.session.userId);
    return c.json({ count: items.length, notice: pendingNotice(items.length), items });
  });

  // Not 🔒 in 10.4: Pendientes are «resolubles con toques» from a PIN-verified device.
  router.post('/pending/:id/resolve', requireSession, jsonBodyLimit, async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return notFound(c);
    const body = await readJson(c, resolveBody);
    if (!body.ok) return body.response;
    const { userId } = c.var.session;
    try {
      const result = await resolveClarification(db, {
        userId,
        clarificationId: id,
        resolution: body.data,
        actor: WEB_USER,
        now: now(),
      });
      const remaining = await countPending(deps, userId);
      return c.json({
        outcome: result.outcome,
        entry: result.entry ? toEntryView(result.entry) : null,
        pending: { count: remaining, notice: pendingNotice(remaining) },
      });
    } catch (err) {
      return ledgerErrorResponse(c, err);
    }
  });
}
