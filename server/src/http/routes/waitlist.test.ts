import { randomInt } from 'node:crypto';
import { Writable } from 'node:stream';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestDb, hasTestDb } from '../../../test/db.js';
import { createDb, createPool } from '../../db/client.js';
import { waitlistSignups } from '../../db/schema.js';
import { createLogger } from '../../lib/logger.js';
import { createApp } from '../app.js';
import {
  createFixedWindowLimiter,
  createWaitlistRouter,
  normalizePeruMobile,
  WAITLIST_CONSENT_VERSIONS,
  type WaitlistSignupInput,
} from './waitlist.js';

const CONSENT = WAITLIST_CONSENT_VERSIONS[0];

/** Unique Peru mobile per test (9 + 8 digits). */
const uniqueMobile = () => `9${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;

function post(app: { request: (path: string, init: RequestInit) => Response | Promise<Response> }) {
  return (body: unknown, headers: Record<string, string> = {}) =>
    app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
}

const validBody = (overrides: Partial<WaitlistSignupInput> = {}): WaitlistSignupInput => ({
  name: 'Marta Quispe',
  phone: uniqueMobile(),
  businessName: 'Bodega Sol',
  consent: true,
  consentVersion: CONSENT,
  ...overrides,
});

describe('normalizePeruMobile', () => {
  it.each([
    ['999888777', '+51999888777'],
    ['999 888 777', '+51999888777'],
    ['+51 999 888 777', '+51999888777'],
    ['+51999888777', '+51999888777'],
    ['51999888777', '+51999888777'],
    ['0051 999-888-777', '+51999888777'],
    ['(+51) 999.888.777', '+51999888777'],
  ])('accepts %s', (input, expected) => {
    expect(normalizePeruMobile(input)).toBe(expected);
  });

  it.each([
    ['', 'empty'],
    ['99988877', '8 digits'],
    ['9998887771', '10 digits'],
    ['899888777', 'does not start with 9'],
    ['014567890', 'landline'],
    ['+1 999 888 777', 'other country code'],
    ['+52999888777', 'other country code, same length'],
    ['99988877a', 'letters'],
    ['+51 +51 999888777', 'two prefixes'],
  ])('rejects %s (%s)', (input) => {
    expect(normalizePeruMobile(input)).toBeNull();
  });
});

describe('createFixedWindowLimiter', () => {
  it('allows `limit` hits per window and key, then answers retry-after', () => {
    const limiter = createFixedWindowLimiter({ limit: 2, windowMs: 60_000 });
    expect(limiter.hit('a', 0)).toEqual({ ok: true });
    expect(limiter.hit('a', 1_000)).toEqual({ ok: true });
    expect(limiter.hit('a', 1_500)).toEqual({ ok: false, retryAfterSec: 59 });
    expect(limiter.hit('b', 1_500)).toEqual({ ok: true });
    expect(limiter.hit('a', 60_000)).toEqual({ ok: true });
  });

  it('never tracks more than maxKeys', () => {
    const limiter = createFixedWindowLimiter({ limit: 1, windowMs: 60_000, maxKeys: 3 });
    for (const key of ['a', 'b', 'c', 'd']) expect(limiter.hit(key, 0).ok).toBe(true);
    // 'a' was evicted to make room, so it starts a new window.
    expect(limiter.hit('a', 0).ok).toBe(true);
    expect(limiter.hit('d', 0).ok).toBe(false);
  });
});

describe('POST /api/waitlist validation (no database needed)', () => {
  // Nothing listens on port 1: if validation let a request through, the insert would fail.
  const deadPool = createPool('postgres://alza:alza@127.0.0.1:1/alza', {
    connectionTimeoutMillis: 500,
  });
  const send = post(createWaitlistRouter({ db: createDb(deadPool) }));
  afterAll(() => deadPool.end());

  it('rejects an invalid phone, naming only the field', async () => {
    const res = await send(validBody({ phone: '12345' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ error: 'invalid_request', fields: ['phone'] });
    expect(JSON.stringify(json)).not.toContain('12345');
  });

  it('requires consent and a known consent version', async () => {
    const noConsent = await send({ ...validBody(), consent: false });
    expect(await noConsent.json()).toMatchObject({ fields: ['consent'] });

    const oldVersion = await send({ ...validBody(), consentVersion: 'waitlist-v0' });
    expect(await oldVersion.json()).toMatchObject({ fields: ['consentVersion'] });
  });

  it('requires a name of at least 2 characters after trimming', async () => {
    const res = await send(validBody({ name: '   a  ' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ fields: ['name'] });
  });

  it('rejects malformed JSON and oversized bodies', async () => {
    expect((await send('{"name":')).status).toBe(400);
    const huge = await send(validBody({ businessName: 'x'.repeat(5_000) }));
    expect(huge.status).toBe(413);
  });
});

describe('POST /api/waitlist rate limit (no database needed)', () => {
  const deadPool = createPool('postgres://alza:alza@127.0.0.1:1/alza', {
    connectionTimeoutMillis: 500,
  });
  afterAll(() => deadPool.end());

  it('answers 429 with Retry-After per client IP (rightmost X-Forwarded-For)', async () => {
    let clock = 0;
    const send = post(
      createWaitlistRouter({
        db: createDb(deadPool),
        rateLimit: { limit: 2, windowMs: 60_000 },
        now: () => clock,
      }),
    );
    const ip = (value: string) => ({ 'X-Forwarded-For': value });
    // Invalid bodies still count: the limit runs before parsing.
    expect((await send({}, ip('1.1.1.1'))).status).toBe(400);
    expect((await send({}, ip('6.6.6.6, 1.1.1.1'))).status).toBe(400);
    const limited = await send({}, ip('7.7.7.7, 1.1.1.1'));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    expect(await limited.json()).toEqual({ error: 'rate_limited' });

    expect((await send({}, ip('2.2.2.2'))).status).toBe(400);
    clock = 60_000;
    expect((await send({}, ip('1.1.1.1'))).status).toBe(400);
  });
});

describe.skipIf(!hasTestDb)('POST /api/waitlist (database)', () => {
  const { pool, db } = createTestDb();
  afterAll(() => pool.end());

  const rowsFor = (phoneE164: string) =>
    db.select().from(waitlistSignups).where(eq(waitlistSignups.phoneE164, phoneE164));

  it('stores name, E.164 phone, business, consent version and date', async () => {
    const mobile = uniqueMobile();
    const before = Date.now();
    const res = await post(createWaitlistRouter({ db }))(
      validBody({ phone: `+51 ${mobile.slice(0, 3)} ${mobile.slice(3, 6)} ${mobile.slice(6)}` }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const [row, ...rest] = await rowsFor(`+51${mobile}`);
    expect(rest).toHaveLength(0);
    expect(row).toMatchObject({
      name: 'Marta Quispe',
      businessName: 'Bodega Sol',
      consentVersion: CONSENT,
    });
    expect(row?.createdAt.getTime()).toBeGreaterThanOrEqual(before - 5_000);
  });

  it('is idempotent per phone: a repeat signup updates the row and answers the same', async () => {
    const send = post(createWaitlistRouter({ db }));
    const mobile = uniqueMobile();
    const first = await send(validBody({ phone: mobile, name: 'Marta' }));
    const second = await send(
      validBody({ phone: `51${mobile}`, name: '  Marta   Quispe ', businessName: '' }),
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());

    const rows = await rowsFor(`+51${mobile}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Marta Quispe', businessName: null });
  });

  it('accepts a missing business name', async () => {
    const mobile = uniqueMobile();
    const { businessName: _omit, ...body } = validBody({ phone: mobile });
    expect((await post(createWaitlistRouter({ db }))(body)).status).toBe(200);
    expect((await rowsFor(`+51${mobile}`))[0]?.businessName).toBeNull();
  });

  it('is mounted at /api/waitlist and never logs the name or the phone (RNF-09)', async () => {
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const app = createApp({ db, logger: createLogger({ level: 'trace', destination }) });
    const mobile = uniqueMobile();
    const res = await app.request('/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody({ phone: mobile, name: 'Rosa Huamán' })),
    });
    expect(res.status).toBe(200);
    expect(lines.length).toBeGreaterThan(0);
    const logged = lines.join('');
    expect(logged).toContain('/api/waitlist');
    expect(logged).not.toMatch(new RegExp(`${mobile}|Rosa|Huamán|Bodega`));
  });
});
