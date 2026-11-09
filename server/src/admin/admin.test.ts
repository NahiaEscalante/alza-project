import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestDb, hasTestDb } from '../../test/db.js';
import { createScryptPinHasher } from '../auth/index.js';
import {
  adminUsers,
  dailyCloses,
  inboundMessages,
  outboundMessages,
  pins,
  reports,
  streaks,
  trustedDevices,
} from '../db/schema.js';
import { addDays, businessDayStart, HOUR_MS, limaInstant, MINUTE_MS } from '../domain/index.js';
import { createTestUser } from '../http/routes/app/test-support.js';
import {
  computeMetrics,
  countConsistentUsers,
  createAdminSessionStore,
  createCredentialVerifier,
  finalizeClockFor,
  maskPhone,
  safeDetail,
  upsertAdminUser,
} from './index.js';

const fastHasher = createScryptPinHasher({ log2N: 10, r: 8, p: 1 });

describe('maskPhone (RNF-09)', () => {
  it('keeps the country code and the last 3 digits', () => {
    expect(maskPhone('+51999000111')).toBe('+51 ••• ••• 111');
    expect(maskPhone('+5491112345678')).toBe('+54 ••• 678');
    expect(maskPhone('123')).toBe('•••');
    expect(maskPhone(null)).toBe('•••');
  });
});

describe('admin sessions', () => {
  const t0 = new Date('2026-11-10T15:00:00Z');
  const later = (ms: number) => new Date(t0.getTime() + ms);

  it('finds a live session, refreshes its idle timer and ends at the absolute limit', () => {
    const store = createAdminSessionStore({ ttlMs: 3 * HOUR_MS, idleMs: HOUR_MS });
    const { token } = store.create('admin-1', t0);
    expect(store.find(token, later(50 * MINUTE_MS))?.adminUserId).toBe('admin-1');
    expect(store.find(token, later(100 * MINUTE_MS))?.adminUserId).toBe('admin-1');
    expect(store.find(token, later(150 * MINUTE_MS))?.adminUserId).toBe('admin-1');
    expect(store.find(token, later(3 * HOUR_MS))).toBeNull();
  });

  it('ends after an hour idle, on logout, and rejects junk tokens', () => {
    const store = createAdminSessionStore();
    const a = store.create('admin-1', t0);
    expect(store.find(a.token, later(61 * MINUTE_MS))).toBeNull();
    const b = store.create('admin-1', t0);
    store.revoke(b.token);
    expect(store.find(b.token, t0)).toBeNull();
    expect(store.find('not-a-token', t0)).toBeNull();
    expect(store.find(undefined, t0)).toBeNull();
  });
});

describe('countConsistentUsers («registro constante», 13.5)', () => {
  /** `n` complete closes in the week of `monday`. */
  const week = (userId: string, monday: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({ userId, businessDay: addDays(monday, i) }));

  it('needs 5+ complete closes in each of 4 consecutive weeks', () => {
    const rows = [
      // a: 4 weeks in a row with 5 → counts
      ...week('a', '2026-10-05', 5),
      ...week('a', '2026-10-12', 6),
      ...week('a', '2026-10-19', 5),
      ...week('a', '2026-10-26', 7),
      // b: a gap breaks the run
      ...week('b', '2026-10-05', 5),
      ...week('b', '2026-10-12', 5),
      ...week('b', '2026-10-26', 5),
      ...week('b', '2026-11-02', 5),
      // c: one week with only 4
      ...week('c', '2026-10-05', 5),
      ...week('c', '2026-10-12', 4),
      ...week('c', '2026-10-19', 5),
      ...week('c', '2026-10-26', 5),
      ...week('c', '2026-11-02', 5),
    ];
    expect(countConsistentUsers(rows)).toBe(1);
  });
});

