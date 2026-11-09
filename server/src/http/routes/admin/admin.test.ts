import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, hasTestDb } from '../../../../test/db.js';
import { ensureRewardsCatalog, getPointsBalance } from '../../../account/index.js';
import { upsertAdminUser } from '../../../admin/index.js';
import { createScryptPinHasher, rememberDevice } from '../../../auth/index.js';
import {
  adminAuditLog,
  alerts,
  dailyCloses,
  inboundMessages,
  pointsEntries,
  redemptions,
  rewards,
} from '../../../db/schema.js';
import {
  addDays,
  businessDayOf,
  DAY_MS,
  MINUTE_MS,
  pointsDeadline,
} from '../../../domain/index.js';
import type { JobScope } from '../../../jobs/types.js';
import { createLogger } from '../../../lib/logger.js';
import type { InboundQueue } from '../../../pipeline/deps.js';
import { createApp } from '../../app.js';
import { Browser, createTestUser, TestClock, TUESDAY_NIGHT } from '../app/test-support.js';
import type { AdminRouterOptions } from './index.js';

const logger = createLogger({ level: 'silent' });
const fastHasher = createScryptPinHasher({ log2N: 10, r: 8, p: 1 });
const PASSWORD = 'correct horse battery';

class RecordingQueue implements InboundQueue {
  readonly jobs: { inboundMessageId: string; userId: string; fresh: boolean }[] = [];
  async enqueue(
    job: { inboundMessageId: string; userId: string },
    options: { fresh?: boolean } = {},
  ): Promise<void> {
    this.jobs.push({ ...job, fresh: options.fresh ?? false });
  }
}

class RecordingJobs {
  readonly runs: { name: string; now: Date | undefined; scope: JobScope | undefined }[] = [];
  fail = false;
  async runJobNow(name: string, now?: Date, scope?: JobScope) {
    this.runs.push({ name, now, scope });
    if (this.fail) throw Object.assign(new Error('boom'), { failures: 2 });
    return { users: scope?.userIds?.length ?? 0, daysFinalized: 1 };
  }
}

