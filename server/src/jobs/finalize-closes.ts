/**
 * Daily 12:00 (8.4, RF-PT-01..04, 9.2, 11.9, 13.1, HU-08): the close of each past business day
 * becomes final, with its points, streak, freezes and bonuses; its unresolved doubts move to the
 * web. Monday 12:00 also gives the weekly bonus: it is awarded when Sunday becomes final, which
 * happens on Monday at 12:00 (same run, right after Sunday).
 *
 * For every active user (consented, onboarding complete, not deleted) and every business day D
 * whose deadline (12:00 of D+1) has passed and is not final yet, oldest first:
 *
 * 1. A `daily_closes` row exists for D (created when no close was ever sent: «sin actividad»).
 * 2. Final level (11.9): no close sent → `no_close`; sent and not answered before the deadline →
 *    `no_close` (cash check `no_answer`); answered in time → the level stored by the close flow
 *    (or, if none was stored, the one of 11.9 from her doubts and cash check). A reply that came
 *    after the deadline (case 20) only counts as `improved_level`, without points (D17).
 * 3. `applyDailyClose` (13.1): 10/4 points, streak, 2 freezes per ISO week used automatically,
 *    +20/+50 streak bonuses, +30 first streak. On a Sunday, `weeklyBonus` over Monday–Sunday.
 * 4. Doubts still `open`/`in_message` → `in_web` (9.2).
 *
 * Each day is one transaction (close, points entries, streak, doubts). Idempotent: a day with
 * `final_at` is never touched again, points entries carry the close id as `reference_id` and an
 * award type already written for that close is never written twice, and a per-user advisory lock
 * serializes overlapping runs. A missed run is caught up: every non-final past day is processed,
 * in order, on the next run.
 *
 * Antifraud (13.4, case 22): while she has an open `duplicate_account_holder` alert, her days
 * are still finalized and her streak still moves, but no points entries are written (and the
 * first-streak bonus stays available for later). Points are not given back after the review.
 *
 * A close reply still being processed when the deadline passes (received in the last 10 minutes
 * before 12:00) defers her last day for a few minutes, so the reply counts (case 19). Never more
 * than an hour after the deadline.
 */
import {
  and,
  asc,
  between,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  max,
  min,
} from 'drizzle-orm';
import { hasOpenHolderConflict } from '../antifraud/holder-conflict.js';
import type { Db } from '../db/client.js';
import {
  type CashCheckResult,
  type CloseLevel,
  clarifications,
  consents,
  type DailyClose,
  dailyCloses,
  inboundMessages,
  ledgerEntries,
  pointsEntries,
  type Streak,
  streaks,
} from '../db/schema.js';
import {
  addDays,
  applyDailyClose,
  businessDayOf,
  finalCloseLevel,
  HOUR_MS,
  INITIAL_STREAK,
  type IsoDate,
  improvedLevel,
  isoWeekOf,
  isSunday,
  MINUTE_MS,
  type PointsAward,
  pointsDeadline,
  type StreakState,
  weeklyBonus,
  weekStart,
} from '../domain/index.js';
import { inTransaction, type Tx } from '../ledger/types.js';
import type { Logger } from '../lib/logger.js';
import { listActiveUserIds } from './active-users.js';
import { daysFromTo, lastFinalizableDay } from './calendar.js';
import { lockUserPoints } from './locks.js';
import type { JobScope } from './types.js';

/** Messages received this long before the deadline and still in process defer the day. */
export const DEFER_WINDOW_MS = 10 * MINUTE_MS;
/** After the deadline + this, the day is finalized even with messages in process. */
export const MAX_DEFER_MS = HOUR_MS;
/** Inbound statuses that mean «still being processed» (9.2). */
const IN_FLIGHT_STATUSES = ['received', 'processing', 'error'] as const;
/** Doubts that move to the web when the day becomes final (9.2). */
const TO_WEB_STATUSES = ['open', 'in_message'] as const;

export interface DayOutcome {
  businessDay: IsoDate;
  closeId: string;
  level: CloseLevel;
  /** Points entries written for this day (empty when withheld). */
  awards: PointsAward[];
  points: number;
  freezeUsed: boolean;
  streakBroken: boolean;
  streakDays: number;
  weeklyBonus: boolean;
  /** Open holder alert (13.4): finalized without points. */
  pointsWithheld: boolean;
  clarificationsToWeb: number;
}