describe('safeDetail', () => {
  it('passes primitives and short id lists only', () => {
    expect(
      safeDetail({
        week: '2026-11-02',
        closes: 6,
        ok: true,
        ids: ['a', 'b'],
        nested: { amountCents: 100 },
        long: 'x'.repeat(200),
        mixed: ['a', 1],
      }),
    ).toEqual({ week: '2026-11-02', closes: 6, ok: true, ids: ['a', 'b'] });
    expect(safeDetail(null)).toEqual({});
    expect(safeDetail(['x'])).toEqual({});
  });
});

describe('finalizeClockFor', () => {
  it('uses 12:00 of the next day while that is ahead, the real clock after', () => {
    const now = limaInstant('2026-11-10', 22);
    expect(finalizeClockFor('2026-11-10', now)).toEqual(limaInstant('2026-11-11', 12));
    expect(finalizeClockFor('2026-11-08', now)).toEqual(now);
  });
});

describe.skipIf(!hasTestDb)('admin accounts and metrics', () => {
  const { pool, db } = createTestDb();
  afterAll(() => pool.end());

  it('create-admin stores only a scrypt hash; running it again resets the password', async () => {
    const username = `Equipo-${randomUUID().slice(0, 6)}`;
    const first = await upsertAdminUser(
      db,
      { username, password: 'primera clave larga' },
      fastHasher,
    );
    expect(first.created).toBe(true);
    const [row] = await db.select().from(adminUsers).where(eq(adminUsers.id, first.id));
    expect(row?.email).toBe(username.toLowerCase());
    expect(row?.passwordHash).toMatch(/^scrypt\$/);
    expect(row?.passwordHash).not.toContain('primera');

    const verify = createCredentialVerifier(db, fastHasher);
    const now = new Date();
    expect(await verify(username, 'primera clave larga', now)).toMatchObject({ id: first.id });

    const again = await upsertAdminUser(
      db,
      { username, password: 'segunda clave larga' },
      fastHasher,
    );
    expect(again).toEqual({ id: first.id, created: false });
    expect(await verify(username, 'primera clave larga', now)).toBeNull();
    expect(await verify(username, 'segunda clave larga', now)).toMatchObject({ id: first.id });

    await expect(upsertAdminUser(db, { username, password: 'corta' }, fastHasher)).rejects.toThrow(
      'password_too_short',
    );
    await expect(
      upsertAdminUser(db, { username: 'a b', password: 'una clave muy larga' }, fastHasher),
    ).rejects.toThrow('invalid_username');
  });

  it('metrics count only what 13.5 asks, within the scope', async () => {
    const now = limaInstant('2026-11-10', 22);
    const today = '2026-11-10';
    // Ana: complete onboarding, PIN, streak 6, replied closes, web use, a download.
    const ana = await createTestUser(db);
    // Bea: complete onboarding, no PIN, one unanswered close.
    const bea = await createTestUser(db);
    // Cata: wrote but did not finish the onboarding.
    const cata = await createTestUser(db, { onboardingStatus: 'business_name' });
    const scope = { userIds: [ana.id, bea.id, cata.id] };

    await db.insert(pins).values({ userId: ana.id, pinHash: 'scrypt$x' });
    await db.insert(streaks).values([
      { userId: ana.id, days: 6, isoWeek: '2026-W46', freezesUsed: 0 },
      { userId: bea.id, days: 1, isoWeek: '2026-W46', freezesUsed: 0 },
    ]);
    const sentAt = (day: string) => limaInstant(day, 21);
    await db.insert(dailyCloses).values([
      {
        userId: ana.id,
        businessDay: '2026-11-09',
        status: 'final',
        sentAt: sentAt('2026-11-09'),
        repliedAt: sentAt('2026-11-09'),
        level: 'complete',
        clarificationRounds: 0,
      },
      {
        userId: ana.id,
        businessDay: '2026-11-03',
        status: 'final',
        sentAt: sentAt('2026-11-03'),
        repliedAt: sentAt('2026-11-03'),
        level: 'complete',
        clarificationRounds: 1,
      },
      {
        userId: bea.id,
        businessDay: '2026-11-09',
        status: 'final',
        sentAt: sentAt('2026-11-09'),
        level: 'no_close',
      },
    ]);
    const message = (userId: string, status: 'recorded' | 'unreadable' | 'failed', at: Date) => ({
      waMessageId: `wamid.${randomUUID()}`,
      userId,
      type: 'image' as const,
      receivedAt: at,
      status,
    });
    await db
      .insert(inboundMessages)
      .values([
        message(ana.id, 'recorded', limaInstant(today, 10)),
        message(ana.id, 'unreadable', limaInstant(today, 11)),
        message(ana.id, 'recorded', limaInstant('2026-11-03', 11)),
        message(bea.id, 'recorded', limaInstant('2026-11-09', 9)),
        message(bea.id, 'failed', limaInstant(today, 9)),
      ]);
    await db.insert(outboundMessages).values([
      { userId: ana.id, type: 'WA-10', createdAt: sentAt('2026-11-09') },
      { userId: ana.id, type: 'WA-12', createdAt: sentAt('2026-11-09') },
      { userId: bea.id, type: 'WA-10', createdAt: sentAt('2026-11-09') },
    ]);
    await db.insert(trustedDevices).values({
      userId: ana.id,
      cookieHash: randomUUID(),
      rememberedUntil: limaInstant('2026-12-10', 0),
      pinVerifiedAt: limaInstant(today, 8),
      createdAt: limaInstant('2026-10-01', 8),
    });
    await db.insert(reports).values({ userId: ana.id, period: '4_weeks', createdAt: now });

    const m = await computeMetrics(db, now, scope);
    expect(m.today).toBe(today);
    expect(m.activation.onboardingComplete).toEqual({ numerator: 2, denominator: 3, rate: 2 / 3 });
    expect(m.activation.pinCreated).toEqual({ numerator: 1, denominator: 2, rate: 0.5 });
    expect(m.habit.closesReplied).toEqual({ numerator: 2, denominator: 3, rate: 2 / 3 });
    expect(m.habit.averageStreakDays).toBe(3.5);
    expect(m.habit.usersWithStreak).toBe(2);
    // Last 4 full weeks: 12 Oct, 19 Oct, 26 Oct, 2 Nov. Ana's complete close of 3 Nov counts.
    expect(m.habit.completeClosesPerWeek.map((w) => w.weekStart)).toEqual([
      '2026-10-12',
      '2026-10-19',
      '2026-10-26',
      '2026-11-02',
    ]);
    expect(m.habit.completeClosesPerWeek[3]).toEqual({
      weekStart: '2026-11-02',
      completeCloses: 1,
      activeUsers: 1,
      average: 1,
    });
    expect(m.quality.withoutClarification).toEqual({ numerator: 1, denominator: 2, rate: 0.5 });
    // 4 images read (the failed one is not a reading), 1 unreadable.
    expect(m.quality.unreadable).toEqual({ numerator: 1, denominator: 4, rate: 0.25 });
    // 3 outbound in 7 days over user-days: Ana 9th, 10th; Bea 9th, 10th → 4.
    expect(m.cost).toMatchObject({ outbound: 3, activeUserDays: 4, perUserPerDay: 0.75 });
    expect(m.cost.byType).toEqual([
      { type: 'WA-10', count: 2 },
      { type: 'WA-12', count: 1 },
    ]);
    // Active in the last 7 days: Ana and Bea; on the web: Ana.
    expect(m.web.weeklyUse).toEqual({ numerator: 1, denominator: 2, rate: 0.5 });
    expect(m.rewardsAndReports).toEqual({
      redemptions: { delivered: 0, in_review: 0, rejected: 0 },
      reports: 1,
    });
    expect(m.impact).toEqual({ consistentRecording: 0, historyReady: 1 });
    expect(m.waitlist.signups).toBeGreaterThanOrEqual(0);
    // Nothing but numbers, dates and catalog ids.
    const raw = JSON.stringify(m);
    expect(raw).not.toContain(ana.id);
    expect(raw).not.toContain('Bodega');
    expect(businessDayStart(today).getTime()).toBeLessThan(now.getTime());
  });
});
