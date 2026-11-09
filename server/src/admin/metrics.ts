/**
 * Basic metrics of 13.5 for the panel (RF-AD-03). Aggregates only: counts and rates, never
 * amounts, names or texts. Business days come from `domain/` (D12), never from SQL dates.
 *
 * Windows and definitions (shown next to each number in the panel):
 * - «Usuaria activa» in a period: at least one message received (not discarded for lack of
 *   consent), one ledger entry or one close message sent in it.
 * - Closes and replies: business days of the last 28 days. Complete closes per week: the last 4
 *   full weeks (Monday–Sunday), final levels only.
 * - Cost and web use: the last 7 days. Web use is approximate: there is no page-view tracking, so
 *   it counts a PIN check, a new remembered phone, a chat question, a download, a redemption or a
 *   change made from the web.
 * - «Tasa de captura (piloto)» and «Primer producto financiero» need the pilot or BCP data and
 *   are not computed here.
 *
 * `scope` limits user tables to some users (tests share one database); the waitlist is global.
 */
import {
  type AnyColumn,
  and,
  count,
  countDistinct,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  chatMessages,
  dailyCloses,
  inboundMessages,
  ledgerEntries,
  outboundMessages,
  pins,
  type RedemptionStatus,
  redemptions,
  reports,
  streaks,
  trustedDevices,
  users,
  waitlistSignups,
} from '../db/schema.js';
import {
  addDays,
  businessDayOf,
  businessDayStart,
  DAY_MS,
  type IsoDate,
  weekStart,
} from '../domain/index.js';

export const CLOSES_WINDOW_DAYS = 28;
export const RECENT_WINDOW_DAYS = 7;
export const WEEKS_SHOWN = 4;
/** «Registro constante» (13.5): ≥ 5 complete closes a week, 4 weeks in a row. */
export const CONSISTENT_MIN_COMPLETE = 5;
export const CONSISTENT_WEEKS = 4;
/** A screenshot that went through reading (not an error, not a non-financial image). */
const READ_IMAGE_STATUSES = ['recorded', 'pending', 'unreadable', 'duplicate'] as const;

export interface MetricsScope {
  userIds?: readonly string[];
}

export interface Ratio {
  numerator: number;
  denominator: number;
  /** numerator ÷ denominator, 0–1; null when the denominator is 0. */
  rate: number | null;
}

export interface WeekCloses {
  weekStart: IsoDate;
  completeCloses: number;
  activeUsers: number;
  /** Complete closes per active user that week. */
  average: number | null;
}

export interface MetricsView {
  generatedAt: string;
  today: IsoDate;
  windows: { closesDays: number; recentDays: number; weeks: number };
  activation: { onboardingComplete: Ratio; pinCreated: Ratio };
  habit: {
    closesReplied: Ratio;
    completeClosesPerWeek: WeekCloses[];
    averageStreakDays: number | null;
    usersWithStreak: number;
  };
  quality: { withoutClarification: Ratio; unreadable: Ratio };
  cost: {
    outbound: number;
    activeUserDays: number;
    perUserPerDay: number | null;
    byType: { type: string; count: number }[];
  };
  web: { weeklyUse: Ratio };
  rewardsAndReports: { redemptions: Record<RedemptionStatus, number>; reports: number };
  impact: { consistentRecording: number; historyReady: number };
  waitlist: { signups: number };
}

const ratio = (numerator: number, denominator: number): Ratio => ({
  numerator,
  denominator,
  rate: denominator > 0 ? numerator / denominator : null,
});

/** Users that are not deleted and inside the scope. */
function liveUsers(column: AnyColumn, scope: MetricsScope): SQL {
  const deleted = sql`not exists (select 1 from ${users} where ${users.id} = ${column} and ${users.deletedAt} is not null)`;
  return scope.userIds
    ? (and(inArray(column, [...scope.userIds]), deleted) as SQL)
    : (deleted as SQL);
}

/**
 * Who was active, per business day, in [fromDay, toDay]: messages, entries and close messages.
 * Returns `userId → set of business days`.
 */
