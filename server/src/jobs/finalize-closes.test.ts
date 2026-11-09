import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestDb, hasTestDb } from '../../test/db.js';
import { checkHolderConflict } from '../antifraud/holder-conflict.js';
import { alerts, clarifications, consents, dailyCloses, inboundMessages } from '../db/schema.js';
import { addDays, limaInstant, MINUTE_MS, pointsDeadline } from '../domain/index.js';
import { createLogger } from '../lib/logger.js';
import { finalizeDueCloses } from './finalize-closes.js';
import {
  createActiveUser,
  getClose,
  getPoints,
  getStreak,
  recordClose,
  total,
  uniqueHolder,
} from './test-support.js';

const MON = '2026-11-09';
const TUE = addDays(MON, 1);
const WED = addDays(MON, 2);
const THU = addDays(MON, 3);
const FRI = addDays(MON, 4);
const CONSENT_AT = limaInstant('2026-11-02', 9);

describe.skipIf(!hasTestDb)('12:00 finalization (8.4, 13.1, HU-08)', () => {
  const { pool, db } = createTestDb();
  const logger = createLogger({ level: 'silent' });
  afterAll(async () => {
    await pool.end();
  });

  const run = (userId: string, now: Date) =>
    finalizeDueCloses({ db, logger }, now, { userIds: [userId] });
  const newUser = () => createActiveUser(db, { consentAt: CONSENT_AT });

  describe('HU-08', () => {
    it('a complete close gives 10 points and +1 streak at 12:00 of the next day', async () => {
      const userId = await newUser();
      const close = await recordClose(db, userId, MON, 'complete');

      // 11:59 of Tuesday: still in time, nothing happens.
      const early = await run(userId, new Date(pointsDeadline(MON).getTime() - MINUTE_MS));
      expect(early.daysFinalized).toBe(0);
      expect(await getPoints(db, userId)).toEqual([]);

      const noon = pointsDeadline(MON);
      const summary = await run(userId, noon);
      expect(summary).toMatchObject({ users: 1, daysFinalized: 1, pointsAwarded: 10 });
      expect(await getPoints(db, userId)).toEqual([
        { type: 'complete_close', points: 10, referenceId: close.id, createdAt: noon },
      ]);
      expect(await getStreak(db, userId)).toMatchObject({ days: 1, freezesUsed: 0 });
      expect(await getClose(db, userId, MON)).toMatchObject({
        status: 'final',
        level: 'complete',
        finalAt: noon,
      });
    });

    it('a day without close uses a freeze: streak kept, no points', async () => {
      const userId = await newUser();
      await recordClose(db, userId, MON, 'complete');
      await run(userId, pointsDeadline(MON));

      // Tuesday: nothing at all (no close was sent). Wednesday 12:00 finalizes it.
      await run(userId, pointsDeadline(TUE));
      expect(await getClose(db, userId, TUE)).toMatchObject({
        status: 'final',
        level: 'no_close',
        sentAt: null,
      });
      expect(await getStreak(db, userId)).toMatchObject({ days: 1, freezesUsed: 1 });
      expect(total(await getPoints(db, userId))).toBe(10);
    });

    it('the third day without close in the same week resets the streak', async () => {
      const userId = await newUser();
      await recordClose(db, userId, MON, 'complete');
      await recordClose(db, userId, WED, 'sent');
      for (const day of [MON, TUE, WED]) await run(userId, pointsDeadline(day));
      expect(await getStreak(db, userId)).toMatchObject({ days: 1, freezesUsed: 2 });

      const summary = await run(userId, pointsDeadline(THU));
      expect(summary.daysFinalized).toBe(1);
      expect(await getStreak(db, userId)).toMatchObject({ days: 0, freezesUsed: 2 });
      expect(total(await getPoints(db, userId))).toBe(10);
    });
  });

  it('sent and never answered: no close, cash check «sin respuesta»', async () => {
    const userId = await newUser();
    await recordClose(db, userId, MON, 'sent');
    await run(userId, pointsDeadline(MON));
    expect(await getClose(db, userId, MON)).toMatchObject({
      status: 'final',
      level: 'no_close',
      cashCheck: 'no_answer',
    });
    expect(await getPoints(db, userId)).toEqual([]);
    expect(await getStreak(db, userId)).toMatchObject({ days: 0, freezesUsed: 1 });
  });

  it('still waiting for a clarification at 12:00: the level reached so far (partial, 4)', async () => {
    const userId = await newUser();
    await recordClose(db, userId, MON, 'awaiting');
    await run(userId, pointsDeadline(MON));
    expect(await getClose(db, userId, MON)).toMatchObject({ status: 'final', level: 'partial' });
    expect(await getPoints(db, userId)).toMatchObject([{ type: 'partial_close', points: 4 }]);
    expect(await getStreak(db, userId)).toMatchObject({ days: 1 });
  });

  it('answered without a stored level: computed from her doubts and cash check (11.9)', async () => {
    const userId = await newUser();
    const close = await recordClose(db, userId, MON, 'complete');
    await db.update(dailyCloses).set({ level: null }).where(eq(dailyCloses.id, close.id));
    await db.insert(clarifications).values({
      userId,
      businessDay: MON,
      type: 'unreadable',
      priority: 3,
      status: 'in_message',
      messageNumber: 1,
    });
    await run(userId, pointsDeadline(MON));
    expect(await getClose(db, userId, MON)).toMatchObject({ level: 'partial' });
  });

  it('case 20: a reply after 12:00 only improves the level, without points (D17)', async () => {
    const userId = await newUser();
    await recordClose(db, userId, MON, 'late');
    // Missed run: the job only runs after the late reply was applied.
    await run(userId, new Date(pointsDeadline(MON).getTime() + 2 * 60 * MINUTE_MS));
    expect(await getClose(db, userId, MON)).toMatchObject({
      status: 'final',
      level: 'no_close',
      improvedLevel: 'complete',
    });
    expect(await getPoints(db, userId)).toEqual([]);
  });

  it('moves unresolved doubts of the day to the web (9.2)', async () => {
    const userId = await newUser();
    await recordClose(db, userId, MON, 'partial');
    const doubt = (status: 'open' | 'in_message' | 'resolved', day = MON) => ({
      userId,
      businessDay: day,
      type: 'category' as const,
      priority: 6,
      status,
    });
    await db
      .insert(clarifications)
      .values([doubt('open'), doubt('in_message'), doubt('resolved'), doubt('open', TUE)]);
    await run(userId, pointsDeadline(MON));
    const rows = await db
      .select({ day: clarifications.businessDay, status: clarifications.status })
      .from(clarifications)
      .where(eq(clarifications.userId, userId));
    expect(rows.map((row) => `${row.day}:${row.status}`).sort()).toEqual(
      [`${MON}:in_web`, `${MON}:in_web`, `${MON}:resolved`, `${TUE}:open`].sort(),
    );
  });

  it('is idempotent: running twice never awards twice', async () => {
    const userId = await newUser();
    await recordClose(db, userId, MON, 'complete');
    await recordClose(db, userId, TUE, 'complete');
    const noon = pointsDeadline(TUE);
    const first = await run(userId, noon);
    const again = await run(userId, noon);
    const later = await run(userId, new Date(noon.getTime() + 3 * 60 * MINUTE_MS));
    expect(first.daysFinalized).toBe(2);
    expect(again.daysFinalized).toBe(0);
    expect(later.daysFinalized).toBe(0);
    // Two runs at the same time (a retry overlapping a manual run).
    await Promise.all([run(userId, pointsDeadline(WED)), run(userId, pointsDeadline(WED))]);
    expect(total(await getPoints(db, userId))).toBe(20);
    expect(await getStreak(db, userId)).toMatchObject({ days: 2, freezesUsed: 1 });
  });

  it('catches up a missed run: every past day, in order', async () => {
    const userId = await newUser();
    await recordClose(db, userId, MON, 'complete');
    await recordClose(db, userId, WED, 'complete');
    // No runs Tuesday to Thursday; Friday 12:00 finalizes Monday to Thursday.
    const summary = await run(userId, pointsDeadline(THU));
    expect(summary.daysFinalized).toBe(4);
    const levels = await db
      .select({ day: dailyCloses.businessDay, level: dailyCloses.level })
      .from(dailyCloses)
      .where(eq(dailyCloses.userId, userId))
      .orderBy(dailyCloses.businessDay);
    expect(levels).toEqual([
      { day: MON, level: 'complete' },
      { day: TUE, level: 'no_close' },
      { day: WED, level: 'complete' },
      { day: THU, level: 'no_close' },
    ]);
    expect(await getStreak(db, userId)).toMatchObject({ days: 2, freezesUsed: 2 });
    expect(total(await getPoints(db, userId))).toBe(20);
  });

  it('does not count days before her first activity', async () => {
    const userId = await newUser();
    await recordClose(db, userId, WED, 'complete');
    await run(userId, pointsDeadline(WED));
    const rows = await db
      .select({ day: dailyCloses.businessDay })
      .from(dailyCloses)
      .where(eq(dailyCloses.userId, userId));
    expect(rows).toEqual([{ day: WED }]);
    expect(await getStreak(db, userId)).toMatchObject({ days: 1, freezesUsed: 0 });
  });

  it('skips users who are not active (onboarding, consent declined)', async () => {
    const halfway = await createActiveUser(db, { consentAt: CONSENT_AT, onboarding: 'close_time' });
    const declined = await newUser();
    await db.insert(consents).values({
      userId: declined,
      textVersion: 'v1',
      accepted: false,
      createdAt: limaInstant(MON, 8),
    });
    for (const userId of [halfway, declined]) {
      await recordClose(db, userId, MON, 'complete');
      const summary = await run(userId, pointsDeadline(MON));
      expect(summary.users).toBe(0);
      expect(await getClose(db, userId, MON)).toMatchObject({ status: 'replied', finalAt: null });
    }
  });

  it('13.4: an open repeated-holder alert finalizes the day without points', async () => {
    const holder = uniqueHolder();
    await createActiveUser(db, { consentAt: CONSENT_AT, holder });
    const userId = await createActiveUser(db, { consentAt: CONSENT_AT, holder });
    const check = await checkHolderConflict(db, userId, holder);
    expect(check.conflict).toBe(true);

    await recordClose(db, userId, MON, 'complete');
    const summary = await run(userId, pointsDeadline(MON));
    expect(summary).toMatchObject({ daysFinalized: 1, pointsAwarded: 0, usersWithheld: 1 });
    expect(await getClose(db, userId, MON)).toMatchObject({ status: 'final', level: 'complete' });
    expect(await getStreak(db, userId)).toMatchObject({ days: 1, firstStreakAwarded: false });
    expect(await getPoints(db, userId)).toEqual([]);

    // After the review (alert closed), she earns again; the withheld day is not paid back.
    await db.update(alerts).set({ status: 'reviewed' }).where(eq(alerts.userId, userId));
    await recordClose(db, userId, TUE, 'complete');
    await run(userId, pointsDeadline(TUE));
    expect(total(await getPoints(db, userId))).toBe(10);
  });

  it('case 19: waits a few minutes for a close reply still in process at 12:00', async () => {
    const userId = await newUser();
    await recordClose(db, userId, MON, 'sent');
    const deadline = pointsDeadline(MON);
    await db.insert(inboundMessages).values({
      waMessageId: `wamid.test.${randomUUID()}`,
      userId,
      type: 'text',
      receivedAt: new Date(deadline.getTime() - 2 * MINUTE_MS),
      status: 'processing',
    });
    const deferred = await run(userId, deadline);
    expect(deferred).toMatchObject({ daysFinalized: 0, deferredUsers: 1 });

    // The reply landed in time meanwhile.
    await db
      .update(dailyCloses)
      .set({
        status: 'replied',
        repliedAt: new Date(deadline.getTime() - MINUTE_MS),
        level: 'complete',
      })
      .where(and(eq(dailyCloses.userId, userId), eq(dailyCloses.businessDay, MON)));
    await db
      .update(inboundMessages)
      .set({ status: 'recorded' })
      .where(eq(inboundMessages.userId, userId));
    const after = await run(userId, new Date(deadline.getTime() + 2 * MINUTE_MS));
    expect(after).toMatchObject({ daysFinalized: 1, pointsAwarded: 10 });
  });

  it('never waits more than an hour after the deadline', async () => {
    const userId = await newUser();
    await recordClose(db, userId, MON, 'sent');
    const deadline = pointsDeadline(MON);
    await db.insert(inboundMessages).values({
      waMessageId: `wamid.test.${randomUUID()}`,
      userId,
      type: 'text',
      receivedAt: new Date(deadline.getTime() - MINUTE_MS),
      status: 'received',
    });
    const summary = await run(userId, new Date(deadline.getTime() + 61 * MINUTE_MS));
    expect(summary).toMatchObject({ daysFinalized: 1, deferredUsers: 0 });
  });

  it('ignores FRI before its deadline', async () => {
    const userId = await newUser();
    await recordClose(db, userId, FRI, 'complete');
    const summary = await run(userId, limaInstant(addDays(FRI, 1), 11, 59));
    expect(summary.daysFinalized).toBe(0);
  });
});
