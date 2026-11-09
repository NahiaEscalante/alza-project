/**
 * Telegram Bot API client (D71): one HTTPS POST per method (JSON or multipart) and file
 * downloads, with sanitized errors. The bot token only travels in the request path
 * (`/bot<token>/<method>`): errors never carry the URL, the token, Telegram's error description,
 * fetch causes or the request body, so nothing here can leak into logs.
 */
import { z } from 'zod';
import { TELEGRAM_BOT_TOKEN_PATTERN } from '../config.js';
import { ChannelError, type ChannelErrorCode } from './types.js';

export const TELEGRAM_API_ORIGIN = 'https://api.telegram.org';
/** Only what ALZA handles (D71): her messages and her button taps. */
export const TELEGRAM_ALLOWED_UPDATES = ['message', 'callback_query'] as const;
/** Bot API download limit (`getFile`). */
export const TELEGRAM_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

const DEFAULT_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 30_000;
/** A 429 that asks to wait this long or less is retried once in place; longer goes to the queue. */
const MAX_INLINE_RETRY_AFTER_S = 3;

const envelopeSchema = z
  .object({
    ok: z.boolean(),
    result: z.unknown().optional(),
    parameters: z.object({ retry_after: z.number().optional() }).loose().optional(),
  })
  .loose();

export const sentMessageSchema = z
  .object({ message_id: z.number().int(), chat: z.object({ id: z.number().int() }).loose() })
  .loose();
export const trueSchema = z.literal(true);
export const fileSchema = z
  .object({
    file_id: z.string(),
    file_size: z.number().int().nonnegative().optional(),
    file_path: z.string().optional(),
  })
  .loose();
export const botSchema = z
  .object({ id: z.number().int(), is_bot: z.literal(true), username: z.string().min(1) })
  .loose();
export const webhookInfoSchema = z
  .object({
    url: z.string(),
    pending_update_count: z.number().int().nonnegative(),
    last_error_date: z.number().int().optional(),
    last_error_message: z.string().optional(),
    max_connections: z.number().int().optional(),
    allowed_updates: z.array(z.string()).optional(),
  })
  .loose();
export const updatesSchema = z.array(z.object({ update_id: z.number().int() }).loose());

export type TelegramUpdate = z.infer<typeof updatesSchema>[number];
export type WebhookInfo = z.infer<typeof webhookInfoSchema>;
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export interface TelegramBotApiOptions {
  botToken: string;
  fetch?: Fetch;
  /** Waits for a short 429 `retry_after` (tests pass a fake). */
  sleep?: (ms: number) => Promise<void>;
}

export interface CallOptions {
  timeoutMs?: number;
  /** Aborts the request (long polling on shutdown). */
  signal?: AbortSignal;
  /** `getFile`: a 400 means the file id is unknown or expired. */
  media?: boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function errorCode(status: number, media: boolean): ChannelErrorCode {
  if (status === 401 || status === 404) return 'unauthorized';
  if (status === 429 || status >= 500) return 'unavailable';
  if (status === 400 && media) return 'media_not_found';
  // 403: she blocked the bot or never started it; 409: webhook vs polling conflict.
  return 'rejected';
}

export class TelegramBotApi {
  readonly #token: string;
  readonly #fetch: Fetch;
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(options: TelegramBotApiOptions) {
    if (!TELEGRAM_BOT_TOKEN_PATTERN.test(options.botToken)) {
      throw new ChannelError('rejected', 'invalid Telegram configuration');
    }
    this.#token = options.botToken;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#sleep = options.sleep ?? defaultSleep;
  }

