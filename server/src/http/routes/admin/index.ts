/**
 * `/api/admin/*`: the internal panel's API (Fase 8c, spec 5.12, 14.4). Its own accounts and
 * session cookie; every route but login and the session check needs a panel session. Answers are
 * never cached and carry ids, counts and masked phones only (RNF-09).
 */
import { Hono } from 'hono';
import { noStore } from '../app/http.js';
import { createRequireAdmin, registerAdminAuthRoutes } from './auth.js';
import { type AdminEnv, type AdminRouterOptions, resolveAdminDeps } from './deps.js';
import { registerAdminReviewRoutes } from './review.js';
import { registerAdminToolRoutes } from './tools.js';

export { ADMIN_COOKIE } from './auth.js';
export type { AdminRouterOptions } from './deps.js';

export function createAdminRouter(options: AdminRouterOptions): Hono<AdminEnv> {
  const deps = resolveAdminDeps(options);
  const router = new Hono<AdminEnv>();
  router.use('*', noStore);
  router.use('*', async (c, next) => {
    await next();
    c.res.headers.set('X-Robots-Tag', 'noindex');
  });
  const requireAdmin = createRequireAdmin(deps);
  registerAdminAuthRoutes(router, deps, requireAdmin);
  registerAdminReviewRoutes(router, deps, requireAdmin);
  registerAdminToolRoutes(router, deps, requireAdmin);
  // Unknown panel paths: 401 without a session (nothing to learn), JSON 404 with one.
  router.all('*', requireAdmin, (c) => c.json({ error: 'not_found' }, 404));
  return router;
}