async function activityByDay(
  db: Db,
  scope: MetricsScope,
  fromDay: IsoDate,
  toDay: IsoDate,
): Promise<Map<string, Set<IsoDate>>> {
  const from = businessDayStart(fromDay);
  const to = businessDayStart(addDays(toDay, 1));
  const [messages, entries, closes] = await Promise.all([
    db
      .select({ userId: inboundMessages.userId, at: inboundMessages.receivedAt })
      .from(inboundMessages)
      .where(
        and(
          gte(inboundMessages.receivedAt, from),
          lt(inboundMessages.receivedAt, to),
          ne(inboundMessages.status, 'discarded_no_consent'),
          liveUsers(inboundMessages.userId, scope),
        ),
      ),
    db
      .selectDistinct({ userId: ledgerEntries.userId, day: ledgerEntries.businessDay })
      .from(ledgerEntries)
      .where(
        and(
          gte(ledgerEntries.businessDay, fromDay),
          lte(ledgerEntries.businessDay, toDay),
          liveUsers(ledgerEntries.userId, scope),
        ),
      ),
    db
      .select({ userId: dailyCloses.userId, day: dailyCloses.businessDay })
      .from(dailyCloses)
      .where(
        and(
          gte(dailyCloses.businessDay, fromDay),
          lte(dailyCloses.businessDay, toDay),
          isNotNull(dailyCloses.sentAt),
          liveUsers(dailyCloses.userId, scope),
        ),
      ),
  ]);
  const byUser = new Map<string, Set<IsoDate>>();
  const add = (userId: string, day: IsoDate) => {
    const days = byUser.get(userId) ?? new Set<IsoDate>();
    days.add(day);
    byUser.set(userId, days);
  };
  for (const row of messages) add(row.userId, businessDayOf(row.at));
  for (const row of entries) add(row.userId, row.day);
  for (const row of closes) add(row.userId, row.day);
  return byUser;
}

/** Users with ≥ 5 complete closes in each of 4 consecutive weeks, at any time. */
export function countConsistentUsers(
  completeDays: readonly { userId: string; businessDay: IsoDate }[],
): number {
  const perUser = new Map<string, Map<IsoDate, number>>();
  for (const row of completeDays) {
    const weeks = perUser.get(row.userId) ?? new Map<IsoDate, number>();
    const week = weekStart(row.businessDay);
    weeks.set(week, (weeks.get(week) ?? 0) + 1);
    perUser.set(row.userId, weeks);
  }
  let consistent = 0;
  for (const weeks of perUser.values()) {
    const good = [...weeks]
      .filter(([, n]) => n >= CONSISTENT_MIN_COMPLETE)
      .map(([week]) => week)
      .sort();
    let run = 0;
    let previous: IsoDate | null = null;
    let reached = false;
    for (const week of good) {
      run = previous !== null && addDays(previous, 7) === week ? run + 1 : 1;
      previous = week;
      if (run >= CONSISTENT_WEEKS) reached = true;
    }
    if (reached) consistent += 1;
  }
  return consistent;
}

