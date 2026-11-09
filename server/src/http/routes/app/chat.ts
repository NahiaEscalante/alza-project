/**
 * Web chat API (10.4, English paths per D32). Every route needs the session; the user always comes
 * from it (14.4), so another user's proposal answers 404. 🔒 = PIN verified in the last 10 minutes.
 *
 * | Route                               | Body          | Answer                                     |
 * |-------------------------------------|---------------|--------------------------------------------|
 * | POST /chat                          | { message }   | { reply, proposedAction, messages, limit } |
 * | GET  /chat/history                  |               | { messages, limit, suggestions }           |
 * | POST /chat/actions/:id/confirm 🔒   | {}            | { proposal, reply }                        |
 * | POST /chat/actions/:id/cancel       | {}            | { proposal, reply }                        |
 *
 * `POST /chat` errors: 429 `chat_limit` (PR06, with `limit`), 429 `chat_busy`, 503
 * `chat_unavailable` («No pude responder ahora»). Confirm/cancel: 409 `proposal_stale` /
 * `proposal_closed` with the updated `proposal`.
 */
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { type AiLayer, createAiLayer, createClients, defaultRoutes } from '../../../ai/index.js';
import { type AuthEnv, createRateLimiter } from '../../../auth/index.js';
import {
  answerProposal,
  CHAT_MAX_MESSAGE_CHARS,
  CHAT_TEXTS,
  getChatHistory,
  sendChatMessage,
} from '../../../chat/index.js';
import { getConfig } from '../../../config.js';
import { createLogger, type Logger } from '../../../lib/logger.js';
import type { RouteDeps } from './deps.js';
import { isUuid, jsonBodyLimit, noStore, readJson } from './http.js';

export interface ChatRouteOptions {
  /** The AI layer (tests pass a fake). Default: Groq ↔ Gemini from the config, built lazily. */
  ai?: () => Pick<AiLayer, 'chat'> | null;
  logger?: Logger;
}

const messageBody = z.object({ message: z.string().trim().min(1).max(CHAT_MAX_MESSAGE_CHARS) });

/** Bursts per user, failed turns included (PR06 only counts stored messages). */
const CHAT_REQUESTS_PER_10_MIN = 60;

let defaultLayer: { ai: AiLayer; logger: Logger } | undefined;

/** Built on first use: the router is also created in tests without AI keys. */
function defaultChat(): { ai: AiLayer; logger: Logger } {
  if (!defaultLayer) {
    const config = getConfig();
    const logger = createLogger({
      level: config.logLevel,
      pretty: config.nodeEnv === 'development',
    });
    defaultLayer = {
      ai: createAiLayer({ routes: defaultRoutes(createClients(config)), logger }),
      logger,
    };
  }
  return defaultLayer;
}

export function registerChatRoutes(
  router: Hono<AuthEnv>,
  deps: RouteDeps,
  options: ChatRouteOptions = {},
): void {
  const { db, now, requireSession, requireRecentPin } = deps;
  const ai = options.ai ?? (() => defaultChat().ai);
  const logger = () => options.logger ?? (options.ai ? undefined : defaultChat().logger);
  const limiter = createRateLimiter({ limit: CHAT_REQUESTS_PER_10_MIN, windowMs: 10 * 60_000 });

  router.use('/chat', noStore);
  router.use('/chat/*', noStore);

  router.post('/chat', requireSession, jsonBodyLimit, async (c) => {
    const body = await readJson(c, messageBody);
    if (!body.ok) return body.response;
    const { userId } = c.var.session;
    const hit = limiter.hit(userId, now().getTime());
    if (!hit.ok) {
      c.header('Retry-After', String(hit.retryAfterSec));
      return c.json({ error: 'chat_busy', message: CHAT_TEXTS.busy }, 429);
    }
    const result = await sendChatMessage(
      { db, ai: ai(), logger: logger() },
      { userId, message: body.data.message, now },
    );
    if (!result.ok) {
      if (result.code === 'limit') {
        return c.json({ error: 'chat_limit', message: result.message, limit: result.limit }, 429);
      }
      if (result.code === 'busy')
        return c.json({ error: 'chat_busy', message: result.message }, 429);
      return c.json({ error: 'chat_unavailable', message: result.message }, 503);
    }
    return c.json({
      reply: result.reply.content,
      proposedAction: result.proposedAction,
      messages: [result.message, result.reply],
      limit: result.limit,
    });
  });

  router.get('/chat/history', requireSession, async (c) => {
    return c.json(await getChatHistory(db, c.var.session.userId, now()));
  });

  const answer = (kind: 'confirm' | 'cancel') => async (c: Context<AuthEnv>) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return c.json({ error: 'not_found', message: CHAT_TEXTS.notFound }, 404);
    const result = await answerProposal(
      { db, logger: logger() },
      { userId: c.var.session.userId, actionId: id, answer: kind, now: now() },
    );
    if (!result.ok) {
      if (result.code === 'not_found') {
        return c.json({ error: 'not_found', message: CHAT_TEXTS.notFound }, 404);
      }
      return c.json(
        {
          error: result.code === 'stale' ? 'proposal_stale' : 'proposal_closed',
          message: result.message,
          proposal: result.proposal,
        },
        409,
      );
    }
    return c.json({ proposal: result.proposal, reply: result.reply });
  };

  router.post('/chat/actions/:id/confirm', requireSession, requireRecentPin, answer('confirm'));
  router.post('/chat/actions/:id/cancel', requireSession, answer('cancel'));
}
