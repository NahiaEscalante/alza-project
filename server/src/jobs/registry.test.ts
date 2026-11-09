import { afterAll, describe, expect, it } from 'vitest';
import { createTestDb, hasTestDb, TEST_DATABASE_URL } from '../../test/db.js';
import { limaInstant, pointsDeadline } from '../domain/index.js';
import { createLogger } from '../lib/logger.js';
import { createBoss, QUEUE_TIMEZONE, startBoss, stopBoss } from '../queue/boss.js';
import {
  createJobRunner,
  registerScheduledJobs,
  SCHEDULED_JOB_NAMES,
  SCHEDULED_JOBS,
  ScheduledJobError,
  type ScheduledJobName,
} from './registry.js';
import { createActiveUser, getPoints, recordClose } from './test-support.js';

const logger = createLogger({ level: 'silent' });
/**
 * Workers registered here run unscoped on the shared test database: their clock is in 2000, where
 * no test has data, so a stray cron tick changes nothing.
 */
const HARMLESS_CLOCK = () => new Date('2000-01-03T17:00:00Z');

describe('scheduled job table (8.4)', () => {
  it('has the Lima times of 8.4', () => {
    expect(SCHEDULED_JOBS).toEqual({
      'retention-cleanup': { cron: '0 3 * * *' },
      'points-expiry': { cron: '0 4 * * *' },
      'antifraud-scan': { cron: '0 5 * * *' },
      'close-finalize': { cron: '0 12 * * *' },
    });
  });

  it('runJobNow rejects unknown names and surfaces partial failures', async () => {
    const failingDb = {
      select: () => {
        throw new Error('db down');
      },
    } as never;
    const runner = createJobRunner({
      db: failingDb,
      storage: { delete: async () => false },
      logger,
    });
    await expect(runner.runJobNow('nope' as ScheduledJobName, new Date())).rejects.toThrow(
      'Unknown scheduled job',
    );
    await expect(runner.runJobNow('antifraud-scan', new Date())).rejects.toBeInstanceOf(
      ScheduledJobError,
    );
  });
});

describe.skipIf(!hasTestDb)('registerScheduledJobs', () => {
  const { pool, db } = createTestDb();
  afterAll(async () => {
    await pool.end();
  });

  it('schedules every task in America/Lima, works its queue and runs on demand', async () => {
    const boss = createBoss(TEST_DATABASE_URL, logger);
    await startBoss(boss);
    try {
      const deps = { db, storage: { delete: async () => false }, logger, now: HARMLESS_CLOCK };
      const jobs = await registerScheduledJobs(boss, deps);
      expect(jobs.names).toEqual(SCHEDULED_JOB_NAMES);
      for (const name of SCHEDULED_JOB_NAMES) {
        const [schedule] = await boss.getSchedules(name);
        expect(schedule).toMatchObject({
          name,
          cron: SCHEDULED_JOBS[name].cron,
          timezone: QUEUE_TIMEZONE,
        });
      }

      // The worker picks up a job of its queue.
      const jobId = await boss.send('retention-cleanup', null);
      if (!jobId) throw new Error('no job id');
      let state: string | undefined;
      for (let i = 0; i < 50 && state !== 'completed'; i++) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        state = (await boss.getJobById('retention-cleanup', jobId))?.state;
      }
      expect(state).toBe('completed');

      // runJobNow with an explicit clock (the demo «pasar a las 12:00»).
      const userId = await createActiveUser(db, { consentAt: limaInstant('2026-11-02', 9) });
      await recordClose(db, userId, '2026-11-09', 'complete');
      const summary = await jobs.runJobNow('close-finalize', pointsDeadline('2026-11-09'), {
        userIds: [userId],
      });
      expect(summary).toMatchObject({ daysFinalized: 1, pointsAwarded: 10 });
      expect(await getPoints(db, userId)).toHaveLength(1);
    } finally {
      for (const name of SCHEDULED_JOB_NAMES) await boss.unschedule(name);
      await stopBoss(boss, 2_000);
    }
  }, 30_000);
});
