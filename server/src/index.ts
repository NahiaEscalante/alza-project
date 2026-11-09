/**
 * Entry point: HTTP server + pg-boss + message worker, with graceful shutdown on SIGINT/SIGTERM.
 * Run migrations first (`npm run db:migrate`).
 */
import { existsSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { ensureRewardsCatalog } from './account/index.js';
import { createAiLayer, createClients, defaultRoutes } from './ai/index.js';
import { createChannelRuntime, startTelegramPolling } from './channel/index.js';
import { ConfigError, getConfig } from './config.js';
import { createDb, createPool } from './db/client.js';
import { createCloseHooks, registerCloseJobs } from './flows/close/index.js';
import { withFlowHooks } from './flows/hooks.js';
import { createOnboardingHooks } from './flows/onboarding/index.js';
import { broadcastTechnicalIssue } from './flows/requests/broadcast.js';
import { createApp } from './http/app.js';
import { registerScheduledJobs } from './jobs/index.js';
import { createLogger } from './lib/logger.js';
import { messagingAppOf } from './messages/catalog.js';
import { createTesseractEngine } from './ocr/engine.js';
import { loadDotEnv, WEB_DIST_DIR } from './paths.js';
import {
  createInboundQueue,
  createScreenshotReader,
  type PipelineDeps,
  startInboundWorker,
} from './pipeline/index.js';
import { handleTelegramUpdate, LinkPromptThrottle } from './pipeline/telegram-inbound.js';
import { createBoss, startBoss, stopBoss } from './queue/boss.js';
import { PostgresBlobStorage } from './storage/postgres-blob-storage.js';

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
await ensureRewardsCatalog(db);

const storage = new PostgresBlobStorage(db, config.encryptionKey);
const ai = createAiLayer({ routes: defaultRoutes(createClients(config)), logger });
// One tesseract worker per process (D33), closed on shutdown.
const ocr = await createTesseractEngine();
const {
  channel,
  store: simulatorStore,
  appSecret,
  verifyToken,
  telegram,
} = createChannelRuntime(db, config);
const now = () => new Date();
// D73, D74: Telegram texts and the demo consent version; WhatsApp otherwise (unchanged).
const messagingApp = messagingAppOf(channel.kind);

const queue = await createInboundQueue(boss);
const flowDeps = { db, logger, channel, storage, now, appBaseUrl: config.appBaseUrl, messagingApp };
const closeDeps = { db, logger, channel, ai, now, baseUrl: config.appBaseUrl, messagingApp };
const jobs = await registerScheduledJobs(boss, { db, logger, storage, now });
await registerCloseJobs(boss, closeDeps);
const pipeline: PipelineDeps = {
  db,
  logger,
  storage,
  channel,
  ai,
  readScreenshot: createScreenshotReader({
    ocr,
    ai,
    logger,
    visionFallback: config.aiVisionFallback,
  }),
  hooks: withFlowHooks({ ...createOnboardingHooks(flowDeps), ...createCloseHooks(closeDeps) }),
  now,
  messagingApp,
};
await startInboundWorker(boss, pipeline);
logger.info(
  { channel: channel.kind, visionFallback: config.aiVisionFallback },
  'message worker started',
);

// D71: Telegram updates enter through the webhook, or by long polling in development.
const telegramInbound =
  telegram && config.telegram
    ? {
        receive: { db, logger, channel, queue, now },
        telegram,
        logger,
        dailyInboundCap: config.telegram.dailyInboundCap,
        prompts: new LinkPromptThrottle(),
      }
    : null;
const telegramPoller =
  telegramInbound && config.telegram?.polling
    ? startTelegramPolling({
        api: telegramInbound.telegram.api,
        logger,
        handle: (update) => handleTelegramUpdate(telegramInbound, update),
      })
    : null;

const app = createApp({
  db,
  logger,
  webDistDir: serveWeb ? WEB_DIST_DIR : null,
  webApp: { now, storage, reportStorage: storage, chat: { ai: () => ai, logger } },
  admin: {
    logger,
    now,
    queue,
    jobs,
    broadcastTechnicalIssue: (incident) => broadcastTechnicalIssue(flowDeps, incident),
  },
  webhook: {
    receive: { db, logger, channel, queue, now },
    logger,
    appSecret,
    verifyToken,
  },
  dialog360Webhook:
    channel.kind === 'dialog360' && config.dialog360
      ? {
          receive: { db, logger, channel, queue, now },
          logger,
          webhookToken: config.dialog360.webhookToken,
        }
      : null,
  telegramWebhook:
    telegramInbound && config.telegram?.webhookSecret
      ? { ...telegramInbound, secret: config.telegram.webhookSecret }
      : null,
  simulator: simulatorStore ? { db, store: simulatorStore, now } : null,
});
const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  logger.info(
    { port: info.port, env: config.nodeEnv, serveWeb, simulator: simulatorStore !== null },
    'http server listening',
  );
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
    await telegramPoller?.stop();
    await stopBoss(boss);
    await ocr.close();
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
