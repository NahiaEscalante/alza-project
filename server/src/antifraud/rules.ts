/**
 * Antifraud rules (13.4, D22) as pure functions. They only decide what to *flag*: an alert never
 * blocks anything by itself (the one exception, set by the spec, is that an account with a repeated
 * account holder earns no points until the team reviews it).
 *
 * Thresholds marked [PROP] are not in the spec («segundos», «siempre», «promedio semanal») and were
 * chosen for the MVP.
 */
import { createHash } from 'node:crypto';
import type { AlertType, CashCheckResult } from '../db/schema.js';

export const HOLDER_CONFLICT_ALERT = 'duplicate_account_holder' satisfies AlertType;
export const SHARED_SCREENSHOT_ALERT = 'shared_screenshot' satisfies AlertType;
export const ACTIVITY_SPIKE_ALERT = 'activity_spike' satisfies AlertType;
export const INSTANT_REPLIES_ALERT = 'instant_close_replies' satisfies AlertType;

/** Alerts the antifraud module writes (all already in `ALERT_TYPES`). */
export const ANTIFRAUD_ALERT_TYPES = [
  HOLDER_CONFLICT_ALERT,
  SHARED_SCREENSHOT_ALERT,
  ACTIVITY_SPIKE_ALERT,
  INSTANT_REPLIES_ALERT,
] as const;

/** «más del triple de su promedio semanal» (13.4). */
export const ACTIVITY_SPIKE_FACTOR = 3;
/** [PROP] Weeks of history the average is taken from. */
export const ACTIVITY_BASELINE_WEEKS = 4;
/** [PROP] Without at least this many full weeks of history there is no average to compare with. */
export const ACTIVITY_MIN_BASELINE_WEEKS = 2;

/** [PROP] «segundos después del mensaje»: a reply this fast cannot have read the close. */
export const INSTANT_REPLY_MAX_MS = 15_000;
/** [PROP] «siempre»: at least this many replied closes, every one fast and «sí». */
export const INSTANT_REPLY_MIN_CLOSES = 5;
/** [PROP] Business days of closes looked at. */
export const INSTANT_REPLY_LOOKBACK_DAYS = 28;

/** [PROP] Days of new screenshots compared on each daily run (more than 1 to survive missed runs). */
export const SHARED_SCREENSHOT_LOOKBACK_DAYS = 8;

/**
 * Key for «the same account holder» without keeping her name in the alert (the panel looks the
 * accounts up by id).
 */
export function holderKey(holderNameNormalized: string): string {
  return createHash('sha256').update(`alza-holder:v1:${holderNameNormalized}`).digest('hex');
}

export interface ActivitySpike {
  currentWeekCount: number;
  weeklyAverage: number;
  baselineWeeks: number;
}

/**
 * 13.4: activity of the last full week above `ACTIVITY_SPIKE_FACTOR` × her weekly average. Only
 * weeks she was already using ALZA count for the average.
 */
export function detectActivitySpike(input: {
  currentWeekCount: number;
  /** Counts of the weeks before, oldest first, only weeks since she started. */
  baselineWeekCounts: readonly number[];
}): ActivitySpike | null {
  const weeks = input.baselineWeekCounts.length;
  if (weeks < ACTIVITY_MIN_BASELINE_WEEKS) return null;
  const average = input.baselineWeekCounts.reduce((total, count) => total + count, 0) / weeks;
  if (average <= 0) return null;
  if (input.currentWeekCount <= ACTIVITY_SPIKE_FACTOR * average) return null;
  return {
    currentWeekCount: input.currentWeekCount,
    weeklyAverage: Math.round(average * 100) / 100,
    baselineWeeks: weeks,
  };
}

export interface CloseReplyTiming {
  sentAt: Date;
  repliedAt: Date;
  cashCheck: CashCheckResult | null;
}

/**
 * 13.4: close replies that *always* arrive seconds after the message and *always* say «sí». «Sí»
 * is read from the stored outcome (cash check `balanced`), never from her message text.
 */
export function detectInstantYesReplies(
  replies: readonly CloseReplyTiming[],
): { closes: number; slowestReplyMs: number } | null {
  if (replies.length < INSTANT_REPLY_MIN_CLOSES) return null;
  let slowest = 0;
  for (const reply of replies) {
    const elapsed = reply.repliedAt.getTime() - reply.sentAt.getTime();
    if (elapsed < 0 || elapsed > INSTANT_REPLY_MAX_MS) return null;
    if (reply.cashCheck !== 'balanced') return null;
    slowest = Math.max(slowest, elapsed);
  }
  return { closes: replies.length, slowestReplyMs: slowest };
}

export interface MediaSighting {
  userId: string;
  sha256: string;
  mediaFileId: string;
  firstSeenAt: Date;
}

export interface SharedScreenshotFlag {
  /** The account that sent it after another one did (gets the alert). */
  userId: string;
  sha256: string;
  mediaFileId: string;
  /** The first account that sent it. */
  firstUserId: string;
}

/**
 * 13.4: the same file (SHA-256) sent from different accounts. The first account to send it is
 * taken as the original; every later account is flagged, naming the first one.
 */
export function sharedScreenshotFlags(sightings: readonly MediaSighting[]): SharedScreenshotFlag[] {
  const bySha = new Map<string, MediaSighting[]>();
  for (const sighting of sightings) {
    const list = bySha.get(sighting.sha256) ?? [];
    list.push(sighting);
    bySha.set(sighting.sha256, list);
  }
  const flags: SharedScreenshotFlag[] = [];
  for (const [sha256, list] of bySha) {
    const firstByUser = new Map<string, MediaSighting>();
    for (const sighting of list) {
      const current = firstByUser.get(sighting.userId);
      if (!current || sighting.firstSeenAt < current.firstSeenAt) {
        firstByUser.set(sighting.userId, sighting);
      }
    }
    if (firstByUser.size < 2) continue;
    const ordered = [...firstByUser.values()].sort(
      (a, b) =>
        a.firstSeenAt.getTime() - b.firstSeenAt.getTime() || a.userId.localeCompare(b.userId),
    );
    const [first, ...later] = ordered;
    if (!first) continue;
    for (const sighting of later) {
      flags.push({
        userId: sighting.userId,
        sha256,
        mediaFileId: sighting.mediaFileId,
        firstUserId: first.userId,
      });
    }
  }
  return flags;
}
