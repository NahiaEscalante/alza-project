import { getConnInfo } from '@hono/node-server/conninfo';
import { sql } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { waitlistSignups } from '../../db/schema.js';

/**
 * Landing waitlist (D43, D52): `POST /api/waitlist`.
 *
 * - Stores only name, phone (E.164), optional business name, consent version and date (D52).
 *   `created_at` is the consent date: a repeat signup re-consents, so it is refreshed.
 * - Idempotent per phone: a second signup updates the row instead of adding one, and the answer is
 *   the same in both cases, so the endpoint does not reveal who is already on the list.
 * - Never logs the name or the phone (RNF-09): this route logs nothing; errors go to app.onError,
 *   whose serializer drops query params.
 */

/** Consent line versions the landing may send. Keep in sync with `web/src/landing/consent.ts`. */
export const WAITLIST_CONSENT_VERSIONS = ['waitlist-v1'] as const;

const NAME_MAX = 80;
const BUSINESS_NAME_MAX = 80;

/**
 * Peru mobile number to E.164, or null. Accepts `999888777`, `999 888 777`, `+51 999 888 777`,
 * `51999888777` and `0051…`; mobiles have 9 digits and start with 9.
 */
export function normalizePeruMobile(input: string): string | null {
  let digits = input.replace(/[\s\-().]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  if (!/^\d+$/.test(digits)) return null;
  if (digits.length === 11 && digits.startsWith('51')) digits = digits.slice(2);
  return /^9\d{8}$/.test(digits) ? `+51${digits}` : null;
}

/** Trims and collapses inner whitespace (names are shown back to the team, never parsed). */
const cleanText = (value: string) => value.replace(/\s+/g, ' ').trim();

const signupSchema = z.object({
  name: z.string().transform(cleanText).pipe(z.string().min(2).max(NAME_MAX)),
  phone: z
    .string()
    .max(32)
    .transform((value, ctx) => {
      const e164 = normalizePeruMobile(value);
      if (!e164) {
        ctx.addIssue({ code: 'custom', message: 'invalid_phone' });
        return z.NEVER;
      }
      return e164;
    }),
  businessName: z
    .string()
    .transform(cleanText)
    .pipe(z.string().max(BUSINESS_NAME_MAX))
    .nullish()
    .transform((value) => value || null),
  consent: z.literal(true),
  consentVersion: z.enum(WAITLIST_CONSENT_VERSIONS),
});

export type WaitlistSignupInput = z.input<typeof signupSchema>;

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

export interface RateLimitSettings {
  /** Requests allowed per window and key. */
  limit: number;
  windowMs: number;
  /** Upper bound on tracked keys; expired ones are dropped first, then the oldest. */
  maxKeys?: number;
}

/**
 * Per-IP limit. Generous on purpose: at the demo venue many people share one public IP.
 * In memory, so it resets on restart and is per instance; enough for a single Railway service.
 */
export const DEFAULT_WAITLIST_RATE_LIMIT: RateLimitSettings = { limit: 20, windowMs: 10 * 60_000 };

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSec: number };

export function createFixedWindowLimiter(settings: RateLimitSettings) {
  const maxKeys = settings.maxKeys ?? 10_000;
  const windows = new Map<string, { count: number; resetAt: number }>();

  function prune(now: number): void {
    for (const [key, w] of windows) if (w.resetAt <= now) windows.delete(key);
    // Still full (a flood of distinct keys): drop the oldest entries (Map keeps insertion order).
    for (const key of windows.keys()) {
      if (windows.size < maxKeys) break;
      windows.delete(key);
    }
  }

  return {
    hit(key: string, now: number): RateLimitResult {
      let w = windows.get(key);
      if (!w || w.resetAt <= now) {
        if (!w && windows.size >= maxKeys) prune(now);
        w = { count: 0, resetAt: now + settings.windowMs };
        windows.set(key, w);
      }
      w.count += 1;
      if (w.count <= settings.limit) return { ok: true };
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((w.resetAt - now) / 1000)) };
    },
  };
}

/**
 * Client IP for rate limiting. Behind Railway's proxy the rightmost X-Forwarded-For entry is the
 * one the proxy appended (entries to its left are client-supplied). Locally, the socket address.
 */
function clientIp(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for');
  const last = forwarded
    ?.split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1);
  if (last) return last;
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown'; // app.request() in tests has no socket
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export interface WaitlistDeps {
  db: Db;
  rateLimit?: RateLimitSettings;
  /** Clock for the rate limiter (tests). */
  now?: () => number;
}

export function createWaitlistRouter(deps: WaitlistDeps): Hono {
  const router = new Hono();
  const limiter = createFixedWindowLimiter(deps.rateLimit ?? DEFAULT_WAITLIST_RATE_LIMIT);
  const now = deps.now ?? Date.now;

  router.post(
    '/',
    bodyLimit({
      maxSize: 4 * 1024,
      onError: (c) => c.json({ error: 'payload_too_large' }, 413),
    }),
    async (c) => {
      const limited = limiter.hit(clientIp(c), now());
      if (!limited.ok) {
        c.header('Retry-After', String(limited.retryAfterSec));
        return c.json({ error: 'rate_limited' }, 429);
      }

      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: 'invalid_request', fields: [] }, 400);
      }

      const parsed = signupSchema.safeParse(body);
      if (!parsed.success) {
        // Field names only: never echo the submitted values.
        const fields = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
        return c.json({ error: 'invalid_request', fields }, 400);
      }

      const { name, phone, businessName, consentVersion } = parsed.data;
      await deps.db
        .insert(waitlistSignups)
        .values({ phoneE164: phone, name, businessName, consentVersion })
        .onConflictDoUpdate({
          target: waitlistSignups.phoneE164,
          set: { name, businessName, consentVersion, createdAt: sql`now()` },
        });

      c.header('Cache-Control', 'no-store');
      return c.json({ ok: true }, 200);
    },
  );

  return router;
}
