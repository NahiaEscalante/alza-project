import { type DestinationStream, type Logger, type LoggerOptions, pino } from 'pino';
import type { LogLevel } from '../config.js';

export type { Logger };

/**
 * RNF-09 / CLAUDE.md: system logs carry identifiers only (user id, wa_message_id, job id).
 * Never message text, amounts next to names, phones, tokens, cookies or PINs.
 *
 * Redaction is a safety net, not the policy: log ids, not objects. Any of these keys found up to
 * three levels deep (including inside arrays) is replaced by `[redacted]`.
 */
export const SENSITIVE_KEYS = [
  // Message content
  'text',
  'body',
  'content',
  'caption',
  'transcript',
  'transcription',
  // Money and people (amounts must never sit next to names)
  'amount',
  'amountCents',
  'amount_cents',
  'monto',
  'name',
  'businessName',
  'accountHolderName',
  'counterparty',
  'counterpartyNormalized',
  // Contact identifiers (a WhatsApp `from`/`wa_id` is a phone number)
  'phone',
  'phoneE164',
  'phone_e164',
  'from',
  'wa_id',
  'waId',
  // Credentials
  'pin',
  'pinHash',
  'token',
  'tokenHash',
  'cookie',
  'cookieHash',
  'password',
  'passwordHash',
  'secret',
  'apiKey',
  'accessToken',
  'authorization',
  'encryptionKey',
] as const;

const HEADER_PATHS = [
  'req.headers["x-hub-signature-256"]',
  'headers["x-hub-signature-256"]',
  'res.headers["set-cookie"]',
  'headers["set-cookie"]',
];

export const REDACT_PATHS: string[] = [
  ...SENSITIVE_KEYS.flatMap((key) => [key, `*.${key}`, `*.*.${key}`, `*.*.*.${key}`]),
  ...HEADER_PATHS,
];

interface ErrorLike extends Error {
  code?: unknown;
  constraint?: unknown;
  table?: unknown;
  column?: unknown;
  query?: unknown;
  params?: unknown;
}

/** Stack frames only: the first stack line repeats the message. */
function framesOnly(stack: string | undefined): string | undefined {
  return stack
    ?.split('\n')
    .filter((line) => line.trimStart().startsWith('at '))
    .join('\n');
}

/** Messages that can quote user data, so only the error type is logged. */
function messageMayContainData(e: ErrorLike): boolean {
  if (e instanceof SyntaxError) return true; // JSON.parse quotes its input
  // pg data exceptions (class 22) quote the rejected value: `invalid input syntax ...: "..."`
  return typeof e.code === 'string' && e.code.startsWith('22');
}

/**
 * Error serializer that keeps what helps debugging and drops what can leak data:
 * - DrizzleQueryError: its message embeds the query params (amounts, names), so only the SQL
 *   text (placeholders, no values) is kept.
 * - pg errors: keeps code/constraint/table/column, drops `detail` (it contains the row values).
 * - SyntaxError and pg data exceptions: the message quotes the input, so it is hidden.
 */
export function serializeError(err: unknown, depth = 0): Record<string, unknown> {
  if (!(err instanceof Error)) return { type: typeof err };
  const e = err as ErrorLike;
  const out: Record<string, unknown> = { type: e.name };

  if (e.name === 'DrizzleQueryError' || 'params' in e) {
    out.message = 'Failed query';
    if (typeof e.query === 'string') out.query = e.query;
    out.stack = framesOnly(e.stack);
  } else if (messageMayContainData(e)) {
    out.message = '[redacted]';
    out.stack = framesOnly(e.stack);
  } else {
    out.message = e.message;
    out.stack = e.stack;
  }

  for (const key of ['code', 'constraint', 'table', 'column'] as const) {
    if (typeof e[key] === 'string' || typeof e[key] === 'number') out[key] = e[key];
  }
  if (e.cause !== undefined && depth < 3) out.cause = serializeError(e.cause, depth + 1);
  return out;
}

export interface LoggerSettings {
  level?: LogLevel;
  /** Human-readable output (development only; pino-pretty is a dev dependency). */
  pretty?: boolean;
  /** Custom destination (tests). */
  destination?: DestinationStream;
}

export function createLogger(settings: LoggerSettings = {}): Logger {
  const options: LoggerOptions = {
    level: settings.level ?? 'info',
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    serializers: { err: serializeError, error: serializeError },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
  };
  if (settings.destination) return pino(options, settings.destination);
  if (settings.pretty) {
    return pino({
      ...options,
      formatters: undefined,
      transport: {
        target: 'pino-pretty',
        options: { translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
      },
    });
  }
  return pino(options);
}
