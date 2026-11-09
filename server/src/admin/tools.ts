/**
 * Demo tools of the panel (17.6 script, RF-AD-04): run the 12:00 close finalization or the
 * antifraud scan now, and send WA-17 when a problem affects many users (case 24). Each one is
 * guarded (explicit scope, confirmation in the body) and logged with who ran it and the counts
 * it returned, never content.
 *
 * Close finalization «for a date»: the job finalizes every non-final day whose deadline (12:00
 * of the next day) has passed at the clock it is given. For a day whose deadline is still ahead
 * (today, or yesterday before 12:00), the job runs with the clock set to that deadline, as if
 * it were 12:00 of the next day: points and `final_at` carry that time. Never for a future day.
 */

import type { Db } from '../db/client.js';
import type { IsoDate } from '../domain/index.js';
import { businessDayOf, pointsDeadline } from '../domain/index.js';
import type { JobSummary, ScheduledJobName, ScheduledJobs } from '../jobs/registry.js';
import type { JobScope } from '../jobs/types.js';
import type { AdminIdentity } from './accounts.js';
import { recordAdminAction } from './audit.js';

export type JobRunner = Pick<ScheduledJobs, 'runJobNow'>;

/** WA-17 sender (`flows/requests/broadcast.ts`), injected so the panel does not need a channel. */
export type TechnicalIssueBroadcaster = (incident: {
  startedAt: Date;
}) => Promise<{ sent: number; skipped: number; failed: number }>;

export type ToolScope = { userId: string } | { allUsers: true };

export type ToolResult =
  | { ok: true; summary: JobSummary; ranAt: string }
  | { ok: false; error: 'future_day' | 'job_failed' };

function jobScope(scope: ToolScope): JobScope | undefined {
  return 'userId' in scope ? { userIds: [scope.userId] } : undefined;
}

function scopeDetail(scope: ToolScope): { scope: string; userId: string | null } {
  return 'userId' in scope
    ? { scope: 'user', userId: scope.userId }
    : { scope: 'all_users', userId: null };
}

/** The clock the 12:00 job runs with so that `day` becomes final. */
export function finalizeClockFor(day: IsoDate, now: Date): Date {
  const deadline = pointsDeadline(day);
  return deadline.getTime() > now.getTime() ? deadline : now;
}

async function runLogged(
  db: Db,
  admin: AdminIdentity,
  jobs: JobRunner,
  input: {
    job: ScheduledJobName;
    action: 'job.close_finalize' | 'job.antifraud_scan';
    clock: Date;
    scope: ToolScope;
    now: Date;
    extra?: Record<string, string>;
  },
): Promise<ToolResult> {
  const base = { ...scopeDetail(input.scope), ...input.extra, clock: input.clock.toISOString() };
  let summary: JobSummary;
  try {
    summary = await jobs.runJobNow(input.job, input.clock, jobScope(input.scope));
  } catch (err) {
    const failures = (err as { failures?: unknown }).failures;
    await recordAdminAction(db, {
      adminUserId: admin.id,
      action: input.action,
      targetType: 'job',
      targetId: input.job,
      detail: { ...base, outcome: 'failed', failures: typeof failures === 'number' ? failures : 0 },
      at: input.now,
    });
    return { ok: false, error: 'job_failed' };
  }
  await recordAdminAction(db, {
    adminUserId: admin.id,
    action: input.action,
    targetType: 'job',
    targetId: input.job,
    detail: { ...base, outcome: 'ok', summary: countsOnly(summary) },
    at: input.now,
  });
  return { ok: true, summary, ranAt: input.clock.toISOString() };
}

/** Summaries are counts and dates already; this keeps it that way in the audit row. */
function countsOnly(summary: JobSummary): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(summary)) {
    if (typeof value === 'number' || (typeof value === 'string' && value.length <= 40)) {
      out[key] = value;
    }
  }
  return out;
}

export async function runCloseFinalize(
  deps: { db: Db; jobs: JobRunner },
  admin: AdminIdentity,
  input: { businessDay?: IsoDate; scope: ToolScope; now: Date },
): Promise<ToolResult> {
  const today = businessDayOf(input.now);
  if (input.businessDay && input.businessDay > today) return { ok: false, error: 'future_day' };
  const clock = input.businessDay ? finalizeClockFor(input.businessDay, input.now) : input.now;
  return runLogged(deps.db, admin, deps.jobs, {
    job: 'close-finalize',
    action: 'job.close_finalize',
    clock,
    scope: input.scope,
    now: input.now,
    extra: input.businessDay ? { businessDay: input.businessDay } : {},
  });
}

export async function runAntifraudScanNow(
  deps: { db: Db; jobs: JobRunner },
  admin: AdminIdentity,
  input: { scope: ToolScope; now: Date },
): Promise<ToolResult> {
  return runLogged(deps.db, admin, deps.jobs, {
    job: 'antifraud-scan',
    action: 'job.antifraud_scan',
    clock: input.now,
    scope: input.scope,
    now: input.now,
  });
}

export async function sendTechnicalIssueNotice(
  deps: { db: Db; broadcast: TechnicalIssueBroadcaster },
  admin: AdminIdentity,
  input: { startedAt: Date; now: Date },
): Promise<{ sent: number; skipped: number; failed: number }> {
  const result = await deps.broadcast({ startedAt: input.startedAt });
  await recordAdminAction(deps.db, {
    adminUserId: admin.id,
    action: 'broadcast.technical_issue',
    targetType: 'job',
    targetId: 'WA-17',
    detail: { startedAt: input.startedAt.toISOString(), ...result },
    at: input.now,
  });
  return result;
}
