/**
 * Clarifications («dudas», 11.8, PR08, PR10, D37, D50).
 *
 * - Priority 1 (most important) to 6; `missing_from_list` is web-only (D10).
 * - Same priority → larger amount first.
 * - The close message carries at most 5, added in priority order while the whole message still
 *   fits (1,024 characters as an image caption, 4,096 as «solo texto»). The cash question and the
 *   link always go; whatever does not fit goes to Pendientes in the web and never blocks a
 *   complete close (PR10).
 */
import type { ClarificationType } from './types.js';

export const CLARIFICATION_PRIORITY: Record<ClarificationType, number | null> = {
  ambiguous_total: 1,
  possible_duplicate: 2,
  unreadable: 3,
  direction: 4,
  date: 5,
  category: 6,
  missing_from_list: null,
};

/** Value for the `clarifications.priority` column; web-only types sort last. */
export const WEB_ONLY_PRIORITY = 99;

export function clarificationPriority(type: ClarificationType): number {
  return CLARIFICATION_PRIORITY[type] ?? WEB_ONLY_PRIORITY;
}

export function isWebOnly(type: ClarificationType): boolean {
  return CLARIFICATION_PRIORITY[type] === null;
}

export const MAX_CLARIFICATIONS_IN_MESSAGE = 5;

/** Character limits of the close message (D37, D50). */
export const CLOSE_MESSAGE_LIMITS = {
  /** Image caption. */
  withImage: 1024,
  /** «Solo texto» (D27). */
  textOnly: 4096,
} as const;

export function closeMessageLimit(summaryImage: boolean): number {
  return summaryImage ? CLOSE_MESSAGE_LIMITS.withImage : CLOSE_MESSAGE_LIMITS.textOnly;
}

export interface ClarificationCandidate {
  id: string;
  type: ClarificationType;
  /** Amount involved, when there is one (for the tie-break). */
  amountCents: number | null;
  createdAt: Date;
}

/** Priority ascending, then amount descending (unknown amounts last), then oldest first. */
export function compareClarifications(
  a: ClarificationCandidate,
  b: ClarificationCandidate,
): number {
  return (
    clarificationPriority(a.type) - clarificationPriority(b.type) ||
    (b.amountCents ?? -1) - (a.amountCents ?? -1) ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    a.id.localeCompare(b.id)
  );
}

export function sortClarifications<T extends ClarificationCandidate>(items: readonly T[]): T[] {
  return [...items].sort(compareClarifications);
}

/**
 * Length as WhatsApp might count it. UTF-16 code units are never fewer than characters, so this
 * errs on the safe side with emojis («1️⃣» counts as 3).
 */
export function messageLength(text: string): number {
  return text.length;
}

export interface CloseSelectionInput<T extends ClarificationCandidate> {
  clarifications: readonly T[];
  /**
   * Renders the whole close message (summary, notices, the numbered doubts given, the cash question,
   * the «Tienes {k} cosas más…» line and the link) for a candidate selection.
   * `webCount` is how many would go to the web with that selection.
   */
  render: (selected: readonly T[], webCount: number) => string;
  maxLength: number;
  maxItems?: number;
  measure?: (text: string) => number;
}

export interface CloseSelection<T extends ClarificationCandidate> {
  /** In message order; message number = index + 1 (the cash question is `cashCheckNumber`). */
  inMessage: T[];
  /** Everything else, including web-only types, in priority order. */
  toWeb: T[];
  cashCheckNumber: number;
  text: string;
  /** False only when even the message without doubts is too long. */
  fits: boolean;
}

export function selectClarificationsForClose<T extends ClarificationCandidate>(
  input: CloseSelectionInput<T>,
): CloseSelection<T> {
  const maxItems = input.maxItems ?? MAX_CLARIFICATIONS_IN_MESSAGE;
  const measure = input.measure ?? messageLength;
  const sorted = sortClarifications(input.clarifications);
  const eligible = sorted.filter((item) => !isWebOnly(item.type));
  const webOnly = sorted.filter((item) => isWebOnly(item.type));

  const selected: T[] = [];
  let text = input.render(selected, sorted.length);
  for (const item of eligible) {
    if (selected.length >= maxItems) break;
    const attempt = [...selected, item];
    const attemptText = input.render(attempt, sorted.length - attempt.length);
    if (measure(attemptText) > input.maxLength) break;
    selected.push(item);
    text = attemptText;
  }

  const chosen = new Set(selected.map((item) => item.id));
  const rest = eligible.filter((item) => !chosen.has(item.id));
  return {
    inMessage: selected,
    toWeb: sortClarifications([...rest, ...webOnly]),
    cashCheckNumber: selected.length + 1,
    text,
    fits: measure(text) <= input.maxLength,
  };
}