describe.skipIf(!hasTestDb)('admin panel API (RF-AD-01..04)', () => {
  const { pool, db } = createTestDb();
  afterAll(() => pool.end());
  beforeAll(() => ensureRewardsCatalog(db));

  function setup(overrides: Partial<Omit<AdminRouterOptions, 'db' | 'logger'>> = {}) {
    const clock = new TestClock(TUESDAY_NIGHT);
    const queue = new RecordingQueue();
    const jobs = new RecordingJobs();
    const app = createApp({
      db,
      logger,
      admin: {
        now: clock.now,
        passwordHasher: fastHasher,
        queue,
        jobs: jobs as unknown as AdminRouterOptions['jobs'],
        ...overrides,
      },
    });
    return { clock, queue, jobs, app };
  }

  async function createAdmin(name = 'Ana del equipo') {
    const username = `ana-${randomUUID().slice(0, 8)}`;
    const { id } = await upsertAdminUser(db, { username, password: PASSWORD, name }, fastHasher);
    return { id, username };
  }

  async function loggedIn(app: ReturnType<typeof setup>['app']) {
    const admin = await createAdmin();
    const browser = new Browser(app);
    const res = await browser.post('/api/admin/auth/login', {
      username: admin.username,
      password: PASSWORD,
    });
    expect(res.status).toBe(200);
    return { admin, browser };
  }

  async function auditRows(adminUserId: string) {
    return db.select().from(adminAuditLog).where(eq(adminAuditLog.adminUserId, adminUserId));
  }

  async function failedMessage(userId: string, status: 'failed' | 'error' = 'failed') {
    const [row] = await db
      .insert(inboundMessages)
      .values({
        waMessageId: `wamid.${randomUUID()}`,
        userId,
        type: 'image',
        text: 'contenido privado',
        receivedAt: TUESDAY_NIGHT,
        status,
        attempts: 4,
        errorCode: 'ai_unavailable',
      })
      .returning();
    if (!row) throw new Error('no message');
    return row;
  }

  async function bigRedemption(userId: string) {
    // The catalog's big goal by name: other files add their own big test rewards in parallel.
    const [big] = await db
      .select()
      .from(rewards)
      .where(and(eq(rewards.isBig, true), eq(rewards.name, 'Electrodoméstico')));
    if (!big) throw new Error('no big reward');
    const [redemption] = await db
      .insert(redemptions)
      .values({ userId, rewardId: big.id, points: big.costPoints, status: 'in_review' })
      .returning();
    if (!redemption) throw new Error('no redemption');
    await db.insert(pointsEntries).values([
      { userId, type: 'complete_close', points: big.costPoints + 40 },
      { userId, type: 'redemption', points: -big.costPoints, referenceId: redemption.id },
    ]);
    return redemption;
  }

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------

  const PROTECTED: [string, string][] = [
    ['GET', '/api/admin/errors'],
    ['POST', '/api/admin/errors/retry-all'],
    ['POST', `/api/admin/errors/${randomUUID()}/retry`],
    ['GET', '/api/admin/redemptions'],
    ['POST', `/api/admin/redemptions/${randomUUID()}/approve`],
    ['POST', `/api/admin/redemptions/${randomUUID()}/reject`],
    ['GET', '/api/admin/alerts'],
    ['POST', `/api/admin/alerts/${randomUUID()}/review`],
    ['GET', '/api/admin/metrics'],
    ['GET', '/api/admin/audit-log'],
    ['GET', '/api/admin/tools'],
    ['POST', '/api/admin/tools/close-finalize'],
    ['POST', '/api/admin/tools/antifraud-scan'],
    ['POST', '/api/admin/tools/technical-issue'],
    ['POST', '/api/admin/auth/logout'],
    ['GET', '/api/admin/nope'],
  ];

  it('every admin route needs a panel session (401, never cached)', async () => {
    const { app } = setup();
    const anonymous = new Browser(app);
    for (const [method, path] of PROTECTED) {
      const res = await anonymous.request(method, path, method === 'POST' ? {} : undefined);
      expect(res.status, `${method} ${path}`).toBe(401);
      expect((await res.json()).error).toBe('unauthorized');
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('her web session (alza_device) does not open the panel', async () => {
    const { app, clock } = setup();
    const user = await createTestUser(db);
    const device = await rememberDevice(db, user.id, clock.now());
    const phone = new Browser(app);
    phone.cookies.set('alza_device', device.cookie);
    expect((await phone.get('/api/home')).status).toBe(200);
    for (const [method, path] of PROTECTED) {
      const res = await phone.request(method, path, method === 'POST' ? {} : undefined);
      expect(res.status, `${method} ${path}`).toBe(401);
    }
    // And the panel cookie does not open her web.
    const { browser } = await loggedIn(app);
    expect((await browser.get('/api/home')).status).toBe(401);
  });

  it('login sets a strict HttpOnly cookie scoped to /api/admin; logout ends it on the server', async () => {
    const { app } = setup();
    const admin = await createAdmin();
    const browser = new Browser(app);

    const wrong = await browser.post('/api/admin/auth/login', {
      username: admin.username,
      password: 'not the password',
    });
    expect(wrong.status).toBe(401);
    expect((await wrong.json()).error).toBe('invalid_credentials');
    const unknown = await browser.post('/api/admin/auth/login', {
      username: 'nobody-here',
      password: PASSWORD,
    });
    expect(unknown.status).toBe(401);
    expect((await browser.get('/api/admin/auth/session')).status).toBe(200);
    expect(await (await browser.get('/api/admin/auth/session')).json()).toEqual({
      authenticated: false,
    });

    const ok = await browser.post('/api/admin/auth/login', {
      username: admin.username.toUpperCase(),
      password: PASSWORD,
    });
    expect(ok.status).toBe(200);
    expect((await ok.json()).admin).toEqual({
      id: admin.id,
      username: admin.username,
      name: 'Ana del equipo',
    });
    const cookie = browser.setCookieHeaders.at(-1) ?? '';
    expect(cookie).toMatch(/^alza_admin=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/admin/i);
    expect(cookie).not.toContain(PASSWORD);

    const session = await (await browser.get('/api/admin/auth/session')).json();
    expect(session).toMatchObject({ authenticated: true, admin: { id: admin.id } });
    expect((await browser.get('/api/admin/errors')).status).toBe(200);

    const stolen = new Browser(app);
    stolen.cookies.set('alza_admin', browser.cookies.get('alza_admin') ?? '');
    expect((await browser.post('/api/admin/auth/logout')).status).toBe(200);
    expect((await stolen.get('/api/admin/errors')).status).toBe(401);

    const actions = (await auditRows(admin.id)).map((row) => row.action).sort();
    expect(actions).toEqual(['auth.login', 'auth.logout']);
  });

  it('a deactivated account loses access on its next request', async () => {
    const { app } = setup();
    const { admin, browser } = await loggedIn(app);
    const { adminUsers } = await import('../../../db/schema.js');
    await db.update(adminUsers).set({ active: false }).where(eq(adminUsers.id, admin.id));
    expect((await browser.get('/api/admin/errors')).status).toBe(401);
    const again = await new Browser(app).post('/api/admin/auth/login', {
      username: admin.username,
      password: PASSWORD,
    });
    expect(again.status).toBe(401);
  });

  it('login is rate limited per username', async () => {
    const { app } = setup({
      rateLimits: {
        perIp: { limit: 100, windowMs: 60_000 },
        perUsername: { limit: 3, windowMs: 60_000 },
      },
    });
    const admin = await createAdmin();
    const browser = new Browser(app);
    for (let i = 0; i < 3; i++) {
      const res = await browser.post('/api/admin/auth/login', {
        username: admin.username,
        password: 'nope nope nope',
      });
      expect(res.status).toBe(401);
    }
    const limited = await browser.post('/api/admin/auth/login', {
      username: admin.username,
      password: PASSWORD,
    });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBeTruthy();
  });

  it('mutations only accept JSON bodies (CSRF)', async () => {
    const { app } = setup();
    const { browser } = await loggedIn(app);
    const cookie = `alza_admin=${browser.cookies.get('alza_admin')}`;
    const res = await app.request('/api/admin/errors/retry-all', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'a=1',
    });
    expect(res.status).toBe(415);
  });

  // ---------------------------------------------------------------------------
  // Errors (RF-AD-01)
  // ---------------------------------------------------------------------------

  it('lists failed messages with ids and codes only, and retries them (logged)', async () => {
    const { app, queue } = setup();
    const { admin, browser } = await loggedIn(app);
    const user = await createTestUser(db);
    const failed = await failedMessage(user.id);
    const retrying = await failedMessage(user.id, 'error');

    const list = await browser.get(`/api/admin/errors?userId=${user.id}`);
    expect(list.status).toBe(200);
    const view = await list.json();
    expect(view.retryAvailable).toBe(true);
    const item = view.items.find((i: { id: string }) => i.id === failed.id);
    expect(item).toEqual({
      id: failed.id,
      type: 'image',
      status: 'failed',
      errorCode: 'ai_unavailable',
      attempts: 4,
      receivedAt: TUESDAY_NIGHT.toISOString(),
      userId: user.id,
      phone: expect.stringMatching(/^\+51 ••• ••• \d{3}$/),
    });
    const raw = JSON.stringify(view);
    expect(raw).not.toContain('contenido privado');
    expect(raw).not.toContain(user.phoneE164);
    expect(raw).not.toContain('Bodega Sol');

    expect((await browser.post(`/api/admin/errors/${retrying.id}/retry`)).status).toBe(409);
    expect((await browser.post(`/api/admin/errors/${randomUUID()}/retry`)).status).toBe(404);

    const retried = await browser.post(`/api/admin/errors/${failed.id}/retry`);
    expect(retried.status).toBe(200);
    const [after] = await db
      .select()
      .from(inboundMessages)
      .where(eq(inboundMessages.id, failed.id));
    expect(after?.status).toBe('received');
    expect(after?.errorCode).toBeNull();
    expect(queue.jobs).toEqual([{ inboundMessageId: failed.id, userId: user.id, fresh: true }]);
    // A second click finds it already back in the queue.
    expect((await browser.post(`/api/admin/errors/${failed.id}/retry`)).status).toBe(409);

    const [audit] = (await auditRows(admin.id)).filter((r) => r.action === 'inbound_message.retry');
    expect(audit).toMatchObject({
      targetType: 'inbound_message',
      targetId: failed.id,
      detail: { errorCode: 'ai_unavailable', attempts: 4 },
    });
  });

  it('«Reintentar todos» re-enqueues every failed message, in one audit row', async () => {
    const { app, queue } = setup();
    const { admin, browser } = await loggedIn(app);
    const user = await createTestUser(db);
    const a = await failedMessage(user.id);
    const b = await failedMessage(user.id);
    const res = await browser.post('/api/admin/errors/retry-all');
    expect(res.status).toBe(200);
    expect((await res.json()).retried).toBeGreaterThanOrEqual(2);
    const ids = queue.jobs.map((job) => job.inboundMessageId);
    expect(ids).toEqual(expect.arrayContaining([a.id, b.id]));
    const rows = (await auditRows(admin.id)).filter(
      (r) => r.action === 'inbound_message.retry_all',
    );
    expect(rows).toHaveLength(1);
    const detail = rows[0]?.detail as { inboundMessageIds: string[] } | undefined;
    expect(detail?.inboundMessageIds).toEqual(expect.arrayContaining([a.id, b.id]));
  });

  it('without a queue, retry answers 503 and nothing changes', async () => {
    const { app } = setup({ queue: null });
    // createApp falls back to the webhook queue; without a webhook there is none.
    const { browser } = await loggedIn(app);
    const user = await createTestUser(db);
    const failed = await failedMessage(user.id);
    expect((await (await browser.get('/api/admin/errors')).json()).retryAvailable).toBe(false);
    expect((await browser.post(`/api/admin/errors/${failed.id}/retry`)).status).toBe(503);
    const [after] = await db
      .select()
      .from(inboundMessages)
      .where(eq(inboundMessages.id, failed.id));
    expect(after?.status).toBe('failed');
  });

  // ---------------------------------------------------------------------------
  // Redemptions in review (13.3)
  // ---------------------------------------------------------------------------

  it('approving a big reward releases a DEMO code and keeps the points spent', async () => {
    const { app } = setup();
    const { admin, browser } = await loggedIn(app);
    const user = await createTestUser(db);
    const redemption = await bigRedemption(user.id);
    const balanceBefore = await getPointsBalance(db, user.id);

    const list = await (await browser.get('/api/admin/redemptions')).json();
    const item = list.inReview.find((i: { id: string }) => i.id === redemption.id);
    expect(item).toMatchObject({
      userId: user.id,
      rewardName: 'Electrodoméstico',
      points: 2500,
      status: 'in_review',
      activeWeeks: 0,
      requiredActiveWeeks: 8,
      openAlerts: 0,
      reviewedBy: null,
    });
    expect(item.phone).not.toContain(user.phoneE164.slice(3, 9));

    const res = await browser.post(`/api/admin/redemptions/${redemption.id}/approve`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'delivered', pointsReturned: 0 });
    const [after] = await db.select().from(redemptions).where(eq(redemptions.id, redemption.id));
    expect(after?.status).toBe('delivered');
    expect(after?.code).toMatch(/^DEMO-[A-Z2-9]{4}$/);
    expect(after?.reviewedBy).toBe(admin.id);
    expect(await getPointsBalance(db, user.id)).toBe(balanceBefore);

    // Decided once: a second click (or the other button) is a 409.
    expect((await browser.post(`/api/admin/redemptions/${redemption.id}/reject`)).status).toBe(409);
    const audit = (await auditRows(admin.id)).filter((r) => r.action === 'redemption.approve');
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0]?.detail)).not.toContain(after?.code ?? 'DEMO-');

    const reviewed = await (await browser.get('/api/admin/redemptions')).json();
    expect(reviewed.reviewed.find((i: { id: string }) => i.id === redemption.id)).toMatchObject({
      status: 'delivered',
      reviewedBy: { username: admin.username, name: 'Ana del equipo' },
    });
  });

  it('rejecting a big reward gives the points back as an adjustment (13.3)', async () => {
    const { app } = setup();
    const { admin, browser } = await loggedIn(app);
    const user = await createTestUser(db);
    const redemption = await bigRedemption(user.id);
    const balanceBefore = await getPointsBalance(db, user.id);

    const res = await browser.post(`/api/admin/redemptions/${redemption.id}/reject`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'rejected', pointsReturned: 2500 });
    expect(await getPointsBalance(db, user.id)).toBe(balanceBefore + 2500);
    const refunds = await db
      .select()
      .from(pointsEntries)
      .where(and(eq(pointsEntries.userId, user.id), eq(pointsEntries.type, 'adjustment')));
    expect(refunds).toMatchObject([{ points: 2500, referenceId: redemption.id }]);
    const [after] = await db.select().from(redemptions).where(eq(redemptions.id, redemption.id));
    expect(after).toMatchObject({ status: 'rejected', code: null, reviewedBy: admin.id });

    // Never twice: the points come back once.
    expect((await browser.post(`/api/admin/redemptions/${redemption.id}/reject`)).status).toBe(409);
    expect(await getPointsBalance(db, user.id)).toBe(balanceBefore + 2500);
    expect((await browser.post(`/api/admin/redemptions/${randomUUID()}/approve`)).status).toBe(404);
    const audit = (await auditRows(admin.id)).filter((r) => r.action === 'redemption.reject');
    expect(audit).toMatchObject([
      { targetId: redemption.id, detail: { userId: user.id, pointsReturned: 2500 } },
    ]);
  });

  // ---------------------------------------------------------------------------
  // Alerts (13.4, D62)
  // ---------------------------------------------------------------------------

  it('resolving a holder conflict turns her points back on; the alert keeps ids only', async () => {
    const { app } = setup();
    const { admin, browser } = await loggedIn(app);
    const user = await createTestUser(db);
    const other = await createTestUser(db);
    const [alert] = await db
      .insert(alerts)
      .values({
        userId: user.id,
        type: 'duplicate_account_holder',
        status: 'open',
        detail: { holderKey: 'abc123', conflictingUserIds: [other.id], nested: { x: 1 } },
      })
      .returning();
    if (!alert) throw new Error('no alert');
    const { hasOpenHolderConflict } = await import('../../../antifraud/index.js');
    expect(await hasOpenHolderConflict(db, user.id)).toBe(true);

    const open = await (await browser.get(`/api/admin/alerts?userId=${user.id}`)).json();
    const item = open.items.find((i: { id: string }) => i.id === alert.id);
    expect(item).toMatchObject({
      type: 'duplicate_account_holder',
      status: 'open',
      userId: user.id,
      withholdsPoints: true,
      detail: { holderKey: 'abc123', conflictingUserIds: [other.id] },
    });
    expect(item.detail.nested).toBeUndefined();
    expect(open.openCount).toBe(1);

    const res = await browser.post(`/api/admin/alerts/${alert.id}/review`, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'reviewed' });
    expect(await hasOpenHolderConflict(db, user.id)).toBe(false);
    expect((await browser.post(`/api/admin/alerts/${alert.id}/review`, {})).status).toBe(409);

    const closed = await (
      await browser.get(`/api/admin/alerts?status=closed&userId=${user.id}`)
    ).json();
    expect(closed.items.find((i: { id: string }) => i.id === alert.id)).toMatchObject({
      status: 'reviewed',
      withholdsPoints: false,
    });
    expect((await auditRows(admin.id)).filter((r) => r.action === 'alert.review')).toMatchObject([
      {
        targetId: alert.id,
        detail: { type: 'duplicate_account_holder', outcome: 'reviewed', userId: user.id },
      },
    ]);
  });

  it('reviewing a PIN lockout keeps its close notice pending (D28)', async () => {
    const { app, clock } = setup();
    const { browser } = await loggedIn(app);
    const user = await createTestUser(db);
    const { recordPinLockoutNotice, hasPendingSecurityNotice } = await import(
      '../../../auth/index.js'
    );
    await recordPinLockoutNotice(db, user.id, clock.now(), null);
    const [alert] = await db.select().from(alerts).where(eq(alerts.userId, user.id));
    const res = await browser.post(`/api/admin/alerts/${alert?.id}/review`, {
      outcome: 'dismissed',
    });
    expect(res.status).toBe(200);
    expect(await hasPendingSecurityNotice(db, user.id)).toBe(true);
    const [after] = await db.select().from(alerts).where(eq(alerts.userId, user.id));
    expect(after?.status).toBe('dismissed');
  });

  // ---------------------------------------------------------------------------
  // Metrics, audit log, tools
  // ---------------------------------------------------------------------------

  it('metrics answer the 13.5 shape with numbers and rates only', async () => {
    const { app } = setup();
    const { browser } = await loggedIn(app);
    const res = await browser.get('/api/admin/metrics');
    expect(res.status).toBe(200);
    const m = await res.json();
    expect(m.today).toBe(businessDayOf(TUESDAY_NIGHT));
    const ratio = { numerator: expect.any(Number), denominator: expect.any(Number) };
    expect(m.activation.onboardingComplete).toMatchObject(ratio);
    expect(m.activation.pinCreated).toMatchObject(ratio);
    expect(m.habit.closesReplied).toMatchObject(ratio);
    expect(m.habit.completeClosesPerWeek).toHaveLength(4);
    expect(m.habit.completeClosesPerWeek[0]).toMatchObject({
      weekStart: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      completeCloses: expect.any(Number),
      activeUsers: expect.any(Number),
    });
    expect(m.quality.withoutClarification).toMatchObject(ratio);
    expect(m.quality.unreadable).toMatchObject(ratio);
    expect(m.cost).toMatchObject({ outbound: expect.any(Number), byType: expect.any(Array) });
    expect(m.web.weeklyUse).toMatchObject(ratio);
    expect(m.rewardsAndReports.redemptions).toMatchObject({
      delivered: expect.any(Number),
      in_review: expect.any(Number),
      rejected: expect.any(Number),
    });
    expect(m.impact).toMatchObject({
      consistentRecording: expect.any(Number),
      historyReady: expect.any(Number),
    });
    expect(m.waitlist.signups).toEqual(expect.any(Number));
  });

  it('the audit log lists who did what, newest first', async () => {
    const { app } = setup();
    const { admin, browser } = await loggedIn(app);
    const res = await browser.get('/api/admin/audit-log');
    expect(res.status).toBe(200);
    const { items } = await res.json();
    const mine = items.filter((i: { admin: { id: string } }) => i.admin.id === admin.id);
    expect(mine[0]).toMatchObject({
      action: 'auth.login',
      admin: { username: admin.username, name: 'Ana del equipo' },
    });
  });

  it('close-finalize needs confirm and one scope; a past day runs at its 12:00 deadline', async () => {
    const { app, jobs, clock } = setup();
    const { admin, browser } = await loggedIn(app);
    const user = await createTestUser(db);
    const today = businessDayOf(clock.now());

    // Guards: no confirm, no scope, both scopes, a future day.
    expect(
      (await browser.post('/api/admin/tools/close-finalize', { userId: user.id })).status,
    ).toBe(400);
    expect((await browser.post('/api/admin/tools/close-finalize', { confirm: true })).status).toBe(
      400,
    );
    expect(
      (
        await browser.post('/api/admin/tools/close-finalize', {
          confirm: true,
          userId: user.id,
          allUsers: true,
        })
      ).status,
    ).toBe(400);
    const future = await browser.post('/api/admin/tools/close-finalize', {
      confirm: true,
      userId: user.id,
      businessDay: addDays(today, 1),
    });
    expect(future.status).toBe(400);
    expect((await future.json()).error).toBe('future_day');
    expect(jobs.runs).toHaveLength(0);

    // Today: as if it were 12:00 tomorrow, only for her.
    const res = await browser.post('/api/admin/tools/close-finalize', {
      confirm: true,
      userId: user.id,
      businessDay: today,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      ranAt: pointsDeadline(today).toISOString(),
      summary: { users: 1 },
    });
    expect(jobs.runs).toEqual([
      { name: 'close-finalize', now: pointsDeadline(today), scope: { userIds: [user.id] } },
    ]);

    // An old day whose deadline passed: the real clock (every due day gets finalized).
    clock.advance(10 * MINUTE_MS);
    await browser.post('/api/admin/tools/close-finalize', {
      confirm: true,
      allUsers: true,
      businessDay: addDays(today, -3),
    });
    expect(jobs.runs[1]).toEqual({ name: 'close-finalize', now: clock.now(), scope: undefined });

    const audit = (await auditRows(admin.id)).filter((r) => r.action === 'job.close_finalize');
    expect(audit).toHaveLength(2);
    expect(audit.map((r) => r.detail)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: 'user',
          userId: user.id,
          businessDay: today,
          outcome: 'ok',
        }),
        expect.objectContaining({ scope: 'all_users', userId: null, outcome: 'ok' }),
      ]),
    );
  });

  it('antifraud scan runs now and a failed run is logged as failed', async () => {
    const { app, jobs } = setup();
    const { admin, browser } = await loggedIn(app);
    const ok = await browser.post('/api/admin/tools/antifraud-scan', {
      confirm: true,
      allUsers: true,
    });
    expect(ok.status).toBe(200);
    expect(jobs.runs.at(-1)?.name).toBe('antifraud-scan');

    jobs.fail = true;
    const failed = await browser.post('/api/admin/tools/antifraud-scan', {
      confirm: true,
      allUsers: true,
    });
    expect(failed.status).toBe(500);
    expect((await failed.json()).error).toBe('job_failed');
    const outcomes = (await auditRows(admin.id))
      .filter((r) => r.action === 'job.antifraud_scan')
      .map((r) => (r.detail as { outcome: string }).outcome)
      .sort();
    expect(outcomes).toEqual(['failed', 'ok']);
  });

  it("the real job runner finalizes one user's day from the panel", async () => {
    const { app } = setup({ jobs: undefined });
    const { browser } = await loggedIn(app);
    const user = await createTestUser(db);
    const { consents } = await import('../../../db/schema.js');
    await db.insert(consents).values({
      userId: user.id,
      textVersion: 'v1',
      accepted: true,
      createdAt: new Date(TUESDAY_NIGHT.getTime() - 2 * DAY_MS),
    });
    const day = businessDayOf(TUESDAY_NIGHT);
    await db.insert(dailyCloses).values({ userId: user.id, businessDay: day, status: 'open' });
    const res = await browser.post('/api/admin/tools/close-finalize', {
      confirm: true,
      userId: user.id,
      businessDay: day,
    });
    expect(res.status).toBe(200);
    const [close] = await db.select().from(dailyCloses).where(eq(dailyCloses.userId, user.id));
    expect(close?.finalAt?.toISOString()).toBe(pointsDeadline(day).toISOString());
    expect(close?.level).toBe('no_close');
  });

  it('WA-17 is guarded: 503 when not connected, logged with counts when it is', async () => {
    const unwired = setup();
    const { browser } = await loggedIn(unwired.app);
    expect((await (await browser.get('/api/admin/tools')).json()).technicalIssue).toBe(false);
    const startedAt = new Date(TUESDAY_NIGHT.getTime() - 30 * MINUTE_MS).toISOString();
    expect(
      (await browser.post('/api/admin/tools/technical-issue', { confirm: true, startedAt })).status,
    ).toBe(503);

    const calls: Date[] = [];
    const wired = setup({
      broadcastTechnicalIssue: async ({ startedAt: at }) => {
        calls.push(at);
        return { sent: 2, skipped: 1, failed: 0 };
      },
    });
    const { admin, browser: team } = await loggedIn(wired.app);
    expect((await team.post('/api/admin/tools/technical-issue', { startedAt })).status).toBe(400);
    const res = await team.post('/api/admin/tools/technical-issue', { confirm: true, startedAt });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 2, skipped: 1, failed: 0 });
    expect(calls.map((d) => d.toISOString())).toEqual([startedAt]);
    expect(
      (await auditRows(admin.id)).filter((r) => r.action === 'broadcast.technical_issue'),
    ).toMatchObject([{ targetId: 'WA-17', detail: { startedAt, sent: 2, skipped: 1, failed: 0 } }]);
  });
});
