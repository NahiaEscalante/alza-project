/**
 * Helpers for the web API tests only: a cheap PIN hasher, a settable clock, a cookie-keeping
 * «browser» per phone, and builders for users and ledger data. Unique data per test.
 */
import { randomInt } from 'node:crypto';
import { Hono } from 'hono';
import {
  createActivationLink,
  createScryptPinHasher,
  type PinHasher,
  rememberDevice,
} from '../../../auth/index.js';
import type { Db } from '../../../db/client.js';
import { type NewUser, pins, type User, users } from '../../../db/schema.js';
import { limaInstant, normalizeName } from '../../../domain/index.js';
import { type CreateEntryInput, createEntry } from '../../../ledger/index.js';
import { createWebAppRouter, type WebAppRouterDeps } from './index.js';

export const BASE_URL = 'http://localhost:5173';
/** Cheap scrypt (N = 2^10) so lockout tests stay fast; production uses N = 2^17. */
export const fastPinHasher: PinHasher = createScryptPinHasher({ log2N: 10, r: 8, p: 1 });

export class TestClock {
  current: Date;
  constructor(start: Date) {
    this.current = start;
  }
  now = (): Date => this.current;
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** Tuesday 10 Nov 2026, 22:00 Lima (business day 2026-11-10). */
export const TUESDAY_NIGHT = limaInstant('2026-11-10', 22, 0);

export function createTestApi(
  db: Db,
  clock: TestClock,
  overrides: Partial<WebAppRouterDeps> = {},
): Hono {
  const app = new Hono();
  app.route(
    '/api',
    createWebAppRouter({
      db,
      now: clock.now,
      pinHasher: fastPinHasher,
      storage: { delete: async () => false },
      ...overrides,
    }),
  );
  return app;
}

/** Responses are asserted with `expect`, so their JSON is loosely typed. */
// biome-ignore lint/suspicious/noExplicitAny: test-only JSON bodies
export type TestResponse = Omit<Response, 'json'> & { json(): Promise<any> };

/** A phone: keeps the cookies the server sets, like a browser (path ignored). */
export class Browser {
  readonly cookies = new Map<string, string>();
  readonly setCookieHeaders: string[] = [];
  constructor(private readonly app: Hono) {}

  async request(method: string, path: string, body?: unknown): Promise<TestResponse> {
    const headers: Record<string, string> = {};
    if (this.cookies.size > 0) {
      headers.cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    }
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await this.app.request(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const header of res.headers.getSetCookie()) {
      this.setCookieHeaders.push(header);
      const [pair] = header.split(';');
      const index = (pair ?? '').indexOf('=');
      const name = (pair ?? '').slice(0, index).trim();
      const value = (pair ?? '').slice(index + 1).trim();
      if (/max-age=0\b/i.test(header) || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return res;
  }

  get = (path: string) => this.request('GET', path);
  post = (path: string, body: unknown = {}) => this.request('POST', path, body);
  patch = (path: string, body: unknown) => this.request('PATCH', path, body);
}

export function uniquePhone(): string {
  return `+519${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
}

export async function createTestUser(db: Db, overrides: Partial<NewUser> = {}): Promise<User> {
  const holder = overrides.accountHolderName ?? 'Marta Quispe Huamán';
  const [user] = await db
    .insert(users)
    .values({
      phoneE164: uniquePhone(),
      businessName: 'Bodega Sol',
      accountHolderName: holder,
      accountHolderNormalized: normalizeName(holder),
      closeTime: '21:00',
      onboardingStatus: 'complete',
      ...overrides,
    })
    .returning();
  if (!user) throw new Error('no user');
  return user;
}

export const TEST_PIN = '284719';

export async function setPin(db: Db, userId: string, pin = TEST_PIN): Promise<void> {
  await db
    .insert(pins)
    .values({ userId, pinHash: await fastPinHasher.hash(pin) })
    .onConflictDoUpdate({
      target: pins.userId,
      set: { pinHash: await fastPinHasher.hash(pin), failedAttempts: 0, totalFailedAttempts: 0 },
    });
}

/** A phone already remembered with the PIN just verified (fresh for 10 minutes). */
export async function signedInBrowser(
  app: Hono,
  db: Db,
  userId: string,
  now: Date,
): Promise<Browser> {
  await setPin(db, userId);
  const device = await rememberDevice(db, userId, now);
  const browser = new Browser(app);
  browser.cookies.set('alza_device', device.cookie);
  return browser;
}

export async function activationToken(db: Db, userId: string, now: Date): Promise<string> {
  return (await createActivationLink(db, userId, { baseUrl: BASE_URL, now })).token;
}

export function entryInput(
  userId: string,
  overrides: Partial<CreateEntryInput> = {},
): CreateEntryInput {
  return {
    userId,
    businessDay: '2026-11-10',
    amountCents: 1200,
    direction: 'in',
    paymentMethod: 'yape',
    category: 'sale',
    label: 'screenshot',
    source: 'screenshot',
    counterparty: 'Ana Torres',
    operationAt: limaInstant('2026-11-10', 10, 42),
    ...overrides,
  };
}

export function addEntry(db: Db, userId: string, overrides: Partial<CreateEntryInput> = {}) {
  return createEntry(db, entryInput(userId, overrides), { kind: 'system', channel: 'pipeline' });
}
