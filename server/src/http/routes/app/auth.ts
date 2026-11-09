/**
 * `/api/auth/*` (10.4, 14.3). Every route is rate limited per IP; PIN checks also per user.
 *
 * | Route                    | Body                         | Answer                                     |
 * |--------------------------|------------------------------|--------------------------------------------|
 * | POST /auth/activate      | { token }                    | { status: 'ok', hasPin } · 410 link_*      |
 * | POST /auth/pin           | { pin, pinConfirmation }     | { status: 'ok' } · 400 too_easy/mismatch…  |
 * | POST /auth/enter         | { token }                    | { status: 'ok' | 'pin_required' | 'activation_required' } |
 * | POST /auth/pin/verify    | { pin }                      | { status: 'ok', pinValidUntil } · 422/423  |
 * | POST /auth/logout-all 🔒 | {}                           | { status: 'ok' }                           |
 * | GET  /auth/session       |                              | { authenticated, pinFresh, pinValidUntil } |
 */
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import {
  ACCESS_COOKIE,
  ACTIVATION_COOKIE,
  AUTH_MESSAGES,
  type AuthEnv,
  checkActivationLink,
  clearCookie,
  clientIp,
  createPin,
  createRateLimiter,
  DEVICE_COOKIE,
  enterWithAccessLink,
  findSession,
  isPinFormat,
  lockedMessage,
  logoutAllDevices,
  PENDING_LOGIN_MAX_MS,
  readCookie,
  resolvePinIdentity,
  setAuthFlowCookie,
  setDeviceCookie,
  verifyPin,
  wrongPinMessage,
} from '../../../auth/index.js';
import { isPinFresh, PIN_ERROR_MESSAGES, PIN_SESSION_MS } from '../../../domain/index.js';
import type { RouteDeps } from './deps.js';
import { jsonBodyLimit, readJson } from './http.js';

const tokenBody = z.object({ token: z.string().max(200) });
const pinBody = z.object({ pin: z.string().max(20), pinConfirmation: z.string().max(20) });
const verifyBody = z.object({ pin: z.string().max(20) });

function rateLimited(c: Context, retryAfterSec: number): Response {
  c.header('Retry-After', String(retryAfterSec));
  return c.json({ error: 'rate_limited', message: AUTH_MESSAGES.rate_limited }, 429);
}

