/**
 * WhatsApp webhook (RF-IN-01..03, 10.1, 14.5), mounted at `/webhook`:
 *
 * - `GET /webhook/whatsapp`: Meta's verification challenge (`hub.verify_token`).
 * - `POST /webhook/whatsapp`: checks `X-Hub-Signature-256` over the raw body, stores each message
 *   once, enqueues it and marks it as read, then answers 200 well under 2 s. Processing happens
 *   in the worker.
 *
 * The signing secret is `WHATSAPP_APP_SECRET`; without it, and only while the simulator is
 * enabled, the simulator's development secret (the simulator signs its payloads with it). With
 * neither, the webhook answers 503. An invalid signature is rejected (401) and logged, without
 * the body.
 */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { isValidSignature, parseWebhookPayload, SIGNATURE_HEADER } from '../../channel/index.js';
import type { Logger } from '../../lib/logger.js';
import type { ReceiveDeps } from '../../pipeline/deps.js';
import { markAsReadQuietly, receiveMessage } from '../../pipeline/receive.js';

export interface WebhookRouterDeps {
  receive: ReceiveDeps;
  logger: Logger;
  /** HMAC secret; null disables the webhook (503). */
  appSecret: string | null;
  /** `hub.verify_token` expected by `GET`; null rejects every verification. */
  verifyToken: string | null;
}

/** Meta payloads are small; this also caps what an unsigned request can make us hash. */
const MAX_BODY_BYTES = 256 * 1024;

export function createWebhookRouter(deps: WebhookRouterDeps): Hono {
  const router = new Hono();
  const { logger } = deps;

  router.get('/whatsapp', (c) => {
    const mode = c.req.query('hub.mode');
    const token = c.req.query('hub.verify_token');
    const challenge = c.req.query('hub.challenge') ?? '';
    if (mode === 'subscribe' && deps.verifyToken !== null && token === deps.verifyToken) {
      return c.text(challenge, 200);
    }
    logger.warn({ route: 'webhook_verify' }, 'webhook verification rejected');
    return c.text('forbidden', 403);
  });

  router.post(
    '/whatsapp',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json({ error: 'payload_too_large' }, 413),
    }),
    async (c) => {
      if (deps.appSecret === null) return c.json({ error: 'webhook_not_configured' }, 503);
      const raw = await c.req.text();
      if (!isValidSignature(raw, c.req.header(SIGNATURE_HEADER), deps.appSecret)) {
        logger.warn({ route: 'webhook' }, 'webhook signature invalid');
        return c.json({ error: 'invalid_signature' }, 401);
      }
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        return c.json({ error: 'invalid_json' }, 400);
      }
      const now = deps.receive.now();
      const parsed = parseWebhookPayload(body, now);
      if (!parsed) return c.json({ error: 'invalid_payload' }, 400);

      let accepted = 0;
      let duplicates = 0;
      for (const message of parsed.messages) {
        const result = await receiveMessage(deps.receive, message);
        if (result.outcome === 'duplicate') duplicates += 1;
        else accepted += 1;
      }
      // Stickers, reactions… are not processed but still get their blue ticks (D04).
      for (const id of parsed.ignoredIds) await markAsReadQuietly(deps.receive, id);
      if (parsed.messages.length + parsed.ignored > 0) {
        logger.debug({ accepted, duplicates, ignored: parsed.ignored }, 'webhook handled');
      }
      return c.json({ ok: true });
    },
  );

  return router;
}
