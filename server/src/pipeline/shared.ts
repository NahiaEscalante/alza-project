/** Small helpers shared by the screenshot and text branches. */
import type { InboundMessage, User } from '../db/schema.js';
import { type Attribution, attributeMessage, type CloseRef } from '../domain/index.js';
import type { PipelineDeps } from './deps.js';

/** One message being processed. */
export interface MessageWork {
  deps: PipelineDeps;
  message: InboundMessage;
  user: User;
}

export type EntryAttribution = Extract<Attribution, { kind: 'entry' }>;

/** 11.1 for something to record (never a close reply): its business day and PR03 placement. */
export function entryAttribution(
  receivedAt: Date,
  operationAt: Date | null,
  closes: readonly CloseRef[],
): EntryAttribution {
  const attribution = attributeMessage({ receivedAt, operationAt, intent: 'record', closes });
  if (attribution.kind !== 'entry') throw new Error('record attribution must be an entry');
  return attribution;
}

export function parseInstant(value: string | null | undefined): Date | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time);
}

/** Postgres unique violation, also when wrapped by drizzle (`cause`). */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  return (e?.code ?? e?.cause?.code) === '23505';
}
