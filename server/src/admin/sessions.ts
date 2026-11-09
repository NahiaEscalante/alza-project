/**
 * Panel sessions (RF-AD-04). Separate from her web session: their own random cookie
 * (`alza_admin`, HttpOnly, SameSite=Strict, Path=/api/admin), never the `alza_device` one.
 *
 * Kept in memory, keyed by the token's SHA-256: a restart or a deploy logs the team out, which is
 * fine for a handful of people on one Railway service (same trade-off as the rate limits). That
 * way no table is needed and logging out really ends the session on the server.
 *
 * A session lasts 8 hours at most and ends after 1 hour without requests. Every request also
 * re-reads the account, so a deactivated account loses access at once.
 */
import { generateToken, hashToken, isWellFormedToken } from '../auth/tokens.js';
import { HOUR_MS, MINUTE_MS } from '../domain/index.js';

export const ADMIN_SESSION_TTL_MS = 8 * HOUR_MS;
export const ADMIN_SESSION_IDLE_MS = 60 * MINUTE_MS;

interface StoredSession {
  adminUserId: string;
  expiresAt: number;
  lastSeenAt: number;
}

export interface AdminSessionStore {
  /** New session; the raw token only goes into Set-Cookie. */
  create(adminUserId: string, now: Date): { token: string; expiresAt: Date };
  /** The admin behind a token, refreshing its idle timer. Null when unknown or expired. */
  find(token: unknown, now: Date): { adminUserId: string; expiresAt: Date } | null;
  revoke(token: unknown): void;
}

export interface AdminSessionOptions {
  ttlMs?: number;
  idleMs?: number;
  /** Upper bound on live sessions; the oldest go first. */
  maxSessions?: number;
}

export function createAdminSessionStore(options: AdminSessionOptions = {}): AdminSessionStore {
  const ttlMs = options.ttlMs ?? ADMIN_SESSION_TTL_MS;
  const idleMs = options.idleMs ?? ADMIN_SESSION_IDLE_MS;
  const maxSessions = options.maxSessions ?? 200;
  const sessions = new Map<string, StoredSession>();

  const alive = (s: StoredSession, at: number) => s.expiresAt > at && s.lastSeenAt + idleMs > at;

  function prune(at: number): void {
    for (const [key, s] of sessions) if (!alive(s, at)) sessions.delete(key);
    for (const key of sessions.keys()) {
      if (sessions.size < maxSessions) break;
      sessions.delete(key);
    }
  }

  return {
    create(adminUserId, now) {
      const at = now.getTime();
      prune(at);
      const token = generateToken();
      const expiresAt = at + ttlMs;
      sessions.set(hashToken(token), { adminUserId, expiresAt, lastSeenAt: at });
      return { token, expiresAt: new Date(expiresAt) };
    },
    find(token, now) {
      if (!isWellFormedToken(token)) return null;
      const key = hashToken(token);
      const s = sessions.get(key);
      const at = now.getTime();
      if (!s) return null;
      if (!alive(s, at)) {
        sessions.delete(key);
        return null;
      }
      s.lastSeenAt = at;
      return { adminUserId: s.adminUserId, expiresAt: new Date(s.expiresAt) };
    },
    revoke(token) {
      if (isWellFormedToken(token)) sessions.delete(hashToken(token));
    },
  };
}
