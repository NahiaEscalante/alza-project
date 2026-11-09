/**
 * Entry point: HTTP server + pg-boss + message worker + the conversational flows (onboarding,
 * exceptions, daily close) + the scheduled tasks of 8.4, with graceful shutdown on SIGINT/SIGTERM.
 * Run migrations first (`npm run db:migrate`).
 *
 * One channel, one AI layer and one tesseract worker per process (D33): everything below shares
 * them, the web chat included.
 */
import { existsSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { ensureRewardsCatalog } from './account/index.js';
import { createAiLayer, createClients, defaultRoutes } from './ai/index.js';
import {
  type Channel,
  ChannelError,
  SIMULATOR_APP_SECRET,
  SimulatorChannel,
  SimulatorStore,
} from './channel/index.js';
import { ConfigError, getConfig } from './config.js';
import { createDb, createPool } from './db/client.js';
import { type CloseFlowDeps, createCloseHooks, registerCloseJobs } from './flows/close/index.js';
import { withFlowHooks } from './flows/hooks.js';
import { createOnboardingHooks, type FlowDeps } from './flows/onboarding/index.js';
import { broadcastTechnicalIssue } from './flows/requests/index.js';
import { createApp } from './http/app.js';
import { registerScheduledJobs } from './jobs/index.js';
import { createLogger } from './lib/logger.js';
import { createTesseractEngine } from './ocr/engine.js';
import { loadDotEnv, WEB_DIST_DIR } from './paths.js';
import {
  createInboundQueue,
  createScreenshotReader,
  type PipelineDeps,
  startInboundWorker,
} from './pipeline/index.js';
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

/** Until Fase 10 the only real transport is the simulator (D46). */
function unavailableChannel(): Channel {
  const fail = async (): Promise<never> => {
    throw new ChannelError('unavailable', 'no WhatsApp channel configured');
  };
  return {
    kind: 'meta',
    markAsRead: async () => undefined,
    sendText: fail,
    sendButtons: fail,
    sendImage: fail,
    uploadMedia: fail,
    downloadMedia: fail,
  };
}

const storage = new PostgresBlobStorage(db, config.encryptionKey);
const ai = createAiLayer({ routes: defaultRoutes(createClients(config)), logger });
// One tesseract worker per process (D33), closed on shutdown.
const ocr = await createTesseractEngine();
const simulatorStore = config.simulatorEnabled ? new SimulatorStore() : null;
const channel: Channel = simulatorStore
  ? new SimulatorChannel({ db, store: simulatorStore })
  : unavailableChannel();
const now = () => new Date();

// --- Flows (Fases 4–5) and scheduled tasks (Fase 6, 8.4) -----------------------------------------
const flowDeps: FlowDeps = { db, channel, storage, logger, appBaseUrl: config.appBaseUrl, now };
const closeDeps: CloseFlowDeps = { db, logger, channel, ai, now, baseUrl: config.appBaseUrl };
const hooks = withFlowHooks({ ...createOnboardingHooks(flowDeps), ...createCloseHooks(closeDeps) });

await registerCloseJobs(boss, closeDeps);
const scheduledJobs = await registerScheduledJobs(boss, { db, storage, logger, now });
logger.info({ jobs: [...scheduledJobs.names, 'close-sender'] }, 'scheduled jobs registered');

const queue = await createInboundQueue(boss);
const pipeline: PipelineDeps = {
  db,
  logger,
  storage,
  channel,
  ai,
  readScreenshot: createScreenshotReader({ ocr, ai, logger }),
  hooks,
  now,
};
await startInboundWorker(boss, pipeline);
logger.info({ channel: channel.kind }, 'message worker started');

const appSecret =
  config.whatsapp?.appSecret ?? (config.simulatorEnabled ? SIMULATOR_APP_SECRET : null);
const app = createApp({
  db,
  logger,
  webDistDir: serveWeb ? WEB_DIST_DIR : null,
  api: { storage, reportStorage: storage, chat: { ai: () => ai, logger } },
  webhook: {
    receive: { db, logger, channel, queue, now },
    logger,
    appSecret,
    verifyToken: config.whatsapp?.verifyToken ?? null,
  },
  simulator: simulatorStore
    ? { db, store: simulatorStore, now, runJobNow: scheduledJobs.runJobNow }
    : null,
  admin: {
    queue,
    jobs: scheduledJobs,
    broadcastTechnicalIssue: (incident) => broadcastTechnicalIssue(flowDeps, incident),
  },
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
    // New requests stop first; pg-boss then lets the running jobs (messages, closes, the 12:00
    // run) finish before the OCR worker and the pool they use are closed.
    await new Promise<void>((resolve) => server.close(() => resolve()));
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
