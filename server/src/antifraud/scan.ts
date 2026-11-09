/**
 * Daily antifraud scan (13.4, D22, RF-AD-02): writes `open` alerts for the panel, never blocks.
 *
 * - `shared_screenshot`: the same file (SHA-256) sent from different accounts. Files of the last
 *   `SHARED_SCREENSHOT_LOOKBACK_DAYS` are compared with every account's files (rows stay after the
 *   30-day purge, PR07). One alert per later account and file.
 * - `activity_spike`: entries she recorded through WhatsApp in the last full week (Monday–Sunday)
 *   above 3× her weekly average of the 4 weeks before (only weeks since she started). One alert
 *   per account and week.
 * - `instant_close_replies`: her replied closes of the last 28 days are all answered within 15 s
 *   and all «sí» (cash check `balanced`), at least 5 of them. Not raised again while one is open;
 *   after a review, only closes sent after it count.
 *
 * Alerts keep ids, counts and hashes only: no names, amounts or message text.
 */
import {
  type AnyColumn,
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  min,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { alerts, consents, dailyCloses, ledgerEntries, mediaFiles, users } from '../db/schema.js';
import {
  addDays,
  businessDayOf,
  DAY_MS,
  type IsoDate,
  isoWeekOf,
  weekStart,
} from '../domain/index.js';
import type { Logger } from '../lib/logger.js';
import {
  ACTIVITY_BASELINE_WEEKS,
  ACTIVITY_SPIKE_ALERT,
  type CloseReplyTiming,
  detectActivitySpike,
  detectInstantYesReplies,
  INSTANT_REPLIES_ALERT,
  INSTANT_REPLY_LOOKBACK_DAYS,
  type MediaSighting,
  SHARED_SCREENSHOT_ALERT,
  SHARED_SCREENSHOT_LOOKBACK_DAYS,
  sharedScreenshotFlags,
} from './rules.js';

/** Same shape as the jobs' scope (jobs/types.ts), redeclared to keep this module standalone. */
export interface AntifraudScope {
  userIds?: readonly string[];
}

/** Entries she recorded herself through WhatsApp (not web/chat edits, not close replies). */
const WHATSAPP_SOURCES = ['screenshot', 'activity_list', 'text', 'audio'] as const;

export interface AntifraudScanSummary {
  sharedScreenshot: number;
  activitySpike: number;
  instantCloseReplies: number;
}

const inScope = (column: AnyColumn, scope?: AntifraudScope): SQL | undefined =>
  scope?.userIds ? inArray(column, [...scope.userIds]) : undefined;

async function insertAlert(
  db: Db,
  userId: string,
  type: string,
  detail: Record<string, unknown>,
  now: Date,
): Promise<void> {
  await db.insert(alerts).values({ userId, type, status: 'open', detail, createdAt: now });
}

// ---------------------------------------------------------------------------
// Same screenshot from different accounts
// ---------------------------------------------------------------------------

export async function scanSharedScreenshots(
  db: Db,
  now: Date,
  scope?: AntifraudScope,
): Promise<number> {
  const since = new Date(now.getTime() - SHARED_SCREENSHOT_LOOKBACK_DAYS * DAY_MS);
  const recent = await db
    .selectDistinct({ sha256: mediaFiles.sha256 })
    .from(mediaFiles)
    .innerJoin(users, eq(users.id, mediaFiles.userId))
    .where(
      and(
        gte(mediaFiles.createdAt, since),
        lte(mediaFiles.createdAt, now),
        isNull(users.deletedAt),
        inScope(mediaFiles.userId, scope),
      ),
    );
  if (recent.length === 0) return 0;

  const sightings: MediaSighting[] = (
    await db
      .select({
        userId: mediaFiles.userId,
        sha256: mediaFiles.sha256,
        mediaFileId: mediaFiles.id,
        firstSeenAt: mediaFiles.createdAt,
      })
      .from(mediaFiles)
      .innerJoin(users, eq(users.id, mediaFiles.userId))
      .where(
        and(
          inArray(
            mediaFiles.sha256,
            recent.map((row) => row.sha256),
          ),
          isNull(users.deletedAt),
          inScope(mediaFiles.userId, scope),
        ),
      )
  ).filter((row) => row.firstSeenAt.getTime() <= now.getTime());

  let created = 0;
  for (const flag of sharedScreenshotFlags(sightings)) {
    const [existing] = await db
      .select({ id: alerts.id })
      .from(alerts)
      .where(
        and(
          eq(alerts.userId, flag.userId),
          eq(alerts.type, SHARED_SCREENSHOT_ALERT),
          sql`${alerts.detail}->>'sha256' = ${flag.sha256}`,
        ),
      )
      .limit(1);
    if (existing) continue;
    await insertAlert(
      db,
      flag.userId,
      SHARED_SCREENSHOT_ALERT,
      { sha256: flag.sha256, mediaFileId: flag.mediaFileId, firstUserId: flag.firstUserId },
      now,
    );
    created += 1;
  }
  return created;
}

// ---------------------------------------------------------------------------
// Activity spike
// ---------------------------------------------------------------------------

export async function scanActivitySpikes(
  db: Db,
  now: Date,
  scope?: AntifraudScope,
): Promise<number> {
  // The last full week (Monday–Sunday) before the current business week, and the 4 before it.
  const currentMonday = addDays(weekStart(businessDayOf(now)), -7);
  const firstBaselineMonday = addDays(currentMonday, -7 * ACTIVITY_BASELINE_WEEKS);
  const lastDay = addDays(currentMonday, 6);

  const rows = await db
    .select({
      userId: ledgerEntries.userId,
      businessDay: ledgerEntries.businessDay,
      count: sql<number>`count(*)::int`,
    })
    .from(ledgerEntries)
    .innerJoin(users, eq(users.id, ledgerEntries.userId))
    .where(
      and(
        gte(ledgerEntries.businessDay, firstBaselineMonday),
        lte(ledgerEntries.businessDay, lastDay),
        inArray(ledgerEntries.source, [...WHATSAPP_SOURCES]),
        isNull(ledgerEntries.replacesEntryId),
        isNull(users.deletedAt),
        inScope(ledgerEntries.userId, scope),
      ),
    )
    .groupBy(ledgerEntries.userId, ledgerEntries.businessDay);

  const perUser = new Map<string, Map<IsoDate, number>>();
  for (const row of rows) {
    const weeks = perUser.get(row.userId) ?? new Map<IsoDate, number>();
    const monday = weekStart(row.businessDay);
    weeks.set(monday, (weeks.get(monday) ?? 0) + Number(row.count));
    perUser.set(row.userId, weeks);
  }
  const week = isoWeekOf(currentMonday);

  let created = 0;
  for (const [userId, weeks] of perUser) {
    const current = weeks.get(currentMonday) ?? 0;
    if (current === 0) continue;
    const started = await startedWeek(db, userId);
    const baseline: number[] = [];
    for (let i = ACTIVITY_BASELINE_WEEKS; i >= 1; i--) {
      const monday = addDays(currentMonday, -7 * i);
      if (started === null || monday < started) continue;
      baseline.push(weeks.get(monday) ?? 0);
    }
    const spike = detectActivitySpike({ currentWeekCount: current, baselineWeekCounts: baseline });
    if (!spike) continue;
    const [existing] = await db
      .select({ id: alerts.id })
      .from(alerts)
      .where(
        and(
          eq(alerts.userId, userId),
          eq(alerts.type, ACTIVITY_SPIKE_ALERT),
          sql`${alerts.detail}->>'week' = ${week}`,
        ),
      )
      .limit(1);
    if (existing) continue;
    await insertAlert(db, userId, ACTIVITY_SPIKE_ALERT, { week, ...spike }, now);
    created += 1;
  }
  return created;
}

/** Monday of the first week fully hers: the week after the one she consented in. */
async function startedWeek(db: Db, userId: string): Promise<IsoDate | null> {
  const [consent] = await db
    .select({ at: min(consents.createdAt) })
    .from(consents)
    .where(and(eq(consents.userId, userId), eq(consents.accepted, true)));
  const [user] = await db
    .select({ createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId));
  const at = consent?.at ?? user?.createdAt;
  if (!at) return null;
  const monday = weekStart(businessDayOf(at));
  // A week she joined midway is not a full week of habit.
  return businessDayOf(at) === monday ? monday : addDays(monday, 7);
}

// ---------------------------------------------------------------------------
// Instant «sí» replies
// ---------------------------------------------------------------------------

export async function scanInstantCloseReplies(
  db: Db,
  now: Date,
  scope?: AntifraudScope,
): Promise<number> {
  const today = businessDayOf(now);
  const fromDay = addDays(today, -INSTANT_REPLY_LOOKBACK_DAYS);
  const closes = await db
    .select({
      userId: dailyCloses.userId,
      sentAt: dailyCloses.sentAt,
      repliedAt: dailyCloses.repliedAt,
      cashCheck: dailyCloses.cashCheck,
    })
    .from(dailyCloses)
    .innerJoin(users, eq(users.id, dailyCloses.userId))
    .where(
      and(
        gte(dailyCloses.businessDay, fromDay),
        lte(dailyCloses.businessDay, today),
        isNotNull(dailyCloses.sentAt),
        isNotNull(dailyCloses.repliedAt),
        isNull(users.deletedAt),
        inScope(dailyCloses.userId, scope),
      ),
    );

  const perUser = new Map<string, CloseReplyTiming[]>();
  for (const close of closes) {
    if (!close.sentAt || !close.repliedAt || close.repliedAt.getTime() > now.getTime()) continue;
    const list = perUser.get(close.userId) ?? [];
    list.push({ sentAt: close.sentAt, repliedAt: close.repliedAt, cashCheck: close.cashCheck });
    perUser.set(close.userId, list);
  }

  let created = 0;
  for (const [userId, replies] of perUser) {
    const [latest] = await db
      .select({ status: alerts.status, createdAt: alerts.createdAt })
      .from(alerts)
      .where(and(eq(alerts.userId, userId), eq(alerts.type, INSTANT_REPLIES_ALERT)))
      .orderBy(desc(alerts.createdAt))
      .limit(1);
    if (latest?.status === 'open') continue;
    const considered = latest
      ? replies.filter((reply) => reply.sentAt.getTime() > latest.createdAt.getTime())
      : replies;
    const pattern = detectInstantYesReplies(considered);
    if (!pattern) continue;
    await insertAlert(
      db,
      userId,
      INSTANT_REPLIES_ALERT,
      { fromDay, toDay: today, closes: pattern.closes, slowestReplyMs: pattern.slowestReplyMs },
      now,
    );
    created += 1;
  }
  return created;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/** The daily task. Each detection runs on its own; a failure is logged and the rest go on. */
export async function runAntifraudScan(
  deps: { db: Db; logger: Logger },
  now: Date,
  scope?: AntifraudScope,
): Promise<AntifraudScanSummary & { failed: number }> {
  const summary = { sharedScreenshot: 0, activitySpike: 0, instantCloseReplies: 0, failed: 0 };
  const detections = [
    ['sharedScreenshot', scanSharedScreenshots],
    ['activitySpike', scanActivitySpikes],
    ['instantCloseReplies', scanInstantCloseReplies],
  ] as const;
  for (const [key, scan] of detections) {
    try {
      summary[key] = await scan(deps.db, now, scope);
    } catch (err) {
      summary.failed += 1;
      deps.logger.error({ err, detection: key }, 'antifraud detection failed');
    }
  }
  return summary;
}
