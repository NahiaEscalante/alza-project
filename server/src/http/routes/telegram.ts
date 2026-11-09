/**
 * Telegram webhook (D71), mounted at `/webhook`: `POST /webhook/telegram`.
 *
 * Telegram signs nothing; `setWebhook` registers a `secret_token` that it sends back in
 * `X-Telegram-Bot-Api-Secret-Token` (`TELEGRAM_WEBHOOK_SECRET`). A missing or wrong secret is
 * rejected (401) before reading the update. Valid updates go through `handleTelegramUpdate`
 * (idempotent by message key); anything ALZA does not handle is acknowledged with 200 so
 * Telegram does not redeliver it. A failure (database down…) answers 500 and Telegram retries.
 */
import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { handleTelegramUpdate, type TelegramInboundDeps } from '../../pipeline/telegram-inbound.js';

export const TELEGRAM_SECRET_HEADER = 'x-telegram-bot-api-secret-token';

export interface TelegramWebhookDeps extends TelegramInboundDeps {
  secret: string;
}

/** Updates are small (no file bytes); this also caps what an unauthenticated request costs. */
const MAX_BODY_BYTES = 256 * 1024;

export function isValidTelegramSecret(given: string | undefined, expected: string): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createTelegramWebhookRouter(deps: TelegramWebhookDeps): Hono {
  const router = new Hono();
  router.post(
    '/telegram',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json({ error: 'payload_too_large' }, 413),
    }),
    async (c) => {
      c.header('Cache-Control', 'no-store');
      if (!isValidTelegramSecret(c.req.header(TELEGRAM_SECRET_HEADER), deps.secret)) {
        deps.logger.warn({ route: 'telegram_webhook' }, 'telegram webhook secret invalid');
        return c.json({ error: 'unauthorized' }, 401);
      }
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: 'invalid_json' }, 400);
      }
      await handleTelegramUpdate(deps, body);
      return c.json({ ok: true });
    },
  );
  return router;
}
