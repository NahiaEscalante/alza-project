/**
 * Every 5 minutes (8.4, RF-CI-01/02, PR16): the close goes to every user whose close time has
 * passed for the current business day (a close time up to 02:00 belongs to the same business day,
 * D12), who wrote in the last 24 hours (WhatsApp's service window), whose day has at least one
 * entry or doubt, and who has no close sent yet. Idempotent: `sendDailyClose` re-checks all of
 * it under the per-day lock, so overlapping runs and «cierre» never send twice.
 */
import { and, eq, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { consents, users } from '../../db/schema.js';
import { businessDayOf, closeDueAt, DAY_MS, isValidCloseTime } from '../../domain/index.js';
import { consentTextVersion } from '../../messages/consent.js';
import { scheduleInLima } from '../../queue/boss.js';
import { sendDailyClose } from './send.js';
import type { CloseFlowDeps } from './types.js';

export const CLOSE_SENDER_QUEUE = 'close-sender';
export const CLOSE_SENDER_CRON = '*/5 * * * *';

export interface CloseSenderSummary {
  businessDay: string;
  candidates: number;
  sent: number;
  skipped: number;
  failed: number;
}

/** Runs the sender once at `now`. `userIds` limits it (tests share one database). */
export async function sendDueCloses(
  deps: CloseFlowDeps,
  now: Date,
  scope: { userIds?: readonly string[] } = {},
): Promise<CloseSenderSummary> {
  const day = businessDayOf(now);
  const latestConsentAccepted = sql`(
    select (${consents.accepted} and ${consents.textVersion} = ${consentTextVersion(deps.messagingApp)}) from ${consents}
    where ${consents.userId} = ${users.id}
    order by ${consents.createdAt} desc
    limit 1
  ) is true`;
  const rows = await deps.db
    .select()
    .from(users)
    .where(
      and(
        isNull(users.deletedAt),
        eq(users.onboardingStatus, 'complete'),
        isNotNull(users.closeTime),
        gte(users.lastMessageAt, new Date(now.getTime() - DAY_MS)),
        latestConsentAccepted,
        scope.userIds ? inArray(users.id, [...scope.userIds]) : undefined,
      ),
    )
    .orderBy(users.id);

  const summary: CloseSenderSummary = {
    businessDay: day,
    candidates: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
  };
  for (const user of rows) {
    if (!user.closeTime || !isValidCloseTime(user.closeTime)) continue;
    if (now.getTime() < closeDueAt(day, user.closeTime).getTime()) continue;
    summary.candidates += 1;
    try {
      const result = await sendDailyClose(
        { ...deps, now: () => now },
        { user, businessDay: day, trigger: 'scheduled' },
      );
      if (result.kind === 'sent') summary.sent += 1;
      else summary.skipped += 1;
    } catch (err) {
      summary.failed += 1;
      deps.logger.error({ err, userId: user.id, businessDay: day }, 'close send failed');
    }
  }
  return summary;
}

export interface CloseJobs {
  /** Runs the sender right away (demo, panel), with the given clock or the deps' one. */
  runNow(now?: Date, scope?: { userIds?: readonly string[] }): Promise<CloseSenderSummary>;
}

/**
 * Creates the `close-sender` queue, schedules it every 5 minutes in America/Lima and starts its
 * worker. Call once at startup, after `startBoss`. A failed user is retried on the next tick.
 */
export async function registerCloseJobs(boss: PgBoss, deps: CloseFlowDeps): Promise<CloseJobs> {
  // No retries: the next tick (5 minutes) is the retry. Expires before the next one starts.
  await boss.createQueue(CLOSE_SENDER_QUEUE, { retryLimit: 0, expireInSeconds: 240 });
  await scheduleInLima(boss, CLOSE_SENDER_QUEUE, CLOSE_SENDER_CRON);
  await boss.work(CLOSE_SENDER_QUEUE, async (jobs) => {
    for (const job of jobs) {
      const summary = await sendDueCloses(deps, deps.now());
      deps.logger.info({ job: CLOSE_SENDER_QUEUE, jobId: job.id, ...summary }, 'close sender done');
    }
  });
  return { runNow: (now = deps.now(), scope) => sendDueCloses(deps, now, scope) };
}
