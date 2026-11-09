/**
 * Usage limits on authentication (14.5: «por IP y por usuaria»). Fixed windows in memory: they
 * reset on restart and are per instance, enough for one Railway service. The PIN lockouts of 14.3
 * live in the database and are the real protection; these only slow down floods.
 */
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';

export interface RateLimitSettings {
  limit: number;
  windowMs: number;
  /** Upper bound on tracked keys; expired ones go first, then the oldest. */
  maxKeys?: number;
}

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSec: number };

export interface RateLimiter {
  hit(key: string, now: number): RateLimitResult;
}

export function createRateLimiter(settings: RateLimitSettings): RateLimiter {
  const maxKeys = settings.maxKeys ?? 10_000;
  const windows = new Map<string, { count: number; resetAt: number }>();

  function prune(now: number): void {
    for (const [key, w] of windows) if (w.resetAt <= now) windows.delete(key);
    for (const key of windows.keys()) {
      if (windows.size < maxKeys) break;
      windows.delete(key);
    }
  }

  return {
    hit(key, now) {
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

export interface AuthRateLimits {
  /** Every `/api/auth/*` request, per client IP. Generous: the demo venue shares one IP. */
  perIp: RateLimitSettings;
  /** PIN checks and PIN creation, per user. */
  perUser: RateLimitSettings;
}

export const DEFAULT_AUTH_RATE_LIMITS: AuthRateLimits = {
  perIp: { limit: 120, windowMs: 10 * 60_000 },
  perUser: { limit: 30, windowMs: 15 * 60_000 },
};

/**
 * Client IP. Behind Railway's proxy the rightmost X-Forwarded-For entry is the one the proxy
 * added (the ones to its left come from the client). Locally, the socket address.
 */
export function clientIp(c: Context): string {
  const forwarded = c.req
    .header('x-forwarded-for')
    ?.split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1);
  if (forwarded) return forwarded;
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown'; // app.request() in tests has no socket
  }
}
