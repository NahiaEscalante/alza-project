import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { sql } from 'drizzle-orm';
import { Hono, type MiddlewareHandler } from 'hono';
import { compress } from 'hono/compress';
import { routePath } from 'hono/route';
import { secureHeaders } from 'hono/secure-headers';
import type { Db } from '../db/client.js';
import type { Logger } from '../lib/logger.js';
import { createApiRouter } from './api.js';

export interface AppDeps {
  db: Db;
  logger: Logger;
  /** Absolute path of the built web app (`web/dist`). When set, it is served with SPA fallback. */
  webDistDir?: string | null;
  /** Max wait for the database ping in /health. */
  healthTimeoutMs?: number;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.use(secureHeaders());
  app.use(requestLogger(deps.logger));
  // RNF-06 (3G): gzip text responses over 1 KB, e.g. the JS bundle (~230 KB → ~75 KB).
  app.use(compress());

  app.get('/health', async (c) => {
    const dbOk = await pingDb(deps.db, deps.healthTimeoutMs ?? 2_000);
    c.header('Cache-Control', 'no-store');
    return c.json({ status: dbOk ? 'ok' : 'error', db: dbOk ? 'ok' : 'error' }, dbOk ? 200 : 503);
  });

  app.route('/api', createApiRouter());

  if (deps.webDistDir) mountWeb(app, deps.webDistDir);

  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  app.onError((err, c) => {
    deps.logger.error({ err, route: routePath(c) }, 'unhandled error');
    return c.json({ error: 'internal_error' }, 500);
  });

  return app;
}

async function pingDb(db: Db, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const ping = db.execute(sql`select 1`).then(
    () => true,
    () => false,
  );
  try {
    return await Promise.race([ping, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Logs the matched route pattern (`/a/:token`), never the raw path or query: links carry tokens
 * (RNF-09).
 */
function requestLogger(logger: Logger): MiddlewareHandler {
  return async (c, next) => {
    const started = performance.now();
    await next();
    const entry = {
      method: c.req.method,
      // After next(), routeIndex points at the handler that answered.
      route: routePath(c),
      status: c.res.status,
      ms: Math.round(performance.now() - started),
    };
    const quiet = entry.route === '/health' || entry.route === '/assets/*';
    if (quiet && c.res.status < 500) logger.debug(entry, 'request');
    else logger.info(entry, 'request');
  };
}

/** Production: serves `web/dist`; unknown GET paths get index.html so wouter handles them. */
function mountWeb(app: Hono, distDir: string): void {
  const indexHtml = readFileSync(join(distDir, 'index.html'), 'utf8');

  app.use('/assets/*', async (c, next) => {
    await next();
    if (c.res.status === 200) {
      c.res.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    }
  });
  app.use('*', serveStatic({ root: distDir }));
  app.get('*', (c) => {
    if (c.req.path.startsWith('/assets/')) return c.notFound();
    c.header('Cache-Control', 'no-cache');
    return c.html(indexHtml);
  });
}
