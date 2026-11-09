/**
 * Duplicates (11.4, D03, RF-LB-04).
 *
 * - Same file (SHA-256) for the user → exact duplicate: not added, no doubt.
 * - Same payment method and operation number as a live entry → exact duplicate.
 * - No operation number, and a live digital entry with the same amount, direction and
 *   counterparty within ±2 minutes → pending + doubt «posible_duplicado».
 * - Different operation numbers are never duplicates. Cash is never compared with screenshots.
 * - A text mention («me yapearon 20 de Rosa») that matches a screenshot is linked, not added.
 */
import { mentionMatchesName } from './names.js';
import {
  type Direction,
  type IsoDate,
  isLive,
  type LedgerEntryView,
  type PaymentMethod,
} from './types.js';

export const DUPLICATE_WINDOW_MS = 2 * 60_000;

/** Exact duplicate of a file she already sent (case 1). */
export function isSameFile(sha256: string, knownSha256s: Iterable<string>): boolean {
  const target = sha256.toLowerCase();
  for (const known of knownSha256s) if (known.toLowerCase() === target) return true;
  return false;
}

/** Operation numbers compared without spaces or dashes; leading zeros are significant. */
export function normalizeOperationNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/[\s-]/g, '').toUpperCase();
  return normalized === '' ? null : normalized;
}

export interface OperationCandidate {
  amountCents: number;
  direction: Direction;
  paymentMethod: PaymentMethod;
  counterpartyNormalized: string | null;
  operationNumber: string | null;
  operationAt: Date | null;
}

export type DuplicateEntry = Pick<
  LedgerEntryView,
  | 'id'
  | 'status'
  | 'amountCents'
  | 'direction'
  | 'paymentMethod'
  | 'counterpartyNormalized'
  | 'operationNumber'
  | 'operationAt'
>;

export type DuplicateCheck =
  | { kind: 'new' }
  | { kind: 'exact_duplicate'; entryId: string }
  | { kind: 'possible_duplicate'; entryId: string };

/** Classifies one operation read from a screenshot against the user's ledger. */
export function checkOperationDuplicate(
  candidate: OperationCandidate,
  entries: readonly DuplicateEntry[],
): DuplicateCheck {
  if (candidate.paymentMethod === 'cash') return { kind: 'new' };
  const live = entries.filter((entry) => isLive(entry) && entry.paymentMethod !== 'cash');

  const operationNumber = normalizeOperationNumber(candidate.operationNumber);
  if (operationNumber !== null) {
    const same = live.find(
      (entry) =>
        entry.paymentMethod === candidate.paymentMethod &&
        normalizeOperationNumber(entry.operationNumber) === operationNumber,
    );
    return same ? { kind: 'exact_duplicate', entryId: same.id } : { kind: 'new' };
  }

  const at = candidate.operationAt;
  if (at === null) return { kind: 'new' };
  const similar = live.find(
    (entry) =>
      entry.amountCents === candidate.amountCents &&
      entry.direction === candidate.direction &&
      entry.counterpartyNormalized === candidate.counterpartyNormalized &&
      entry.operationAt !== null &&
      Math.abs(entry.operationAt.getTime() - at.getTime()) <= DUPLICATE_WINDOW_MS,
  );
  return similar ? { kind: 'possible_duplicate', entryId: similar.id } : { kind: 'new' };
}

export interface TextMention {
  amountCents: number;
  direction: Direction;
  /** 'unknown' when she did not say yape/plin. */
  paymentMethod: PaymentMethod;
  /** Name as she wrote it («Rosa»), or null. */
  counterpartyName: string | null;
  businessDay: IsoDate;
  /** When she said it, to prefer the closest screenshot. */
  at?: Date;
}

export type MentionEntry = Pick<
  LedgerEntryView,
  | 'id'
  | 'status'
  | 'label'
  | 'businessDay'
  | 'amountCents'
  | 'direction'
  | 'paymentMethod'
  | 'counterparty'
  | 'counterpartyNormalized'
  | 'operationAt'
  | 'createdAt'
>;

function mentionMatchesEntry(mention: TextMention, entry: MentionEntry): boolean {
  if (!isLive(entry) || entry.paymentMethod === 'cash') return false;
  if (entry.businessDay !== mention.businessDay) return false;
  if (entry.amountCents !== mention.amountCents || entry.direction !== mention.direction)
    return false;
  if (mention.paymentMethod !== 'unknown' && mention.paymentMethod !== entry.paymentMethod) {
    return false;
  }
  if (mention.counterpartyName === null) return true;
  return mentionMatchesName(
    mention.counterpartyName,
    entry.counterparty ?? entry.counterpartyNormalized,
  );
}

function closestTo<T extends MentionEntry>(candidates: T[], at: Date | undefined): T | null {
  if (candidates.length === 0) return null;
  const time = (entry: T) => (entry.operationAt ?? entry.createdAt).getTime();
  const reference = at?.getTime();
  return [...candidates].sort((a, b) =>
    reference === undefined
      ? time(a) - time(b)
      : Math.abs(time(a) - reference) - Math.abs(time(b) - reference),
  )[0] as T;
}

/**
 * A text or audio mention of a digital payment that a screenshot already covers (11.4): returns
 * the screenshot entry to link to (the mention adds nothing), or null. `alreadyLinked` excludes
 * screenshots linked to an earlier mention.
 */
export function findScreenshotForMention<T extends MentionEntry>(
  mention: TextMention,
  entries: readonly T[],
  alreadyLinked: ReadonlySet<string> = new Set(),
): T | null {
  const candidates = entries.filter(
    (entry) =>
      entry.label === 'screenshot' &&
      !alreadyLinked.has(entry.id) &&
      mentionMatchesEntry(mention, entry),
  );
  return closestTo(candidates, mention.at);
}

/**
 * The reverse case (decision: evidence wins, D03): a screenshot arrives after she already said it
 * by text. Returns the self-reported digital entry it should supersede, or null.
 */
export function findMentionForScreenshot<T extends MentionEntry>(
  screenshot: {
    amountCents: number;
    direction: Direction;
    paymentMethod: PaymentMethod;
    counterpartyName: string | null;
    businessDay: IsoDate;
    operationAt: Date | null;
  },
  entries: readonly T[],
): T | null {
  const candidates = entries.filter((entry) => {
    if (entry.label !== 'self_reported' || !isLive(entry)) return false;
    if (entry.paymentMethod === 'cash') return false;
    if (entry.businessDay !== screenshot.businessDay) return false;
    if (entry.amountCents !== screenshot.amountCents) return false;
    if (entry.direction !== screenshot.direction) return false;
    if (entry.paymentMethod !== 'unknown' && entry.paymentMethod !== screenshot.paymentMethod) {
      return false;
    }
    const said = entry.counterparty ?? entry.counterpartyNormalized;
    return said === null || mentionMatchesName(said, screenshot.counterpartyName);
  });
  return closestTo(candidates, screenshot.operationAt ?? undefined);
}
