/**
 * `/api/admin/auth/*` (RF-AD-04, 14.4): one account per person, its own session cookie.
 *
 * | Route                 | Body                    | Answer                                     |
 * |-----------------------|-------------------------|--------------------------------------------|
 * | POST /auth/login      | { username, password }  | { admin } + Set-Cookie · 401 · 429         |
 * | POST /auth/logout 🔒  | {}                      | { status: 'ok' }                           |
 * | GET  /auth/session    |                         | { authenticated, admin? }                  |
 *
 * Cookie `alza_admin`: HttpOnly, SameSite=Strict, Path=/api/admin, Secure in production. Her
 * `alza_device` cookie is never read here, so a user session cannot open the panel. Mutations
 * only accept JSON bodies (with SameSite=Strict this closes cross-site posts).
 */
import type { Context, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { findActiveAdmin, normalizeUsername, recordAdminAction } from '../../../admin/index.js';
import { clientIp, createRateLimiter } from '../../../auth/index.js';
import { jsonBodyLimit, readJson } from '../app/http.js';
import { ADMIN_MESSAGES, type AdminEnv, type AdminRouteDeps, adminError } from './deps.js';

export const ADMIN_COOKIE = 'alza_admin';
const COOKIE_PATH = '/api/admin';

const loginBody = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
});

function rateLimited(c: Context, retryAfterSec: number): Response {
  c.header('Retry-After', String(retryAfterSec));
  return adminError(c, 429, 'rate_limited', ADMIN_MESSAGES.rate_limited);
}

/** 401 unless the request carries a live panel session of an active account. */
export function createRequireAdmin(deps: AdminRouteDeps) {
  return createMiddleware<AdminEnv>(async (c, next) => {
    const token = getCookie(c, ADMIN_COOKIE);
    const session = deps.sessions.find(token, deps.now());
    const admin = session ? await findActiveAdmin(deps.db, session.adminUserId) : null;
    if (!session || !admin || !token) {
      return adminError(c, 401, 'unauthorized', ADMIN_MESSAGES.unauthorized);
    }
    c.set('admin', admin);
    c.set('adminToken', token);
    await next();
  });
}

export function registerAdminAuthRoutes(
  router: Hono<AdminEnv>,
  deps: AdminRouteDeps,
  requireAdmin: ReturnType<typeof createRequireAdmin>,
): void {
  const ipLimiter = createRateLimiter(deps.rateLimits.perIp);
  const usernameLimiter = createRateLimiter(deps.rateLimits.perUsername);

  router.use('/auth/*', async (c, next) => {
    const limited = ipLimiter.hit(clientIp(c), deps.now().getTime());
    if (!limited.ok) return rateLimited(c, limited.retryAfterSec);
    await next();
  });

  router.post('/auth/login', jsonBodyLimit, async (c) => {
    const body = await readJson(c, loginBody);
    if (!body.ok) return body.response;
    const at = deps.now();
    const limited = usernameLimiter.hit(normalizeUsername(body.data.username), at.getTime());
    if (!limited.ok) return rateLimited(c, limited.retryAfterSec);

    const admin = await deps.verifyCredentials(body.data.username, body.data.password, at);
    if (!admin) {
      deps.logger.warn({ route: 'admin login' }, 'admin login failed');
      return adminError(c, 401, 'invalid_credentials', ADMIN_MESSAGES.invalid_credentials);
    }
    // A new login replaces the cookie of this browser.
    deps.sessions.revoke(getCookie(c, ADMIN_COOKIE));
    const session = deps.sessions.create(admin.id, at);
    setCookie(c, ADMIN_COOKIE, session.token, {
      httpOnly: true,
      secure: deps.secureCookies,
      sameSite: 'Strict',
      path: COOKIE_PATH,
      expires: session.expiresAt,
      maxAge: Math.max(1, Math.floor((session.expiresAt.getTime() - at.getTime()) / 1000)),
    });
    await recordAdminAction(deps.db, {
      adminUserId: admin.id,
      action: 'auth.login',
      targetType: 'admin_user',
      targetId: admin.id,
      at,
    });
    deps.logger.info({ adminUserId: admin.id }, 'admin login');
    return c.json({ admin });
  });

  router.post('/auth/logout', requireAdmin, jsonBodyLimit, async (c) => {
    const body = await readJson(c, z.object({}));
    if (!body.ok) return body.response;
    deps.sessions.revoke(c.var.adminToken);
    deleteCookie(c, ADMIN_COOKIE, {
      path: COOKIE_PATH,
      secure: deps.secureCookies,
      httpOnly: true,
      sameSite: 'Strict',
    });
    await recordAdminAction(deps.db, {
      adminUserId: c.var.admin.id,
      action: 'auth.logout',
      targetType: 'admin_user',
      targetId: c.var.admin.id,
      at: deps.now(),
    });
    return c.json({ status: 'ok' });
  });

  router.get('/auth/session', async (c) => {
    const session = deps.sessions.find(getCookie(c, ADMIN_COOKIE), deps.now());
    const admin = session ? await findActiveAdmin(deps.db, session.adminUserId) : null;
    return c.json(admin ? { authenticated: true, admin } : { authenticated: false });
  });
}
