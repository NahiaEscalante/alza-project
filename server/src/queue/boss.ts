import { PgBoss } from 'pg-boss';
import type { Logger } from '../lib/logger.js';

/**
 * pg-boss: job queue and scheduled tasks on the same Postgres (8.2). Jobs are added from Fase 3
 * (message worker) and Fase 6 (scheduled tasks of 8.4).
 *
 * Every schedule runs in Lima time (RNF-10): use `scheduleInLima`, never `boss.schedule` directly.
 */
export const QUEUE_TIMEZONE = 'America/Lima';
export const QUEUE_SCHEMA = 'pgboss';

export function createBoss(connectionString: string, logger: Logger): PgBoss {
  const boss = new PgBoss({
    connectionString,
    schema: QUEUE_SCHEMA,
    application_name: 'alza-queue',
    max: 5,
  });
  boss.on('error', (err) => logger.error({ err }, 'pg-boss error'));
  boss.on('warning', (warning) => logger.warn({ warning: warning.message }, 'pg-boss warning'));
  return boss;
}

export async function startBoss(boss: PgBoss): Promise<PgBoss> {
  return boss.start({ attempts: 3 });
}

/** Lets active jobs finish (up to `timeoutMs`) and closes the pool. */
export async function stopBoss(boss: PgBoss, timeoutMs = 10_000): Promise<void> {
  await boss.stop({ graceful: true, timeout: timeoutMs });
}

/** Creates the queue if needed and (re)defines its cron schedule in America/Lima. */
export async function scheduleInLima(
  boss: PgBoss,
  queue: string,
  cron: string,
  data: object | null = null,
): Promise<void> {
  await boss.createQueue(queue);
  await boss.schedule(queue, cron, data, { tz: QUEUE_TIMEZONE });
}
