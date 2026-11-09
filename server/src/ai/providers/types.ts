/**
 * Provider adapters: the only code that talks to an AI vendor SDK. Everything above them (router,
 * layer) is vendor-neutral, so adding Claude Sonnet for production (D25, RF-EX-07) means one new
 * adapter plus routes.
 */

export type ProviderName = 'groq' | 'gemini';

export interface MediaInput {
  data: Buffer;
  /** e.g. image/jpeg, image/png, audio/ogg */
  mimeType: string;
}

export interface GenerateRequest {
  /** Instructions. Never contains user content. */
  system: string;
  /** Task text with user content wrapped as delimited DATA (RF-CH-04). */
  prompt: string;
  image?: MediaInput;
  audio?: MediaInput;
  /** Ask the provider for a JSON object. */
  json: boolean;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface TranscribeRequest {
  audio: MediaInput;
  /** ISO 639-1, e.g. «es». */
  language: string;
  /** Vocabulary hint for the speech model (not instructions). */
  prompt?: string;
}

export interface RawTranscription {
  text: string;
  /** Mean log-probability of the segments (Whisper). */
  avgLogprob?: number;
  /** Highest probability that a segment is silence (Whisper). */
  noSpeechProb?: number;
}

export interface ProviderClient {
  readonly provider: ProviderName;
  /** Returns the raw text of the first candidate. Throws ProviderError. */
  generate(model: string, request: GenerateRequest, signal: AbortSignal): Promise<string>;
  /** Speech-to-text endpoint (Whisper). Throws ProviderError(kind: unsupported) if absent. */
  transcribe(
    model: string,
    request: TranscribeRequest,
    signal: AbortSignal,
  ): Promise<RawTranscription>;
}

/**
 * - rate_limit (429), server (5xx), timeout, network, empty: transient → the route cools down.
 * - auth (401/403), not_found (404: model retired): configuration → long cooldown.
 * - bad_request (400/413/422), unsupported: this request only → next route, no cooldown.
 */
export const PROVIDER_ERROR_KINDS = [
  'rate_limit',
  'server',
  'timeout',
  'network',
  'empty',
  'auth',
  'not_found',
  'bad_request',
  'unsupported',
] as const;
export type ProviderErrorKind = (typeof PROVIDER_ERROR_KINDS)[number];

/** Error with a kind and status only: vendor messages can echo request data, so they are dropped. */
export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly status: number | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(kind: ProviderErrorKind, options: { status?: number; retryAfterMs?: number } = {}) {
    super(`provider error: ${kind}${options.status ? ` (${options.status})` : ''}`);
    this.name = 'ProviderError';
    this.kind = kind;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
  }
}

function kindForStatus(status: number): ProviderErrorKind {
  if (status === 429) return 'rate_limit';
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 408) return 'timeout';
  if (status >= 500) return 'server';
  return 'bad_request';
}

/** Seconds from a Retry-After header or a Gemini `retryDelay: "23s"` detail. */
export function parseRetryAfterMs(headerValue: unknown, message?: string): number | undefined {
  if (typeof headerValue === 'string' && /^\d+(\.\d+)?$/.test(headerValue.trim())) {
    return Math.ceil(Number(headerValue) * 1000);
  }
  const m = message ? /retry[_ ]?delay"?\s*[:=]\s*"?(\d+(?:\.\d+)?)s/i.exec(message) : null;
  if (m) return Math.ceil(Number(m[1]) * 1000);
  const m2 = message ? /retry in (\d+(?:\.\d+)?)\s*s/i.exec(message) : null;
  if (m2) return Math.ceil(Number(m2[1]) * 1000);
  return undefined;
}

interface ErrorShape {
  name?: unknown;
  status?: unknown;
  code?: unknown;
  message?: unknown;
  headers?: unknown;
}

function headerValue(headers: unknown, name: string): unknown {
  if (!headers) return undefined;
  if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name);
  if (typeof headers === 'object') return (headers as Record<string, unknown>)[name];
  return undefined;
}

/** Maps any SDK/fetch error to a ProviderError. */
export function toProviderError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  const e = (err ?? {}) as ErrorShape;
  const name = typeof e.name === 'string' ? e.name : '';
  const message = typeof e.message === 'string' ? e.message : '';
  if (name === 'TimeoutError' || name === 'AbortError' || /timed? ?out/i.test(name)) {
    return new ProviderError('timeout');
  }
  if (typeof e.status === 'number' && e.status > 0) {
    const retryAfterMs =
      e.status === 429
        ? parseRetryAfterMs(headerValue(e.headers, 'retry-after'), message)
        : undefined;
    return new ProviderError(kindForStatus(e.status), { status: e.status, retryAfterMs });
  }
  if (/APIConnectionTimeout/i.test(name)) return new ProviderError('timeout');
  return new ProviderError('network');
}
