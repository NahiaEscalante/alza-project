/**
 * Scheduled tasks of 8.4 owned by Fase 6, all in America/Lima through `scheduleInLima`.
 *
 * | Queue               | Cron (Lima)  | Task                                                       |
 * |---------------------|--------------|------------------------------------------------------------|
 * | `retention-cleanup` | `0 3 * * *`  | PR07 originals > 30 days, expired links, waitlist > 6 m.   |
 * | `points-expiry`     | `0 4 * * *`  | D29: balance expires after 6 months without any close.     |
 * | `antifraud-scan`    | `0 5 * * *`  | 13.4: shared screenshots, activity spikes, instant «sí».   |
 * | `close-finalize`    | `0 12 * * *` | Final closes, points, streak, freezes, bonuses, doubts to  |
 * |                     |              | the web. On Mondays it also gives the weekly bonus (it is  |
 * |                     |              | awarded when Sunday becomes final, in the same run).       |
 *
 * The 12:00 schedule uses pg-boss `missed: 'once'`: if the server was down at 12:00 (a deploy),
 * it runs on startup. The 5-minute close sender of 8.4 belongs to Fase 5.
 *
 * Every task is idempotent and catches up after a missed run, so pg-boss retries (and a manual
 * `runJobNow` from the demo or the panel) are safe. Logs carry only the job name, its id and
 * counts.
 */
import type { PgBoss } from 'pg-boss';
import { runAntifraudScan } from '../antifraud/scan.js';
import { scheduleInLima } from '../queue/boss.js';
import { finalizeDueCloses } from './finalize-closes.js';
import { expireInactivePoints } from './points-expiry.js';
import { runRetentionCleanup } from './retention.js';
import type { JobScope, ScheduledJobsDeps } from './types.js';

export const SCHEDULED_JOBS: Record<
  'retention-cleanup' | 'points-expiry' | 'antifraud-scan' | 'close-finalize',
  { cron: string; missed?: 'once' }
> = {
  'retention-cleanup': { cron: '0 3 * * *' },
  'points-expiry': { cron: '0 4 * * *' },
  'antifraud-scan': { cron: '0 5 * * *' },
  // A deploy at 12:00 runs it on startup instead of waiting for tomorrow's catch-up.
  'close-finalize': { cron: '0 12 * * *', missed: 'once' },
};

export type ScheduledJobName = keyof typeof SCHEDULED_JOBS;
export const SCHEDULED_JOB_NAMES = Object.keys(SCHEDULED_JOBS) as ScheduledJobName[];

/** A day deferred by a close reply still in process is retried this many seconds later. */
export const DEFERRED_RERUN_SECONDS = 120;

export function isScheduledJobName(name: string): name is ScheduledJobName {
  return Object.hasOwn(SCHEDULED_JOBS, name);
}

export class ScheduledJobError extends Error {
  constructor(
    readonly job: ScheduledJobName,
    readonly failures: number,
  ) {
    super(`${job}: ${failures} item(s) failed`);
    this.name = 'ScheduledJobError';
  }
}

/** Counts returned by each task (no amounts, names or texts). */
export type JobSummary = Record<string, number | string>;

/** Runs one task at `now`. Throws `ScheduledJobError` when part of it failed (so it retries). */
export async function runScheduledJob(
  deps: ScheduledJobsDeps,
  name: ScheduledJobName,
  now: Date,
  scope?: JobScope,
): Promise<JobSummary> {
  const { db, logger, storage } = deps;
  let summary: JobSummary;
  let failures = 0;
  switch (name) {
    case 'close-finalize': {
      const result = await finalizeDueCloses({ db, logger }, now, scope);
      failures = result.failedUsers;
      summary = { ...result };
      break;
    }
    case 'retention-cleanup':
      summary = { ...(await runRetentionCleanup({ db, storage }, now, scope)) };
      break;
    case 'points-expiry': {
      const result = await expireInactivePoints({ db, logger }, now, scope);
      failures = result.failedUsers;
      summary = { ...result };
      break;
    }
    case 'antifraud-scan': {
      const result = await runAntifraudScan({ db, logger }, now, scope);
      failures = result.failed;
      summary = { ...result };
      break;
    }
  }
  if (failures > 0) throw new ScheduledJobError(name, failures);
  return summary;
}

export interface ScheduledJobs {
  names: readonly ScheduledJobName[];
  /** Runs a task right away (demo, admin panel), with the given clock or the deps' one. */
  runJobNow(name: ScheduledJobName, now?: Date, scope?: JobScope): Promise<JobSummary>;
}

/** `runJobNow` without pg-boss (scripts, tests, the panel). */
export function createJobRunner(deps: ScheduledJobsDeps): ScheduledJobs {
  const clock = deps.now ?? (() => new Date());
  return {
    names: SCHEDULED_JOB_NAMES,
    async runJobNow(name, now = clock(), scope) {
      if (!isScheduledJobName(name)) throw new Error(`Unknown scheduled job: ${String(name)}`);
      const summary = await runScheduledJob(deps, name, now, scope);
      deps.logger.info({ job: name, ...summary }, 'scheduled job run');
      return summary;
    },
  };
}

/**
 * Creates the queues, (re)defines their crons in America/Lima and starts one worker per queue.
 * Call once at startup, after `startBoss`. Returns `runJobNow` for the demo and the panel.
 */
export async function registerScheduledJobs(
  boss: PgBoss,
  deps: ScheduledJobsDeps,
): Promise<ScheduledJobs> {
  const clock = deps.now ?? (() => new Date());
  for (const name of SCHEDULED_JOB_NAMES) {
    // Created before scheduleInLima (which creates it without options): 2 retries a minute apart.
    await boss.createQueue(name, { retryLimit: 2, retryDelay: 60, expireInSeconds: 1_800 });
    const { cron, missed } = SCHEDULED_JOBS[name];
    await scheduleInLima(boss, name, cron, null, { missed });
    await boss.work(name, async (jobs) => {
      for (const job of jobs) {
        const summary = await runScheduledJob(deps, name, clock());
        deps.logger.info({ job: name, jobId: job.id, ...summary }, 'scheduled job done');
        if (name === 'close-finalize' && Number(summary.deferredUsers) > 0) {
          await boss.send(name, null, {
            startAfter: DEFERRED_RERUN_SECONDS,
            singletonKey: 'deferred-rerun',
          });
        }
      }
    });
  }
  return createJobRunner(deps);
}