export async function computeMetrics(
  db: Db,
  now: Date,
  scope: MetricsScope = {},
): Promise<MetricsView> {
  const today = businessDayOf(now);
  const closesFrom = addDays(today, -(CLOSES_WINDOW_DAYS - 1));
  const recentFromDay = addDays(today, -(RECENT_WINDOW_DAYS - 1));
  const recentSince = new Date(now.getTime() - RECENT_WINDOW_DAYS * DAY_MS);
  const currentWeek = weekStart(today);
  const firstWeek = addDays(currentWeek, -7 * WEEKS_SHOWN);
  const lastFullDay = addDays(currentWeek, -1);
  const userScope = scope.userIds ? inArray(users.id, [...scope.userIds]) : undefined;

  const [
    [signedUp],
    [complete],
    [withPin],
    [closes],
    [streak],
    [images],
    completeDays,
    outboundByType,
    redemptionCounts,
    [reportCounts],
    [waitlist],
    weekActivity,
    recentActivity,
    outboundRows,
    webUsers,
  ] = await Promise.all([
    db
      .select({ n: count() })
      .from(users)
      .where(and(isNull(users.deletedAt), userScope)),
    db
      .select({ n: count() })
      .from(users)
      .where(and(isNull(users.deletedAt), eq(users.onboardingStatus, 'complete'), userScope)),
    db
      .select({ n: count() })
      .from(users)
      .innerJoin(pins, eq(pins.userId, users.id))
      .where(and(isNull(users.deletedAt), eq(users.onboardingStatus, 'complete'), userScope)),
    db
      .select({
        sent: sql<number>`count(*) filter (where ${dailyCloses.sentAt} is not null)::int`,
        replied: sql<number>`count(*) filter (where ${dailyCloses.sentAt} is not null and ${dailyCloses.repliedAt} is not null)::int`,
        repliedNoClarification: sql<number>`count(*) filter (where ${dailyCloses.repliedAt} is not null and ${dailyCloses.clarificationRounds} = 0)::int`,
        repliedAny: sql<number>`count(*) filter (where ${dailyCloses.repliedAt} is not null)::int`,
      })
      .from(dailyCloses)
      .where(
        and(
          gte(dailyCloses.businessDay, closesFrom),
          lte(dailyCloses.businessDay, today),
          liveUsers(dailyCloses.userId, scope),
        ),
      ),
    db
      .select({
        average: sql<string | null>`avg(${streaks.days})`,
        users: count(),
      })
      .from(streaks)
      .where(liveUsers(streaks.userId, scope)),
    db
      .select({
        read: count(),
        unreadable: sql<number>`count(*) filter (where ${inboundMessages.status} = 'unreadable')::int`,
      })
      .from(inboundMessages)
      .where(
        and(
          eq(inboundMessages.type, 'image'),
          inArray(inboundMessages.status, [...READ_IMAGE_STATUSES]),
          gte(inboundMessages.receivedAt, businessDayStart(closesFrom)),
          liveUsers(inboundMessages.userId, scope),
        ),
      ),
    db
      .select({ userId: dailyCloses.userId, businessDay: dailyCloses.businessDay })
      .from(dailyCloses)
      .where(and(eq(dailyCloses.level, 'complete'), liveUsers(dailyCloses.userId, scope))),
    db
      .select({ type: outboundMessages.type, n: count() })
      .from(outboundMessages)
      .where(
        and(
          gte(outboundMessages.createdAt, recentSince),
          liveUsers(outboundMessages.userId, scope),
        ),
      )
      .groupBy(outboundMessages.type),
    db
      .select({ status: redemptions.status, n: count() })
      .from(redemptions)
      .where(liveUsers(redemptions.userId, scope))
      .groupBy(redemptions.status),
    db
      .select({ reports: count(), users: countDistinct(reports.userId) })
      .from(reports)
      .where(liveUsers(reports.userId, scope)),
    db.select({ n: count() }).from(waitlistSignups),
    activityByDay(db, scope, firstWeek, lastFullDay),
    activityByDay(db, scope, recentFromDay, today),
    db
      .select({ userId: outboundMessages.userId, at: outboundMessages.createdAt })
      .from(outboundMessages)
      .where(
        and(
          gte(outboundMessages.createdAt, recentSince),
          liveUsers(outboundMessages.userId, scope),
        ),
      ),
    webActiveUsers(db, scope, recentSince),
  ]);

  // Complete closes per week (last 4 full weeks).
  const completeCloses = completeDays.map((row) => ({
    userId: row.userId,
    businessDay: row.businessDay,
  }));
  const completeClosesPerWeek: WeekCloses[] = [];
  for (let i = 0; i < WEEKS_SHOWN; i++) {
    const start = addDays(firstWeek, 7 * i);
    const end = addDays(start, 6);
    const done = completeCloses.filter((r) => r.businessDay >= start && r.businessDay <= end);
    let active = 0;
    for (const days of weekActivity.values()) {
      if ([...days].some((day) => day >= start && day <= end)) active += 1;
    }
    completeClosesPerWeek.push({
      weekStart: start,
      completeCloses: done.length,
      activeUsers: active,
      average: active > 0 ? Math.round((done.length / active) * 100) / 100 : null,
    });
  }

  // Outbound messages per active user and day (last 7 days).
  const userDays = new Set<string>();
  for (const [userId, days] of recentActivity)
    for (const day of days) userDays.add(`${userId}|${day}`);
  for (const row of outboundRows) userDays.add(`${row.userId}|${businessDayOf(row.at)}`);
  const outbound = outboundRows.length;

  const recentActive = new Set(recentActivity.keys());
  const webAmongActive = [...webUsers].filter((id) => recentActive.has(id)).length;

  const redemptionsByStatus: Record<RedemptionStatus, number> = {
    delivered: 0,
    in_review: 0,
    rejected: 0,
  };
  for (const row of redemptionCounts) redemptionsByStatus[row.status] = row.n;

  const averageStreak =
    streak?.average === null || streak?.average === undefined ? null : Number(streak.average);

  return {
    generatedAt: now.toISOString(),
    today,
    windows: { closesDays: CLOSES_WINDOW_DAYS, recentDays: RECENT_WINDOW_DAYS, weeks: WEEKS_SHOWN },
    activation: {
      onboardingComplete: ratio(complete?.n ?? 0, signedUp?.n ?? 0),
      pinCreated: ratio(withPin?.n ?? 0, complete?.n ?? 0),
    },
    habit: {
      closesReplied: ratio(closes?.replied ?? 0, closes?.sent ?? 0),
      completeClosesPerWeek,
      averageStreakDays: averageStreak === null ? null : Math.round(averageStreak * 10) / 10,
      usersWithStreak: streak?.users ?? 0,
    },
    quality: {
      withoutClarification: ratio(closes?.repliedNoClarification ?? 0, closes?.repliedAny ?? 0),
      unreadable: ratio(images?.unreadable ?? 0, images?.read ?? 0),
    },
    cost: {
      outbound,
      activeUserDays: userDays.size,
      perUserPerDay: userDays.size > 0 ? Math.round((outbound / userDays.size) * 100) / 100 : null,
      byType: outboundByType
        .map((row) => ({ type: row.type, count: row.n }))
        .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    },
    web: { weeklyUse: ratio(webAmongActive, recentActive.size) },
    rewardsAndReports: { redemptions: redemptionsByStatus, reports: reportCounts?.reports ?? 0 },
    impact: {
      consistentRecording: countConsistentUsers(completeCloses),
      historyReady: reportCounts?.users ?? 0,
    },
    waitlist: { signups: waitlist?.n ?? 0 },
  };
}

