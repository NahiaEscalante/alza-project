/**
 * Small helpers for the web app API: JSON-only bodies validated with zod, id checks and error
 * bodies `{ error, message }` (message in Spanish when she may see it).
 */
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { CATEGORIES, DIRECTIONS } from '../../../db/schema.js';
import { isIsoDate, MAX_AMOUNT_CENTS } from '../../../domain/index.js';
import { LEDGER_ERROR_MESSAGES, LedgerError, type LedgerErrorCode } from '../../../ledger/index.js';

export const INVALID_REQUEST_MESSAGE = 'Revisa los datos e intenta de nuevo.';
export const NOT_FOUND_MESSAGE = 'No encontramos lo que buscas.';

export type Parsed<T> = { ok: true; data: T } | { ok: false; response: Response };

/**
 * Reads a JSON body. Only `application/json` is accepted: with SameSite=Lax cookies this closes
 * cross-site form posts (CSRF). Field names, never values, go back on errors.
 */
export async function readJson<T>(c: Context, schema: z.ZodType<T>): Promise<Parsed<T>> {
  if (!/^application\/json\b/i.test(c.req.header('content-type') ?? '')) {
    return {
      ok: false,
      response: c.json({ error: 'unsupported_media_type', message: INVALID_REQUEST_MESSAGE }, 415),
    };
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return {
      ok: false,
      response: c.json(
        { error: 'invalid_request', fields: [], message: INVALID_REQUEST_MESSAGE },
        400,
      ),
    };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? '')))];
    return {
      ok: false,
      response: c.json({ error: 'invalid_request', fields, message: INVALID_REQUEST_MESSAGE }, 400),
    };
  }
  return { ok: true, data: parsed.data };
}

export const jsonBodyLimit = bodyLimit({
  maxSize: 16 * 1024,
  onError: (c) => c.json({ error: 'payload_too_large', message: INVALID_REQUEST_MESSAGE }, 413),
});

/** Her data must never sit in a shared cache. */
export const noStore = createMiddleware(async (c, next) => {
  await next();
  c.res.headers.set('Cache-Control', 'no-store');
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | undefined): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export function notFound(c: Context): Response {
  return c.json({ error: 'not_found', message: NOT_FOUND_MESSAGE }, 404);
}

const LEDGER_STATUS: Record<LedgerErrorCode, 400 | 404 | 409> = {
  not_found: 404,
  not_live: 409,
  invalid_amount: 400,
  invalid_category: 400,
  invalid_day: 400,
  no_changes: 400,
  already_resolved: 409,
  invalid_resolution: 400,
};

/** Maps a LedgerError to its response; anything else is rethrown (500 via app.onError). */
export function ledgerErrorResponse(c: Context, err: unknown): Response {
  if (!(err instanceof LedgerError)) throw err;
  return c.json(
    { error: err.code, message: LEDGER_ERROR_MESSAGES[err.code] },
    LEDGER_STATUS[err.code],
  );
}

// Shared field schemas -------------------------------------------------------

export const amountCentsSchema = z.number().int().positive().max(MAX_AMOUNT_CENTS);
export const categorySchema = z.enum(CATEGORIES);
export const directionSchema = z.enum(DIRECTIONS);
/** What she can pick in the web (no «desconocido»). */
export const webPaymentMethodSchema = z.enum(['yape', 'plin', 'cash', 'bank_transfer']);
export const businessDaySchema = z.string().refine(isIsoDate);
