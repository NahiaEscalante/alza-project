/**
 * RF-AD-01 / RF-IN-05 / case 24: messages that failed after their retries (`failed`) and the
 * ones still retrying (`error`), with ids, type, error code and attempts only. Never the text,
 * the transcript or the file. «Reintentar» sends a `failed` message back to the queue through
 * `retryInboundMessage` (pipeline), with a fresh set of retries.
 */
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  type InboundMessageStatus,
  type InboundMessageType,
  inboundMessages,
  users,
} from '../db/schema.js';
import type { InboundQueue } from '../pipeline/deps.js';
import { retryInboundMessage } from '../pipeline/worker.js';
import type { AdminIdentity } from './accounts.js';
import { recordAdminAction } from './audit.js';
import { maskPhone } from './mask.js';

const SHOWN_STATUSES = ['failed', 'error'] as const satisfies readonly InboundMessageStatus[];
/** Upper bound for «Reintentar todos». */
export const RETRY_ALL_LIMIT = 200;

export interface FailedMessageItem {
  id: string;
  type: InboundMessageType;
  status: (typeof SHOWN_STATUSES)[number];
  errorCode: string | null;
  attempts: number;
  receivedAt: string;
  userId: string;
  phone: string;
}

export interface FailedMessagesView {
  items: FailedMessageItem[];
  counts: { failed: number; error: number };
}

export async function listFailedMessages(
  db: Db,
  options: { limit?: number; userId?: string } = {},
): Promise<FailedMessagesView> {
  const shown = and(
    inArray(inboundMessages.status, [...SHOWN_STATUSES]),
    options.userId ? eq(inboundMessages.userId, options.userId) : undefined,
  );
  const [rows, totals] = await Promise.all([
    db
      .select({
        id: inboundMessages.id,
        type: inboundMessages.type,
        status: inboundMessages.status,
        errorCode: inboundMessages.errorCode,
        attempts: inboundMessages.attempts,
        receivedAt: inboundMessages.receivedAt,
        userId: inboundMessages.userId,
        phoneE164: users.phoneE164,
      })
      .from(inboundMessages)
      .innerJoin(users, eq(users.id, inboundMessages.userId))
      .where(shown)
      .orderBy(desc(inboundMessages.receivedAt))
      .limit(options.limit ?? 100),
    db
      .select({ status: inboundMessages.status, n: count() })
      .from(inboundMessages)
      .where(shown)
      .groupBy(inboundMessages.status),
  ]);
  const totalOf = (status: string) => totals.find((row) => row.status === status)?.n ?? 0;
  return {
    items: rows.map((row) => ({
      id: row.id,
      type: row.type,
      status: row.status as FailedMessageItem['status'],
      errorCode: row.errorCode,
      attempts: row.attempts,
      receivedAt: row.receivedAt.toISOString(),
      userId: row.userId,
      phone: maskPhone(row.phoneE164),
    })),
    counts: { failed: totalOf('failed'), error: totalOf('error') },
  };
}

export interface RetryDeps {
  db: Db;
  queue: InboundQueue;
}

/** One message. False when it is not `failed` (already retried, or still retrying). */
export async function retryFailedMessage(
  deps: RetryDeps,
  admin: AdminIdentity,
  inboundMessageId: string,
  now: Date,
): Promise<boolean> {
  const [before] = await deps.db
    .select({ errorCode: inboundMessages.errorCode, attempts: inboundMessages.attempts })
    .from(inboundMessages)
    .where(and(eq(inboundMessages.id, inboundMessageId), eq(inboundMessages.status, 'failed')));
  if (!before) return false;
  const retried = await retryInboundMessage(deps, inboundMessageId);
  if (!retried) return false;
  await recordAdminAction(deps.db, {
    adminUserId: admin.id,
    action: 'inbound_message.retry',
    targetType: 'inbound_message',
    targetId: inboundMessageId,
    detail: { errorCode: before.errorCode, attempts: before.attempts },
    at: now,
  });
  return true;
}

/** Every `failed` message (oldest first, up to `RETRY_ALL_LIMIT`), e.g. after an AI outage. */
export async function retryAllFailedMessages(
  deps: RetryDeps,
  admin: AdminIdentity,
  now: Date,
): Promise<{ retried: number }> {
  const rows = await deps.db
    .select({ id: inboundMessages.id })
    .from(inboundMessages)
    .where(eq(inboundMessages.status, 'failed'))
    .orderBy(inboundMessages.receivedAt)
    .limit(RETRY_ALL_LIMIT);
  const ids: string[] = [];
  for (const row of rows) {
    if (await retryInboundMessage(deps, row.id)) ids.push(row.id);
  }
  await recordAdminAction(deps.db, {
    adminUserId: admin.id,
    action: 'inbound_message.retry_all',
    targetType: 'inbound_message',
    detail: { retried: ids.length, inboundMessageIds: ids },
    at: now,
  });
  return { retried: ids.length };
}
