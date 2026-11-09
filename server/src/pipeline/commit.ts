import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { type InboundMessageStatus, inboundMessages } from '../db/schema.js';
import type { Actor, Tx } from '../ledger/types.js';
import { PipelineError } from './errors.js';

/** Who writes the ledger from her WhatsApp messages. */
export const PIPELINE_ACTOR: Actor = { kind: 'system', channel: 'pipeline' };
/** Corrections she makes by message («eso no, eran 52»). */
export const WHATSAPP_USER_ACTOR: Actor = { kind: 'user', channel: 'whatsapp' };

/** End states of 9.2 (besides `failed`, set by the retry logic). */
export type TerminalStatus = Extract<
  InboundMessageStatus,
  | 'discarded_no_consent'
  | 'recorded'
  | 'pending'
  | 'unreadable'
  | 'duplicate'
  | 'non_financial'
  | 'request_handled'
>;

export const FINISHED_STATUSES: readonly InboundMessageStatus[] = [
  'discarded_no_consent',
  'recorded',
  'pending',
  'unreadable',
  'duplicate',
  'non_financial',
  'request_handled',
  'failed',
];

export const NOT_PROCESSING = 'message_not_processing';

/**
 * Runs the ledger writes of one message and its final state in one transaction: a crash or a
 * retry never leaves half a message in the ledger (RF-IN-02).
 */
export async function commitMessage(
  db: Db,
  inboundMessageId: string,
  work: (tx: Tx) => Promise<TerminalStatus>,
): Promise<TerminalStatus> {
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ status: inboundMessages.status })
      .from(inboundMessages)
      .where(eq(inboundMessages.id, inboundMessageId))
      .for('update');
    if (locked?.status !== 'processing') {
      throw new PipelineError(NOT_PROCESSING, { retryable: false });
    }
    const status = await work(tx);
    await tx
      .update(inboundMessages)
      .set({ status, errorCode: null })
      .where(eq(inboundMessages.id, inboundMessageId));
    return status;
  });
}

/**
 * The message state from its operations: all unreadable → `unreadable`; all duplicates →
 * `duplicate`; any open doubt (pending entry, or an unreadable one next to others) → `pending`;
 * otherwise `recorded`.
 */
export function combineStatuses(statuses: readonly TerminalStatus[]): TerminalStatus {
  if (statuses.length === 0) return 'non_financial';
  if (statuses.every((s) => s === 'unreadable')) return 'unreadable';
  if (statuses.every((s) => s === 'duplicate')) return 'duplicate';
  if (statuses.some((s) => s === 'pending' || s === 'unreadable')) return 'pending';
  if (statuses.some((s) => s === 'recorded')) return 'recorded';
  return statuses[0] ?? 'non_financial';
}
