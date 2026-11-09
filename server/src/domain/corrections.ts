/**
 * Corrections by message (case 13, RF-LB-01, D16): «eso no, eran 52» corrects her last entry of the
 * last 15 minutes. If more than one entry could be meant, it becomes a doubt.
 *
 * «Her last entry» = the entries created from her most recent message (screenshot, list, text,
 * audio or close reply) within the window. One entry → that one; several (an audio with two
 * sales) → ambiguous.
 */
import { MINUTE_MS } from './time.js';
import { isLive, type LedgerEntrySource, type LedgerEntryView, type LedgerLabel } from './types.js';

export const CORRECTION_WINDOW_MS = 15 * MINUTE_MS;

/** Sources that come from her WhatsApp messages (not the web or the chat). */
const MESSAGE_SOURCES: readonly LedgerEntrySource[] = [
  'screenshot',
  'activity_list',
  'text',
  'audio',
  'close_reply',
];

export type CorrectionEntry = Pick<
  LedgerEntryView,
  'id' | 'status' | 'source' | 'inboundMessageId' | 'createdAt'
>;

export type CorrectionTarget =
  | { kind: 'target'; entryId: string }
  | { kind: 'ambiguous'; entryIds: string[] }
  | { kind: 'none' };

export function findCorrectionTarget(
  entries: readonly CorrectionEntry[],
  now: Date,
): CorrectionTarget {
  const from = now.getTime() - CORRECTION_WINDOW_MS;
  const recent = entries
    .filter(
      (entry) =>
        isLive(entry) &&
        MESSAGE_SOURCES.includes(entry.source) &&
        entry.createdAt.getTime() >= from &&
        entry.createdAt.getTime() <= now.getTime(),
    )
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const latest = recent[0];
  if (!latest) return { kind: 'none' };
  const sameMessage =
    latest.inboundMessageId === null
      ? [latest]
      : recent.filter((entry) => entry.inboundMessageId === latest.inboundMessageId);
  if (sameMessage.length === 1) return { kind: 'target', entryId: latest.id };
  return { kind: 'ambiguous', entryIds: sameMessage.map((entry) => entry.id) };
}

/**
 * Fields of the new entry that replaces `old` (the old one becomes `superseded`). Whatever she
 * corrects becomes «Lo contaste tú», even if it came from a screenshot (11.3, D16).
 */
export function correctedEntryFields<T extends { id: string; label: LedgerLabel }>(
  old: T,
  patch: Partial<Omit<T, 'id' | 'label'>>,
): Omit<T, 'id' | 'label'> & { label: 'self_reported'; replacesEntryId: string } {
  const { id, label: _label, ...rest } = old;
  return { ...rest, ...patch, label: 'self_reported', replacesEntryId: id };
}
