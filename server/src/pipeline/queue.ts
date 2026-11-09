/**
 * pg-boss wiring for the message worker (8.1, RF-IN-05).
 *
 * - Job id = inbound message id: enqueueing twice is a no-op (a repeated webhook delivery).
 * - One job at a time per user (pg-boss group = user id), several users in parallel: her messages
 *   are handled in the order they arrived («eso no, eran 52» after its sale).
 * - Retries: up to 3 more attempts with growing delay; the handler marks the message `failed`
 *   on the last one (see `processInboundJob`).
 */
import { randomUUID } from 'node:crypto';
import type { PgBoss } from 'pg-boss';
import type { InboundQueue, PipelineDeps } from './deps.js';
import { MAX_RETRIES, processInboundJob } from './worker.js';

export const INBOUND_QUEUE = 'inbound-message';

export interface InboundJobData {
  inboundMessageId: string;
}

export interface InboundQueueOptions {
  /** Seconds before the first retry; it doubles each time (with jitter). Default 10. */
  retryDelaySeconds?: number;
}

export async function createInboundQueue(
  boss: PgBoss,
  options: InboundQueueOptions = {},
): Promise<InboundQueue> {
  await boss.createQueue(INBOUND_QUEUE, {
    retryLimit: MAX_RETRIES,
    retryDelay: options.retryDelaySeconds ?? 10,
    retryBackoff: true,
    retryDelayMax: 300,
    // OCR + several vision routes with 45 s timeouts can take a few minutes in the worst case.
    expireInSeconds: 600,
  });
  return {
    async enqueue(job, enqueueOptions = {}) {
      await boss.send(
        INBOUND_QUEUE,
        { inboundMessageId: job.inboundMessageId } satisfies InboundJobData,
        {
          id: enqueueOptions.fresh ? randomUUID() : job.inboundMessageId,
          group: { id: job.userId },
        },
      );
    },
  };
}

export interface InboundWorkerOptions {
  /** Jobs in parallel in this process (different users). Default 4. */
  concurrency?: number;
  pollingIntervalSeconds?: number;
}

/** Registers the worker; returns the pg-boss worker id (for `offWork`). */
export async function startInboundWorker(
  boss: PgBoss,
  deps: PipelineDeps,
  options: InboundWorkerOptions = {},
): Promise<string> {
  const concurrency = options.concurrency ?? 4;
  return boss.work<InboundJobData>(
    INBOUND_QUEUE,
    {
      localConcurrency: concurrency,
      localGroupConcurrency: 1,
      pollingIntervalSeconds: options.pollingIntervalSeconds ?? 1,
    },
    async (jobs) => {
      for (const job of jobs) {
        await processInboundJob(deps, {
          inboundMessageId: job.data.inboundMessageId,
          retryCount: job.retryCount,
          jobId: job.id,
        });
      }
    },
  );
}