  /** Calls one Bot API method and validates its `result`. */
  async call<T>(
    method: string,
    params: Record<string, unknown> | FormData,
    schema: z.ZodType<T>,
    options: CallOptions = {},
  ): Promise<T> {
    if (!/^[a-zA-Z]{3,40}$/.test(method)) throw new ChannelError('rejected', 'invalid method');
    for (let attempt = 0; ; attempt++) {
      const response = await this.#post(method, params, options);
      const envelope = envelopeSchema.safeParse(await response.json().catch(() => null));
      if (response.ok && envelope.success && envelope.data.ok) {
        const result = schema.safeParse(envelope.data.result);
        if (!result.success) {
          throw new ChannelError('unavailable', `Telegram ${method}: invalid response`);
        }
        return result.data;
      }
      const retryAfter = envelope.success ? envelope.data.parameters?.retry_after : undefined;
      if (
        response.status === 429 &&
        attempt === 0 &&
        retryAfter !== undefined &&
        retryAfter <= MAX_INLINE_RETRY_AFTER_S
      ) {
        await this.#sleep(Math.max(retryAfter, 0) * 1000);
        continue;
      }
      // Status only: Telegram's description may quote what was sent.
      throw new ChannelError(
        response.ok ? 'unavailable' : errorCode(response.status, options.media ?? false),
        `Telegram ${method} HTTP ${response.status}`,
      );
    }
  }

  /** Downloads `file_path` from `getFile`, refusing anything over `limitBytes`. */
  async downloadFile(filePath: string, limitBytes: number): Promise<Buffer> {
    if (
      !/^[A-Za-z0-9_\-./]{1,256}$/.test(filePath) ||
      filePath.includes('..') ||
      filePath.startsWith('/')
    ) {
      throw new ChannelError('rejected', 'invalid Telegram file path');
    }
    let response: Response;
    try {
      response = await this.#fetch(`${TELEGRAM_API_ORIGIN}/file/bot${this.#token}/${filePath}`, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
    } catch {
      throw new ChannelError('unavailable', 'Telegram file request failed');
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      const code: ChannelErrorCode =
        response.status === 404 || response.status === 400
          ? 'media_not_found'
          : errorCode(response.status, true);
      throw new ChannelError(code, `Telegram file HTTP ${response.status}`);
    }
    return readLimited(response, limitBytes);
  }

  getMe() {
    return this.call('getMe', {}, botSchema);
  }

  getWebhookInfo() {
    return this.call('getWebhookInfo', {}, webhookInfoSchema);
  }

  setWebhook(params: { url: string; secretToken: string; maxConnections?: number }) {
    return this.call(
      'setWebhook',
      {
        url: params.url,
        secret_token: params.secretToken,
        allowed_updates: [...TELEGRAM_ALLOWED_UPDATES],
        max_connections: params.maxConnections ?? 10,
        drop_pending_updates: false,
      },
      trueSchema,
    );
  }

  deleteWebhook() {
    return this.call('deleteWebhook', { drop_pending_updates: false }, trueSchema);
  }

  /** Long polling: waits up to `timeoutS` for updates after `offset`. */
  getUpdates(params: { offset: number; timeoutS: number }, signal?: AbortSignal) {
    return this.call(
      'getUpdates',
      {
        offset: params.offset,
        timeout: params.timeoutS,
        limit: 50,
        allowed_updates: [...TELEGRAM_ALLOWED_UPDATES],
      },
      updatesSchema,
      { timeoutMs: (params.timeoutS + 10) * 1000, ...(signal ? { signal } : {}) },
    );
  }

  async #post(
    method: string,
    params: Record<string, unknown> | FormData,
    options: CallOptions,
  ): Promise<Response> {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
    try {
      return await this.#fetch(`${TELEGRAM_API_ORIGIN}/bot${this.#token}/${method}`, {
        method: 'POST',
        redirect: 'error',
        signal,
        ...(params instanceof FormData
          ? { body: params }
          : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) }),
      });
    } catch {
      throw new ChannelError('unavailable', `Telegram ${method} request failed`);
    }
  }
}

async function readLimited(response: Response, limitBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > limitBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new ChannelError('limit_exceeded', 'media too large');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ChannelError('unavailable', 'empty Telegram file response');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > limitBytes) {
        await reader.cancel();
        throw new ChannelError('limit_exceeded', 'media too large');
      }
      chunks.push(chunk.value);
    }
  } catch (err) {
    if (err instanceof ChannelError) throw err;
    throw new ChannelError('unavailable', 'Telegram file download failed');
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
