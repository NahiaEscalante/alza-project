/** Sandbox has no documented Meta signature; authenticate a dedicated, secret callback path. */
import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { parseWebhookPayload } from '../../channel/meta-payload.js';
import type { Logger } from '../../lib/logger.js';
import type { ReceiveDeps } from '../../pipeline/deps.js';
import { receiveMessage } from '../../pipeline/receive.js';

export interface Dialog360WebhookDeps {
  receive: ReceiveDeps;
  logger: Logger;
  webhookToken: string;
}

export function createDialog360WebhookRouter(deps: Dialog360WebhookDeps): Hono {
  const router = new Hono();
  router.post('/dialog360/:token', bodyLimit({ maxSize: 256 * 1024 }), async (c) => {
    c.header('Cache-Control', 'no-store');
    const supplied = Buffer.from(c.req.param('token'));
    const expected = Buffer.from(deps.webhookToken);
    if (
      !expected.length ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }
    const parsed = parseWebhookPayload(body, deps.receive.now());
    if (!parsed) return c.json({ error: 'invalid_payload' }, 400);
    // Never fabricate phone numbers for BSUID-only messages: this MVP uses E.164 accounts.
    const payload = body as {
      entry?: {
        changes?: { value?: { messages?: { from_user_id?: string; from?: string }[] } }[];
      }[];
    };
    const bsuidOnly = payload.entry?.some((entry) =>
      entry.changes?.some((change) =>
        change.value?.messages?.some((message) => message?.from_user_id && !message.from),
      ),
    );
    if (bsuidOnly) {
      deps.logger.warn({ route: 'dialog360' }, 'sandbox requires a phone-number account');
      return c.json({ error: 'phone_number_required' }, 422);
    }
    const statusPayload = z
      .object({
        entry: z.array(
          z.object({
            changes: z.array(
              z.object({
                value: z
                  .object({
                    statuses: z
                      .array(
                        z.object({
                          id: z.string().max(256),
                          status: z.enum(['sent', 'delivered', 'read', 'failed']),
                          errors: z.array(z.object({ code: z.number().int() })).optional(),
                        }),
                      )
                      .optional(),
                  })
                  .optional(),
              }),
            ),
          }),
        ),
      })
      .safeParse(body);
    if (statusPayload.success) {
      for (const entry of statusPayload.data.entry)
        for (const change of entry.changes) {
          for (const status of change.value?.statuses ?? []) {
            const event = {
              waMessageId: status.id,
              status: status.status,
              errorCodes: status.errors?.map((error) => error.code) ?? [],
            };
            if (status.status === 'failed') deps.logger.warn(event, '360dialog delivery failed');
            else deps.logger.info(event, '360dialog delivery status');
          }
        }
    }
    for (const message of parsed.messages) await receiveMessage(deps.receive, message);
    return c.json({ ok: true });
  });
  return router;
}