/** Users who used the web since `since` (approximate, see the header). */
async function webActiveUsers(db: Db, scope: MetricsScope, since: Date): Promise<Set<string>> {
  const [devices, chats, downloads, redeemed, edits] = await Promise.all([
    db
      .selectDistinct({ userId: trustedDevices.userId })
      .from(trustedDevices)
      .where(
        and(
          or(gte(trustedDevices.pinVerifiedAt, since), gte(trustedDevices.createdAt, since)),
          liveUsers(trustedDevices.userId, scope),
        ),
      ),
    db
      .selectDistinct({ userId: chatMessages.userId })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.role, 'user'),
          gte(chatMessages.createdAt, since),
          liveUsers(chatMessages.userId, scope),
        ),
      ),
    db
      .selectDistinct({ userId: reports.userId })
      .from(reports)
      .where(and(gte(reports.createdAt, since), liveUsers(reports.userId, scope))),
    db
      .selectDistinct({ userId: redemptions.userId })
      .from(redemptions)
      .where(and(gte(redemptions.createdAt, since), liveUsers(redemptions.userId, scope))),
    db
      .selectDistinct({ userId: ledgerEntries.userId })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.source, 'web'),
          gte(ledgerEntries.createdAt, since),
          liveUsers(ledgerEntries.userId, scope),
        ),
      ),
  ]);
  return new Set([...devices, ...chats, ...downloads, ...redeemed, ...edits].map((r) => r.userId));
}
