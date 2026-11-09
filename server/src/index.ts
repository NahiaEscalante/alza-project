/**
 * Entry point: HTTP server + pg-boss, with graceful shutdown on SIGINT/SIGTERM.
 * Run migrations first (`npm run db:migrate`).
 */
import { existsSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { ConfigError, getConfig } from './config.js';
import { createDb, createPool } from './db/client.js';
import { createApp } from './http/app.js';
import { createLogger } from './lib/logger.js';
import { loadDotEnv, WEB_DIST_DIR } from './paths.js';
import { createBoss, startBoss, stopBoss } from './queue/boss.js';

loadDotEnv();

let config: ReturnType<typeof getConfig>;
try {
  config = getConfig();
} catch (err) {
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
}

const logger = createLogger({ level: config.logLevel, pretty: config.nodeEnv === 'development' });

const pool = createPool(config.databaseUrl, { logger });
const db = createDb(pool);
const boss = createBoss(config.databaseUrl, logger);

const serveWeb = config.nodeEnv === 'production' && existsSync(WEB_DIST_DIR);
if (config.nodeEnv === 'production' && !serveWeb) {
  logger.warn('web/dist not found: run `npm run build` to serve the web app');
}

await startBoss(boss);
logger.info('queue started');

const app = createApp({ db, logger, webDistDir: serveWeb ? WEB_DIST_DIR : null });
const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  logger.info({ port: info.port, env: config.nodeEnv, serveWeb }, 'http server listening');
});

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  const forceExit = setTimeout(() => {
    logger.error('shutdown timed out, forcing exit');
    process.exit(1);
  }, 15_000);
  forceExit.unref();
  try {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await stopBoss(boss);
    await pool.end();
    logger.info('shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'error during shutdown');
    process.exit(1);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
