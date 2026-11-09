/**
 * The user's web app API (spec 10.4, English paths, D32), mounted at `/api`. Reports are
 * Fase 8.
 *
 * Middleware is attached per path, never with `use('*')`: this router is merged into `/api`, and
 * a catch-all here would also run for `/api/waitlist` and the JSON 404.
 */
import { Hono } from 'hono';
import type { AuthEnv } from '../../../auth/index.js';
import { registerAccountRoutes } from './account.js';
import { registerAuthRoutes } from './auth.js';
import { registerChatRoutes } from './chat.js';
import { registerCounterpartyRuleRoutes } from './counterparty-rules.js';
import { resolveDeps, type WebAppRouterDeps } from './deps.js';
import { noStore } from './http.js';
import { registerLedgerRoutes } from './ledger.js';
import { registerReportRoutes } from './reports.js';

export type { WebAppRouterDeps } from './deps.js';

const PRIVATE_PATHS = [
  '/auth/*',
  '/home',
  '/days',
  '/days/*',
  '/entries',
  '/entries/*',
  '/pending',
  '/pending/*',
  '/rewards',
  '/redemptions',
  '/settings',
  '/account/*',
];

export function createWebAppRouter(options: WebAppRouterDeps): Hono<AuthEnv> {
  const deps = resolveDeps(options);
  const router = new Hono<AuthEnv>();
  for (const path of PRIVATE_PATHS) router.use(path, noStore);
  registerAuthRoutes(router, deps);
  registerLedgerRoutes(router, deps);
  registerAccountRoutes(router, deps);
  registerCounterpartyRuleRoutes(router, deps);
  registerReportRoutes(router, deps);
  registerChatRoutes(router, deps);
  return router;
}