export interface FinalizeUserResult {
  userId: string;
  days: DayOutcome[];
  /** Her last day waits for a close reply still in process. */
  deferred: boolean;
}

export interface FinalizeRunSummary {
  /** Latest business day due at `now`. */
  lastDay: IsoDate;
  users: number;
  daysFinalized: number;
  pointsAwarded: number;
  weeklyBonuses: number;
  usersWithheld: number;
  deferredUsers: number;
  failedUsers: number;
}

// ---------------------------------------------------------------------------
// Which days
// ---------------------------------------------------------------------------

/**
 * First day the job counts for her: her first activity (an entry, a doubt or a close), never
 * before she consented. Days before she started are not «sin cierre». Null: nothing yet.
 */
async function firstCountedDay(db: Db, userId: string): Promise<IsoDate | null> {
  const [[close], [entry], [doubt], [consent]] = await Promise.all([
    db
      .select({ day: min(dailyCloses.businessDay) })
      .from(dailyCloses)
      .where(eq(dailyCloses.userId, userId)),
    db
      .select({ day: min(ledgerEntries.businessDay) })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.userId, userId)),
    db
      .select({ day: min(clarifications.businessDay) })
      .from(clarifications)
      .where(eq(clarifications.userId, userId)),
    db
      .select({ at: min(consents.createdAt) })
      .from(consents)
      .where(and(eq(consents.userId, userId), eq(consents.accepted, true))),
  ]);
  const activity = [close?.day, entry?.day, doubt?.day]
    .filter((day): day is IsoDate => typeof day === 'string')
    .sort()[0];
  if (!activity) return null;
  const consentDay = consent?.at ? businessDayOf(consent.at) : null;
  return consentDay && consentDay > activity ? consentDay : activity;
}

/** Non-final days up to `lastDay`, oldest first, starting after her latest final day. */
export async function daysToFinalize(db: Db, userId: string, lastDay: IsoDate): Promise<IsoDate[]> {
  const [[lastFinal], nonFinal] = await Promise.all([
    db
      .select({ day: max(dailyCloses.businessDay) })
      .from(dailyCloses)
      .where(and(eq(dailyCloses.userId, userId), isNotNull(dailyCloses.finalAt))),
    db
      .select({ day: dailyCloses.businessDay })
      .from(dailyCloses)
      .where(
        and(
          eq(dailyCloses.userId, userId),
          isNull(dailyCloses.finalAt),
          lte(dailyCloses.businessDay, lastDay),
        ),
      )
      .orderBy(asc(dailyCloses.businessDay))
      .limit(1),
  ]);
  let start = lastFinal?.day ? addDays(lastFinal.day, 1) : await firstCountedDay(db, userId);
  const firstNonFinal = nonFinal[0]?.day;
  if (firstNonFinal && (start === null || firstNonFinal < start)) start = firstNonFinal;
  if (start === null || start > lastDay) return [];

  const finalRows = await db
    .select({ day: dailyCloses.businessDay })
    .from(dailyCloses)
    .where(
      and(
        eq(dailyCloses.userId, userId),
        isNotNull(dailyCloses.finalAt),
        between(dailyCloses.businessDay, start, lastDay),
      ),
    );
  const final = new Set(finalRows.map((row) => row.day));
  return daysFromTo(start, lastDay).filter((day) => !final.has(day));
}

