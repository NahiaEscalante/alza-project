/**
 * Local long polling (D71, `TELEGRAM_POLLING=true`, never in production): the same handler as
 * `POST /webhook/telegram`, fed by `getUpdates`, so the bot works without a public URL.
 *
 * A bot has either a webhook or polling. If a webhook is registered (for example the Railway
 * one), polling refuses to start instead of deleting it: removing it would silently disconnect
 * the deployed bot. Use a separate bot for development, or remove the webhook on purpose with
 * `npm run telegram:setup -w server -- --delete-webhook`.
 */
import type { Logger } from '../lib/logger.js';
import type { TelegramBotApi, TelegramUpdate } from './telegram-api.js';
import { ChannelError } from './types.js';

const POLL_TIMEOUT_S = 25;
const MAX_BACKOFF_MS = 30_000;
/** Attempts per update before it is skipped (the webhook would get Telegram's redelivery). */
const ATTEMPTS_PER_UPDATE = 3;

export interface TelegramPollingDeps {
  api: Pick<TelegramBotApi, 'getWebhookInfo' | 'deleteWebhook' | 'getUpdates'>;
  logger: Logger;
  handle: (update: TelegramUpdate) => Promise<unknown>;
  /** Abortable wait (tests pass a fast one). */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export interface TelegramPoller {
  /** Resolves when the loop has stopped (after the current request is aborted). */
  stop(): Promise<void>;
  /** The loop itself; resolves when it ends. */
  done: Promise<void>;
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

const codeOf = (err: unknown) => (err instanceof ChannelError ? err.code : 'unknown');

export function startTelegramPolling(deps: TelegramPollingDeps): TelegramPoller {
  const controller = new AbortController();
  const { signal } = controller;
  const sleep = deps.sleep ?? abortableSleep;
  const { logger } = deps;

  async function handleWithRetries(update: TelegramUpdate): Promise<void> {
    for (let attempt = 1; attempt <= ATTEMPTS_PER_UPDATE; attempt++) {
      try {
        await deps.handle(update);
        return;
      } catch (err) {
        logger.warn({ err, updateId: update.update_id, attempt }, 'telegram update failed');
        if (attempt < ATTEMPTS_PER_UPDATE) await sleep(1_000 * attempt, signal);
        if (signal.aborted) return;
      }
    }
    logger.error({ updateId: update.update_id }, 'telegram update skipped after retries');
  }

  const done = (async () => {
    try {
      const info = await deps.api.getWebhookInfo();
      if (info.url !== '') {
        logger.error(
          'telegram polling not started: this bot has a webhook (see docs/ALZA_TELEGRAM_SETUP.md)',
        );
        return;
      }
      await deps.api.deleteWebhook();
    } catch (err) {
      logger.error({ code: codeOf(err) }, 'telegram polling could not start');
      return;
    }
    logger.info('telegram polling started');
    let offset = 0;
    let failures = 0;
    while (!signal.aborted) {
      let updates: TelegramUpdate[];
      try {
        updates = await deps.api.getUpdates({ offset, timeoutS: POLL_TIMEOUT_S }, signal);
        failures = 0;
      } catch (err) {
        if (signal.aborted) break;
        failures += 1;
        logger.warn({ code: codeOf(err), failures }, 'telegram getUpdates failed');
        await sleep(Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** failures), signal);
        continue;
      }
      for (const update of updates) {
        if (signal.aborted) break;
        await handleWithRetries(update);
        offset = update.update_id + 1;
      }
    }
    logger.info('telegram polling stopped');
  })();

  return {
    done,
    stop: async () => {
      controller.abort();
      await done;
    },
  };
}