export function registerAuthRoutes(router: Hono<AuthEnv>, deps: RouteDeps): void {
  const { db, now, cookies } = deps;
  const ipLimiter = createRateLimiter(deps.rateLimits.perIp);
  const userLimiter = createRateLimiter(deps.rateLimits.perUser);

  router.use('/auth/*', async (c, next) => {
    const limited = ipLimiter.hit(clientIp(c), now().getTime());
    if (!limited.ok) return rateLimited(c, limited.retryAfterSec);
    await next();
  });

  const session = (c: Context) => findSession(db, readCookie(c, DEVICE_COOKIE), now());

  router.post('/auth/activate', jsonBodyLimit, async (c) => {
    const body = await readJson(c, tokenBody);
    if (!body.ok) return body.response;
    const at = now();
    const result = await checkActivationLink(db, body.data.token, at);
    if (!result.ok)
      return c.json({ error: result.error, message: AUTH_MESSAGES[result.error] }, 410);
    setAuthFlowCookie(c, ACTIVATION_COOKIE, body.data.token, result.expiresAt, at, cookies);
    return c.json({ status: 'ok', hasPin: result.hasPin, expiresAt: result.expiresAt });
  });

  router.post('/auth/pin', jsonBodyLimit, async (c) => {
    const body = await readJson(c, pinBody);
    if (!body.ok) return body.response;
    const at = now();
    const current = await session(c);
    const result = await createPin(deps, {
      activationToken: readCookie(c, ACTIVATION_COOKIE),
      session: current,
      pin: body.data.pin,
      confirmation: body.data.pinConfirmation,
      now: at,
    });
    if (!result.ok) {
      switch (result.error) {
        case 'invalid_format':
        case 'mismatch':
        case 'too_easy':
          return c.json({ error: result.error, message: PIN_ERROR_MESSAGES[result.error] }, 400);
        case 'link_invalid':
        case 'link_expired':
        case 'link_used':
          clearCookie(c, ACTIVATION_COOKIE, '/api/auth', cookies);
          return c.json({ error: result.error, message: AUTH_MESSAGES[result.error] }, 410);
        case 'activation_required':
          return current
            ? c.json({ error: 'pin_required', message: AUTH_MESSAGES.pin_required }, 403)
            : c.json({ error: 'activation_required', message: AUTH_MESSAGES.link_invalid }, 401);
      }
    }
    clearCookie(c, ACTIVATION_COOKIE, '/api/auth', cookies);
    if (result.device) {
      setDeviceCookie(c, result.device.cookie, result.device.rememberedUntil, at, cookies);
    }
    return c.json({ status: 'ok', pinValidUntil: new Date(at.getTime() + PIN_SESSION_MS) });
  });

  router.post('/auth/enter', jsonBodyLimit, async (c) => {
    const body = await readJson(c, tokenBody);
    if (!body.ok) return body.response;
    const at = now();
    const result = await enterWithAccessLink(db, {
      token: body.data.token,
      session: await session(c),
      now: at,
    });
    switch (result.status) {
      case 'ok':
        return c.json({ status: 'ok' });
      case 'pin_required': {
        const expires = new Date(
          Math.min(result.linkExpiresAt.getTime(), at.getTime() + PENDING_LOGIN_MAX_MS),
        );
        setAuthFlowCookie(c, ACCESS_COOKIE, body.data.token, expires, at, cookies);
        return c.json({ status: 'pin_required' });
      }
      case 'activation_required':
        return c.json({
          status: 'activation_required',
          reason: result.reason,
          message: AUTH_MESSAGES[result.reason],
        });
      default:
        return c.json({ error: result.status, message: AUTH_MESSAGES[result.status] }, 410);
    }
  });

  router.post('/auth/pin/verify', jsonBodyLimit, async (c) => {
    const body = await readJson(c, verifyBody);
    if (!body.ok) return body.response;
    if (!isPinFormat(body.data.pin)) {
      return c.json({ error: 'invalid_format', message: AUTH_MESSAGES.invalid_pin_format }, 400);
    }
    const at = now();
    const identity = await resolvePinIdentity(db, {
      accessToken: readCookie(c, ACCESS_COOKIE),
      session: await session(c),
      now: at,
    });
    if (!identity) {
      return c.json({ error: 'unauthorized', message: AUTH_MESSAGES.unauthorized }, 401);
    }
    const limited = userLimiter.hit(identity.userId, at.getTime());
    if (!limited.ok) return rateLimited(c, limited.retryAfterSec);

    const result = await verifyPin(deps, { identity, pin: body.data.pin, now: at });
    if (!result.ok) {
      switch (result.error) {
        case 'wrong_pin':
          return c.json(
            {
              error: 'wrong_pin',
              attemptsLeft: result.attemptsLeft,
              message: wrongPinMessage(result.attemptsLeft),
            },
            422,
          );
        case 'locked':
          return c.json(
            {
              error: 'locked',
              lockedUntil: result.until,
              message: lockedMessage(result.until, result.justLocked),
            },
            423,
          );
        case 'activation_required':
          clearCookie(c, ACCESS_COOKIE, '/api/auth', cookies);
          return c.json(
            {
              error: 'activation_required',
              reason: result.reason,
              message: AUTH_MESSAGES[result.reason],
            },
            403,
          );
      }
    }
    if (result.device) {
      setDeviceCookie(c, result.device.cookie, result.device.rememberedUntil, at, cookies);
      clearCookie(c, ACCESS_COOKIE, '/api/auth', cookies);
    }
    return c.json({ status: 'ok', pinValidUntil: result.pinValidUntil });
  });

  router.post('/auth/logout-all', deps.requireSession, deps.requireRecentPin, async (c) => {
    await logoutAllDevices(db, c.var.session.userId);
    clearCookie(c, DEVICE_COOKIE, '/api', cookies);
    return c.json({ status: 'ok', message: AUTH_MESSAGES.logged_out_all });
  });

  router.get('/auth/session', async (c) => {
    const at = now();
    const current = await session(c);
    if (!current) return c.json({ authenticated: false, pinFresh: false, pinValidUntil: null });
    const pinFresh = isPinFresh(current.pinVerifiedAt, at);
    return c.json({
      authenticated: true,
      pinFresh,
      pinValidUntil:
        pinFresh && current.pinVerifiedAt
          ? new Date(current.pinVerifiedAt.getTime() + PIN_SESSION_MS)
          : null,
    });
  });
}