/** A message from her near the deadline is still in the pipeline (maybe her close reply). */
async function hasMessagesInFlight(
  db: Db,
  userId: string,
  day: IsoDate,
  now: Date,
): Promise<boolean> {
  const deadline = pointsDeadline(day);
  if (now.getTime() - deadline.getTime() > MAX_DEFER_MS) return false;
  const rows = await db
    .select({ id: inboundMessages.id })
    .from(inboundMessages)
    .where(
      and(
        eq(inboundMessages.userId, userId),
        inArray(inboundMessages.status, [...IN_FLIGHT_STATUSES]),
        gte(inboundMessages.receivedAt, new Date(deadline.getTime() - DEFER_WINDOW_MS)),
        lt(inboundMessages.receivedAt, deadline),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// One day
// ---------------------------------------------------------------------------

interface FinalLevel {
  level: CloseLevel;
  improvedLevel: CloseLevel | null;
  cashCheck: CashCheckResult | null;
}

/** 11.9 at 12:00 of D+1, plus case 20 (late reply → improved level only). */
async function finalLevelOf(tx: Tx, close: DailyClose): Promise<FinalLevel> {
  const deadline = pointsDeadline(close.businessDay).getTime();
  const closeSent = close.sentAt !== null;
  const repliedInTime = close.repliedAt !== null && close.repliedAt.getTime() < deadline;

  let level: CloseLevel = 'no_close';
  if (closeSent && repliedInTime) {
    if (close.level !== null) {
      level = close.level;
    } else {
      const inMessage = await tx
        .select({ status: clarifications.status })
        .from(clarifications)
        .where(
          and(
            eq(clarifications.userId, close.userId),
            eq(clarifications.businessDay, close.businessDay),
            isNotNull(clarifications.messageNumber),
          ),
        );
      level = finalCloseLevel({
        closeSent,
        repliedInTime,
        messageClarificationsResolved: inMessage.every(
          (row) => row.status === 'resolved' || row.status === 'resolved_web',
        ),
        cashCheck: close.cashCheck,
      });
    }
  }

  let improved = close.improvedLevel;
  if (level === 'no_close' && close.level !== null && close.level !== 'no_close') {
    improved =
      improvedLevel({
        finalLevel: 'no_close',
        currentImprovedLevel: improved,
        newLevel: close.level,
      }) ?? improved;
  }
  const cashCheck =
    closeSent && close.repliedAt === null && close.cashCheck === null
      ? 'no_answer'
      : close.cashCheck;
  return { level, improvedLevel: improved, cashCheck };
}

function toStreakState(row: Streak | undefined): StreakState {
  if (!row) return { ...INITIAL_STREAK };
  return {
    days: row.days,
    // The demo seed stores '' before the first close.
    isoWeek: row.isoWeek === '' ? null : row.isoWeek,
    freezesUsed: row.freezesUsed,
    firstStreakAwarded: row.firstStreakAwarded,
  };
}

/** Monday–Saturday are already final when Sunday is (days go in order). */
async function weeklyBonusFor(
  tx: Tx,
  userId: string,
  sunday: IsoDate,
  sundayLevel: CloseLevel,
): Promise<PointsAward | null> {
  const rows = await tx
    .select({ level: dailyCloses.level })
    .from(dailyCloses)
    .where(
      and(
        eq(dailyCloses.userId, userId),
        gte(dailyCloses.businessDay, weekStart(sunday)),
        lt(dailyCloses.businessDay, sunday),
        isNotNull(dailyCloses.finalAt),
      ),
    );
  return weeklyBonus([...rows.map((row) => row.level ?? 'no_close'), sundayLevel]);
}

/** Awards not yet written for this close (the unique reference guard). */
async function notYetWritten(
  tx: Tx,
  userId: string,
  closeId: string,
  awards: readonly PointsAward[],
): Promise<PointsAward[]> {
  if (awards.length === 0) return [];
  const existing = await tx
    .select({ type: pointsEntries.type })
    .from(pointsEntries)
    .where(and(eq(pointsEntries.userId, userId), eq(pointsEntries.referenceId, closeId)));
  const written = new Set(existing.map((row) => row.type));
  return awards.filter((award) => !written.has(award.type));
}

/**
 * Makes day D final for her, in one transaction. Returns null when it already was (another run
 * did it).
 */
export async function finalizeDay(
  db: Db,
  userId: string,
  day: IsoDate,
  now: Date,
): Promise<DayOutcome | null> {
  return inTransaction(db, async (tx) => {
    await lockUserPoints(tx, userId);
    await tx
      .insert(dailyCloses)
      .values({ userId, businessDay: day, status: 'open', createdAt: now })
      .onConflictDoNothing({ target: [dailyCloses.userId, dailyCloses.businessDay] });
    const [close] = await tx
      .select()
      .from(dailyCloses)
      .where(and(eq(dailyCloses.userId, userId), eq(dailyCloses.businessDay, day)))
      .for('update');
    if (!close) throw new Error('daily close row missing');
    if (close.finalAt !== null) return null;

    const final = await finalLevelOf(tx, close);
    const [streakRow] = await tx
      .select()
      .from(streaks)
      .where(eq(streaks.userId, userId))
      .for('update');
    const before = toStreakState(streakRow);
    const result = applyDailyClose(before, day, final.level);
    const withheld = await hasOpenHolderConflict(tx, userId);

    const candidates = [...result.awards];
    const bonus = isSunday(day) ? await weeklyBonusFor(tx, userId, day, final.level) : null;
    if (bonus) candidates.push(bonus);
    const awards = withheld ? [] : await notYetWritten(tx, userId, close.id, candidates);
    if (awards.length > 0) {
      await tx.insert(pointsEntries).values(
        awards.map((award) => ({
          userId,
          type: award.type,
          points: award.points,
          referenceId: close.id,
          createdAt: now,
        })),
      );
    }

    // Withheld: the first-streak bonus was not given, so it stays available.
    const state = withheld
      ? { ...result.state, firstStreakAwarded: before.firstStreakAwarded }
      : result.state;
    const streakValues = {
      days: state.days,
      isoWeek: state.isoWeek ?? isoWeekOf(day),
      freezesUsed: state.freezesUsed,
      firstStreakAwarded: state.firstStreakAwarded,
    };
    await tx
      .insert(streaks)
      .values({ userId, ...streakValues })
      .onConflictDoUpdate({ target: streaks.userId, set: streakValues });

    await tx
      .update(dailyCloses)
      .set({
        status: 'final',
        level: final.level,
        improvedLevel: final.improvedLevel,
        cashCheck: final.cashCheck,
        finalAt: now,
      })
      .where(eq(dailyCloses.id, close.id));

    const moved = await tx
      .update(clarifications)
      .set({ status: 'in_web' })
      .where(
        and(
          eq(clarifications.userId, userId),
          eq(clarifications.businessDay, day),
          inArray(clarifications.status, [...TO_WEB_STATUSES]),
        ),
      )
      .returning({ id: clarifications.id });

    return {
      businessDay: day,
      closeId: close.id,
      level: final.level,
      awards,
      points: awards.reduce((total, award) => total + award.points, 0),
      freezeUsed: result.freezeUsed,
      streakBroken: result.streakBroken,
      streakDays: state.days,
      weeklyBonus: awards.some((award) => award.type === 'weekly_bonus'),
      pointsWithheld: withheld,
      clarificationsToWeb: moved.length,
    };
  });
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/** Every due day of one user, oldest first. */
export async function finalizeUserCloses(
  db: Db,
  userId: string,
  now: Date,
): Promise<FinalizeUserResult> {
  const lastDay = lastFinalizableDay(now);
  const days = await daysToFinalize(db, userId, lastDay);
  const outcomes: DayOutcome[] = [];
  for (const day of days) {
    if (await hasMessagesInFlight(db, userId, day, now)) {
      return { userId, days: outcomes, deferred: true };
    }
    const outcome = await finalizeDay(db, userId, day, now);
    if (outcome) outcomes.push(outcome);
  }
  return { userId, days: outcomes, deferred: false };
}

/** The 12:00 task. One user's failure is logged and does not stop the others. */
export async function finalizeDueCloses(
  deps: { db: Db; logger: Logger },
  now: Date,
  scope?: JobScope,
): Promise<FinalizeRunSummary> {
  const summary: FinalizeRunSummary = {
    lastDay: lastFinalizableDay(now),
    users: 0,
    daysFinalized: 0,
    pointsAwarded: 0,
    weeklyBonuses: 0,
    usersWithheld: 0,
    deferredUsers: 0,
    failedUsers: 0,
  };
  for (const userId of await listActiveUserIds(deps.db, scope)) {
    summary.users += 1;
    try {
      const result = await finalizeUserCloses(deps.db, userId, now);
      summary.daysFinalized += result.days.length;
      summary.pointsAwarded += result.days.reduce((total, day) => total + day.points, 0);
      summary.weeklyBonuses += result.days.filter((day) => day.weeklyBonus).length;
      if (result.days.some((day) => day.pointsWithheld)) summary.usersWithheld += 1;
      if (result.deferred) summary.deferredUsers += 1;
    } catch (err) {
      summary.failedUsers += 1;
      deps.logger.error({ err, userId }, 'finalize closes failed for user');
    }
  }
  return summary;
}
