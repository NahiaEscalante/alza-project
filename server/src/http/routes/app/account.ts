/**
 * Premios, Ajustes and account deletion (10.4, 13.3, RF-WP-05/09/10, RF-PV-01). 🔒 = PIN in the
 * last 10 minutes.
 *
 * | Route                    | Body                                              |
 * |--------------------------|---------------------------------------------------|
 * | GET  /rewards            |                                                   |
 * | POST /redemptions 🔒     | { rewardId }                                      |
 * | GET  /settings           |                                                   |
 * | PATCH /settings 🔒       | { summaryImage?, additionalHolders?: string[] }   |
 * | POST /account/delete 🔒  | { confirm: true }                                 |
 */
import type { Hono } from 'hono';
import { z } from 'zod';
import {
  ACCOUNT_DELETED_TEXT,
  deleteAccount,
  getRewardsView,
  getSettings,
  redeemReward,
  SettingsError,
  updateSettings,
} from '../../../account/index.js';
import { type AuthEnv, clearCookie, DEVICE_COOKIE } from '../../../auth/index.js';
import type { RouteDeps } from './deps.js';
import { isUuid, jsonBodyLimit, notFound, readJson } from './http.js';

const redeemBody = z.object({ rewardId: z.string() });
const settingsBody = z
  .object({
    summaryImage: z.boolean().optional(),
    additionalHolders: z.array(z.string().max(200)).max(10).optional(),
  })
  .refine((body) => body.summaryImage !== undefined || body.additionalHolders !== undefined);
const deleteBody = z.object({ confirm: z.literal(true) });

const REDEEM_STATUS = {
  not_found: 404,
  pin_required: 403,
  insufficient_points: 409,
  needs_active_weeks: 409,
} as const;

export function registerAccountRoutes(router: Hono<AuthEnv>, deps: RouteDeps): void {
  const { db, now, requireSession, requireRecentPin } = deps;

  router.get('/rewards', requireSession, async (c) => {
    return c.json(await getRewardsView(db, c.var.session.userId));
  });

  router.post('/redemptions', requireSession, requireRecentPin, jsonBodyLimit, async (c) => {
    const body = await readJson(c, redeemBody);
    if (!body.ok) return body.response;
    if (!isUuid(body.data.rewardId)) return notFound(c);
    const result = await redeemReward(db, {
      userId: c.var.session.userId,
      rewardId: body.data.rewardId,
      pinVerifiedAt: c.var.session.pinVerifiedAt,
      now: now(),
    });
    if (!result.ok) {
      const { ok: _ok, ...error } = result;
      return c.json(error, REDEEM_STATUS[result.error]);
    }
    return c.json(
      { redemption: result.redemption, balance: result.balance, message: result.message },
      201,
    );
  });

  router.get('/settings', requireSession, async (c) => {
    const settings = await getSettings(db, c.var.session.userId);
    return settings ? c.json(settings) : notFound(c);
  });

  router.patch('/settings', requireSession, requireRecentPin, jsonBodyLimit, async (c) => {
    const body = await readJson(c, settingsBody);
    if (!body.ok) return body.response;
    try {
      return c.json(await updateSettings(db, c.var.session.userId, body.data));
    } catch (err) {
      if (err instanceof SettingsError) {
        return c.json({ error: err.code, message: err.message }, 400);
      }
      throw err;
    }
  });

  router.post('/account/delete', requireSession, requireRecentPin, jsonBodyLimit, async (c) => {
    const body = await readJson(c, deleteBody);
    if (!body.ok) return body.response;
    await deleteAccount({ db, storage: deps.storage() }, c.var.session.userId, { now: now() });
    clearCookie(c, DEVICE_COOKIE, '/api', deps.cookies);
    return c.json({ status: 'deleted', message: ACCOUNT_DELETED_TEXT });
  });
}
