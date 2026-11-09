/**
 * Session middlewares and cookies (14.3, 14.4).
 *
 * - `alza_device`: remembered device, 30 days, HttpOnly, SameSite=Lax, Secure in production,
 *   Path=/api. The session: the server never trusts a user id from the browser.
 * - `alza_activation`: the activation token between «abrir el enlace» and «Guardar mi PIN»
 *   (Path=/api/auth, until the link expires).
 * - `alza_access`: the 7-day token while a new device waits for the PIN (Path=/api/auth, ≤ 30 min).
 *
 * Mutations only accept JSON bodies (see `http/routes/app/http.ts`), which with SameSite=Lax
 * closes cross-site form posts (CSRF).
 */
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { Db } from '../db/client.js';
import { isPinFresh } from '../domain/index.js';
import { findSession, type Session } from './devices.js';
import { AUTH_MESSAGES } from './texts.js';

export const DEVICE_COOKIE = 'alza_device';
export const ACTIVATION_COOKIE = 'alza_activation';
export const ACCESS_COOKIE = 'alza_access';
export const PENDING_LOGIN_MAX_MS = 30 * 60_000;

export interface AuthEnv {
  Variables: { session: Session };
}

export interface CookieSettings {
  secure: boolean;
}

function setScopedCookie(
  c: Context,
  name: string,
  value: string,
  path: '/api' | '/api/auth',
  expires: Date,
  now: Date,
  settings: CookieSettings,
): void {
  setCookie(c, name, value, {
    httpOnly: true,
    secure: settings.secure,
    sameSite: 'Lax',
    path,
    expires,
    maxAge: Math.max(1, Math.floor((expires.getTime() - now.getTime()) / 1000)),
  });
}

export function setDeviceCookie(
  c: Context,
  value: string,
  rememberedUntil: Date,
  now: Date,
  settings: CookieSettings,
): void {
  setScopedCookie(c, DEVICE_COOKIE, value, '/api', rememberedUntil, now, settings);
}

export function setAuthFlowCookie(
  c: Context,
  name: typeof ACTIVATION_COOKIE | typeof ACCESS_COOKIE,
  token: string,
  expires: Date,
  now: Date,
  settings: CookieSettings,
): void {
  setScopedCookie(c, name, token, '/api/auth', expires, now, settings);
}

export function clearCookie(
  c: Context,
  name: string,
  path: '/api' | '/api/auth',
  settings: CookieSettings,
): void {
  deleteCookie(c, name, { path, secure: settings.secure, httpOnly: true, sameSite: 'Lax' });
}

export function readCookie(c: Context, name: string): string | null {
  return getCookie(c, name) ?? null;
}

export function createAuthMiddleware(deps: { db: Db; now: () => Date }) {
  /** 401 unless the request carries a valid remembered-device cookie. Sets `c.var.session`. */
  const requireSession = createMiddleware<AuthEnv>(async (c, next) => {
    const session = await findSession(deps.db, getCookie(c, DEVICE_COOKIE), deps.now());
    if (!session)
      return c.json({ error: 'unauthorized', message: AUTH_MESSAGES.unauthorized }, 401);
    c.set('session', session);
    await next();
  });

  /** 403 `pin_required` unless the PIN was verified on this device in the last 10 min (PR11). */
  const requireRecentPin = createMiddleware<AuthEnv>(async (c, next) => {
    if (!isPinFresh(c.var.session.pinVerifiedAt, deps.now())) {
      return c.json({ error: 'pin_required', message: AUTH_MESSAGES.pin_required }, 403);
    }
    await next();
  });

  return { requireSession, requireRecentPin };
}
