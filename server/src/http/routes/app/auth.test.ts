import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestDb, hasTestDb } from '../../../../test/db.js';
import {
  createAccessLink,
  hashToken,
  hasPendingSecurityNotice,
  markSecurityNoticesShown,
} from '../../../auth/index.js';
import { accessLinks, alerts, pins, trustedDevices } from '../../../db/schema.js';
import { HOUR_MS, MINUTE_MS } from '../../../domain/index.js';
import { createLogger } from '../../../lib/logger.js';
import { createApp } from '../../app.js';
import {
  activationToken,
  addEntry,
  BASE_URL,
  Browser,
  createTestApi,
  createTestUser,
  setPin,
  signedInBrowser,
  TEST_PIN,
  TestClock,
  TUESDAY_NIGHT,
} from './test-support.js';

const WRONG_PIN = '583920';

describe.skipIf(!hasTestDb)('web access (14.3)', () => {
  const { pool, db } = createTestDb();
  afterAll(() => pool.end());

  async function setup(overrides: Parameters<typeof createTestApi>[2] = {}) {
    const clock = new TestClock(TUESDAY_NIGHT);
    const app = createTestApi(db, clock, overrides);
    const user = await createTestUser(db);
    return { clock, app, user };
  }

  async function accessToken(userId: string, now: Date): Promise<string> {
    return (await createAccessLink(db, userId, { baseUrl: BASE_URL, now })).token;
  }

  describe('HU-09 · first visit', () => {
    it('activates, rejects easy and mismatched PINs, creates the PIN and enters Inicio', async () => {
      const { clock, app, user } = await setup();
      const token = await activationToken(db, user.id, clock.now());
      const phone = new Browser(app);

      const activate = await phone.post('/api/auth/activate', { token });
      expect(activate.status).toBe(200);
      expect(await activate.json()).toMatchObject({ status: 'ok', hasPin: false });

      const easy = await phone.post('/api/auth/pin', { pin: '123456', pinConfirmation: '123456' });
      expect(easy.status).toBe(400);
      expect(await easy.json()).toEqual({
        error: 'too_easy',
        message: 'Ese PIN es muy fácil de adivinar. Prueba otro sin números seguidos ni repetidos.',
      });

      const mismatch = await phone.post('/api/auth/pin', {
        pin: TEST_PIN,
        pinConfirmation: '284710',
      });
      expect(await mismatch.json()).toMatchObject({
        error: 'mismatch',
        message: 'Los dos PIN no coinciden.',
      });

      expect((await phone.get('/api/home')).status).toBe(401);
      const created = await phone.post('/api/auth/pin', {
        pin: TEST_PIN,
        pinConfirmation: TEST_PIN,
      });
      expect(created.status).toBe(200);
      expect((await phone.get('/api/home')).status).toBe(200);

      const [pin] = await db.select().from(pins).where(eq(pins.userId, user.id));
      expect(pin?.pinHash).toMatch(/^scrypt\$/);
      expect(pin?.pinHash).not.toContain(TEST_PIN);
    });

    it('sets the remembered-device cookie HttpOnly, SameSite=Lax, 30 days and Secure', async () => {
      const { clock, app, user } = await setup({ secureCookies: true });
      const phone = new Browser(app);
      await phone.post('/api/auth/activate', {
        token: await activationToken(db, user.id, clock.now()),
      });
      await phone.post('/api/auth/pin', { pin: TEST_PIN, pinConfirmation: TEST_PIN });
      const device = phone.setCookieHeaders.find((header) => header.startsWith('alza_device='));
      expect(device).toBeDefined();
      expect(device).toMatch(/HttpOnly/);
      expect(device).toMatch(/Secure/);
      expect(device).toMatch(/SameSite=Lax/);
      expect(device).toMatch(/Path=\/api(;|$)/);
      expect(device).toMatch(/Max-Age=2592000/);

      const cookie = phone.cookies.get('alza_device') as string;
      const [row] = await db
        .select()
        .from(trustedDevices)
        .where(eq(trustedDevices.cookieHash, hashToken(cookie)));
      expect(row?.userId).toBe(user.id);
      expect(row?.cookieHash).not.toBe(cookie);
    });

    it('stores only the hash of a ≥128-bit token', async () => {
      const { clock, user } = await setup();
      const token = await activationToken(db, user.id, clock.now());
      expect(Buffer.from(token, 'base64url').length).toBeGreaterThanOrEqual(16);
      const rows = await db.select().from(accessLinks).where(eq(accessLinks.userId, user.id));
      expect(rows.map((row) => row.tokenHash)).toEqual([hashToken(token)]);
    });

    it('rejects an expired activation link telling her to write «web» (17.4)', async () => {
      const { clock, app, user } = await setup();
      const token = await activationToken(db, user.id, clock.now());
      clock.advance(HOUR_MS + MINUTE_MS);
      const res = await new Browser(app).post('/api/auth/activate', { token });
      expect(res.status).toBe(410);
      const body = await res.json();
      expect(body.error).toBe('link_expired');
      expect(body.message).toContain('Escribe «web» en WhatsApp');
    });

    it('rejects an activation link already used (17.4)', async () => {
      const { clock, app, user } = await setup();
      const token = await activationToken(db, user.id, clock.now());
      const first = new Browser(app);
      await first.post('/api/auth/activate', { token });
      expect(
        (await first.post('/api/auth/pin', { pin: TEST_PIN, pinConfirmation: TEST_PIN })).status,
      ).toBe(200);

      const again = await new Browser(app).post('/api/auth/activate', { token });
      expect(again.status).toBe(410);
      expect((await again.json()).error).toBe('link_used');
      // The activation cookie is gone, and replaying the token as a cookie fails too.
      expect(first.cookies.has('alza_activation')).toBe(false);
      const replay = new Browser(app);
      replay.cookies.set('alza_activation', token);
      const reuse = await replay.post('/api/auth/pin', {
        pin: '395172',
        pinConfirmation: '395172',
      });
      expect(reuse.status).toBe(410);
      expect((await reuse.json()).error).toBe('link_used');
    });

    it('a new activation link expires the previous unused one', async () => {
      const { clock, app, user } = await setup();
      const old = await activationToken(db, user.id, clock.now());
      await activationToken(db, user.id, clock.now());
      expect((await new Browser(app).post('/api/auth/activate', { token: old })).status).toBe(410);
    });

    it('rejects junk tokens and non-JSON bodies', async () => {
      const { app } = await setup();
      const phone = new Browser(app);
      expect((await phone.post('/api/auth/activate', { token: 'nope' })).status).toBe(410);
      const form = await app.request('/api/auth/activate', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'token=x',
      });
      expect(form.status).toBe(415);
    });
  });

  describe('HU-10 · coming back', () => {
    it('remembered phone + valid 7-day link → Inicio without PIN', async () => {
      const { clock, app, user } = await setup();
      const phone = await signedInBrowser(app, db, user.id, clock.now());
      clock.advance(3 * 24 * HOUR_MS);
      const res = await phone.post('/api/auth/enter', {
        token: await accessToken(user.id, clock.now()),
      });
      expect(await res.json()).toEqual({ status: 'ok' });
      expect((await phone.get('/api/home')).status).toBe(200);
    });

    it('another phone → pin_required; the right PIN remembers it', async () => {
      const { clock, app, user } = await setup();
      await setPin(db, user.id);
      const other = new Browser(app);
      const token = await accessToken(user.id, clock.now());

      expect(await (await other.post('/api/auth/enter', { token })).json()).toEqual({
        status: 'pin_required',
      });
      expect((await other.get('/api/home')).status).toBe(401);

      const verified = await other.post('/api/auth/pin/verify', { pin: TEST_PIN });
      expect(verified.status).toBe(200);
      expect((await other.get('/api/home')).status).toBe(200);
      expect(other.cookies.has('alza_access')).toBe(false);
    });

    it('an expired 7-day link is rejected', async () => {
      const { clock, app, user } = await setup();
      await setPin(db, user.id);
      const token = await accessToken(user.id, clock.now());
      clock.advance(7 * 24 * HOUR_MS);
      const res = await new Browser(app).post('/api/auth/enter', { token });
      expect(res.status).toBe(410);
      expect((await res.json()).error).toBe('link_expired');
    });

    it('without a PIN yet, the 7-day link asks for an activation link', async () => {
      const { clock, app, user } = await setup();
      const res = await new Browser(app).post('/api/auth/enter', {
        token: await accessToken(user.id, clock.now()),
      });
      expect(await res.json()).toMatchObject({ status: 'activation_required', reason: 'no_pin' });
    });

    it('5 wrong PINs lock for 15 minutes, explain until when, and flag the next close (D28)', async () => {
      const { clock, app, user } = await setup();
      await setPin(db, user.id);
      const other = new Browser(app);
      await other.post('/api/auth/enter', { token: await accessToken(user.id, clock.now()) });

      for (let i = 1; i <= 4; i++) {
        const res = await other.post('/api/auth/pin/verify', { pin: WRONG_PIN });
        expect(res.status).toBe(422);
        expect((await res.json()).attemptsLeft).toBe(5 - i);
      }
      expect(await hasPendingSecurityNotice(db, user.id)).toBe(false);

      const fifth = await other.post('/api/auth/pin/verify', { pin: WRONG_PIN });
      expect(fifth.status).toBe(423);
      const body = await fifth.json();
      expect(body.error).toBe('locked');
      expect(body.message).toContain('espera 15 minutos');
      expect(body.message).toContain('10:15 p. m.');
      expect(await hasPendingSecurityNotice(db, user.id)).toBe(true);

      // Even the right PIN waits for the lock.
      clock.advance(14 * MINUTE_MS);
      expect((await other.post('/api/auth/pin/verify', { pin: TEST_PIN })).status).toBe(423);
      clock.advance(MINUTE_MS);
      expect((await other.post('/api/auth/pin/verify', { pin: TEST_PIN })).status).toBe(200);

      expect(await markSecurityNoticesShown(db, user.id, clock.now())).toBe(1);
      expect(await hasPendingSecurityNotice(db, user.id)).toBe(false);
      const [alert] = await db
        .select()
        .from(alerts)
        .where(and(eq(alerts.userId, user.id), eq(alerts.type, 'pin_lockout')));
      expect(alert?.detail).toMatchObject({ closeNotice: 'shown' });
    });

    it('10 accumulated failures require a new activation link (17.4)', async () => {
      const { clock, app, user } = await setup();
      await setPin(db, user.id);
      const other = new Browser(app);
      await other.post('/api/auth/enter', { token: await accessToken(user.id, clock.now()) });

      for (let i = 0; i < 5; i++) await other.post('/api/auth/pin/verify', { pin: WRONG_PIN });
      clock.advance(15 * MINUTE_MS);
      await other.post('/api/auth/enter', { token: await accessToken(user.id, clock.now()) });
      for (let i = 0; i < 4; i++) {
        expect((await other.post('/api/auth/pin/verify', { pin: WRONG_PIN })).status).toBe(422);
      }
      const tenth = await other.post('/api/auth/pin/verify', { pin: WRONG_PIN });
      expect(tenth.status).toBe(403);
      expect(await tenth.json()).toMatchObject({
        error: 'activation_required',
        reason: 'too_many_attempts',
      });

      // The right PIN no longer works, and neither does the 7-day link.
      const fresh = new Browser(app);
      const enter = await fresh.post('/api/auth/enter', {
        token: await accessToken(user.id, clock.now()),
      });
      expect(await enter.json()).toMatchObject({ status: 'activation_required' });

      // «Olvidé mi PIN» → activation link → new PIN, counters start over.
      const phone = new Browser(app);
      await phone.post('/api/auth/activate', {
        token: await activationToken(db, user.id, clock.now()),
      });
      expect(
        (await phone.post('/api/auth/pin', { pin: '395172', pinConfirmation: '395172' })).status,
      ).toBe(200);
      const [pin] = await db.select().from(pins).where(eq(pins.userId, user.id));
      expect(pin).toMatchObject({ failedAttempts: 0, totalFailedAttempts: 0, lockedUntil: null });
    });
  });

  describe('17.4 · sensitive actions', () => {
    it('a 7-day link without PIN on a new phone cannot do anything sensitive', async () => {
      const { clock, app, user } = await setup();
      await setPin(db, user.id);
      const entry = await addEntry(db, user.id);
      const other = new Browser(app);
      await other.post('/api/auth/enter', { token: await accessToken(user.id, clock.now()) });

      const attempts = [
        other.patch(`/api/entries/${entry.id}`, { amountCents: 100 }),
        other.post(`/api/entries/${entry.id}/void`),
        other.post('/api/entries', {
          businessDay: '2026-11-09',
          amountCents: 500,
          direction: 'in',
          paymentMethod: 'cash',
        }),
        other.post('/api/redemptions', { rewardId: crypto.randomUUID() }),
        other.patch('/api/settings', { summaryImage: false }),
        other.post('/api/account/delete', { confirm: true }),
        other.post('/api/auth/logout-all'),
        other.get('/api/home'),
      ];
      for (const res of await Promise.all(attempts)) expect(res.status).toBe(401);
    });

    it('a remembered phone needs the PIN again after 10 minutes', async () => {
      const { clock, app, user } = await setup();
      const entry = await addEntry(db, user.id);
      const phone = await signedInBrowser(app, db, user.id, clock.now());
      clock.advance(10 * MINUTE_MS + 1000);

      expect((await phone.get('/api/home')).status).toBe(200);
      const stale = await phone.patch(`/api/entries/${entry.id}`, { amountCents: 1500 });
      expect(stale.status).toBe(403);
      expect(await stale.json()).toEqual({
        error: 'pin_required',
        message: 'Para hacer esto, escribe tu PIN.',
      });
      const session = await (await phone.get('/api/auth/session')).json();
      expect(session).toMatchObject({ authenticated: true, pinFresh: false });

      expect((await phone.post('/api/auth/pin/verify', { pin: TEST_PIN })).status).toBe(200);
      expect((await phone.patch(`/api/entries/${entry.id}`, { amountCents: 1500 })).status).toBe(
        200,
      );
    });

    it('«salir de todos» revokes every phone', async () => {
      const { clock, app, user } = await setup();
      const phone = await signedInBrowser(app, db, user.id, clock.now());
      const other = await signedInBrowser(app, db, user.id, clock.now());
      expect((await phone.post('/api/auth/logout-all')).status).toBe(200);
      expect((await phone.get('/api/home')).status).toBe(401);
      expect((await other.get('/api/home')).status).toBe(401);
    });
  });

  it('rate limits auth routes per IP', async () => {
    const { app } = await setup({
      rateLimits: {
        perIp: { limit: 3, windowMs: 60_000 },
        perUser: { limit: 3, windowMs: 60_000 },
      },
    });
    const phone = new Browser(app);
    for (let i = 0; i < 3; i++) expect((await phone.get('/api/auth/session')).status).toBe(200);
    const limited = await phone.get('/api/auth/session');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBeTruthy();
  });

  it('is mounted in the real app, answers no-store, and keeps the JSON 404', async () => {
    const app = createApp({ db, logger: createLogger({ level: 'silent' }) });
    const res = await app.request('/api/auth/session');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({ authenticated: false });
    expect((await app.request('/api/home')).status).toBe(401);
    expect((await app.request('/api/nope')).status).toBe(404);
  });
});
