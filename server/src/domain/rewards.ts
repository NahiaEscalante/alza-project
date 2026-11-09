/**
 * Milestones bar and redemption (13.2, 13.3, D20, D22, PR11, PR18).
 */
import { isoWeekOf } from './time.js';
import type { CloseLevel, IsoDate } from './types.js';

/** Milestones on the bar; the big goal is shown apart. */
export const MILESTONES = [50, 100, 200, 400] as const;
export const BIG_GOAL = 2500;

export interface MilestoneProgress {
  reached: number[];
  /** Next milestone on the bar, or null when all are reached. */
  next: number | null;
  /** Points missing for `next` (0 when null). */
  missingForNext: number;
  /** Points missing for the big goal (0 when reached). */
  missingForBigGoal: number;
}

export function milestoneProgress(balance: number): MilestoneProgress {
  const reached = MILESTONES.filter((milestone) => balance >= milestone);
  const next = MILESTONES.find((milestone) => balance < milestone) ?? null;
  return {
    reached,
    next,
    missingForNext: next === null ? 0 : next - balance,
    missingForBigGoal: Math.max(0, BIG_GOAL - balance),
  };
}

export interface RewardOption {
  id: string;
  name: string;
  costPoints: number;
  isBig: boolean;
}

/**
 * «Te faltan {X} para {premio}» (WA-12, Inicio): the cheapest regular reward she cannot afford
 * yet; when she can afford all regular ones, the cheapest big one she cannot afford. Null when
 * she can afford everything.
 */
export function nextRewardHint<T extends RewardOption>(
  balance: number,
  rewards: readonly T[],
): { reward: T; missingPoints: number } | null {
  const byCost = [...rewards].sort((a, b) => a.costPoints - b.costPoints);
  const unaffordable = (big: boolean) =>
    byCost.find((reward) => reward.isBig === big && reward.costPoints > balance);
  const reward = unaffordable(false) ?? unaffordable(true);
  return reward ? { reward, missingPoints: reward.costPoints - balance } : null;
}

/** Big rewards need 8 active weeks (DEF); an active week has ≥ 3 complete or partial closes (PR18). */
export const REQUIRED_ACTIVE_WEEKS = 8;
export const ACTIVE_WEEK_MIN_CLOSES = 3;
/** PR11: the PIN is valid for sensitive actions for 10 minutes. */
export const PIN_SESSION_MS = 10 * 60_000;

/** Counts active ISO weeks (not necessarily consecutive) from the final level of each day. */
export function countActiveWeeks(
  closes: readonly { businessDay: IsoDate; level: CloseLevel }[],
): number {
  const perWeek = new Map<string, number>();
  for (const close of closes) {
    if (close.level === 'no_close') continue;
    const week = isoWeekOf(close.businessDay);
    perWeek.set(week, (perWeek.get(week) ?? 0) + 1);
  }
  return [...perWeek.values()].filter((count) => count >= ACTIVE_WEEK_MIN_CLOSES).length;
}

export function isPinFresh(pinVerifiedAt: Date | null, now: Date): boolean {
  if (pinVerifiedAt === null) return false;
  const elapsed = now.getTime() - pinVerifiedAt.getTime();
  return elapsed >= 0 && elapsed <= PIN_SESSION_MS;
}

export type RedemptionCheck =
  /** Regular → `delivered` with a DEMO-XXXX code; big → `in_review` (points are deducted now). */
  | { ok: true; status: 'delivered' | 'in_review'; pointsDelta: number }
  | { ok: false; reason: 'pin_required' }
  | { ok: false; reason: 'insufficient_points'; missingPoints: number }
  | { ok: false; reason: 'needs_active_weeks'; missingWeeks: number };

/** 13.3: balance ≥ cost, PIN verified in the last 10 minutes, and 8 active weeks for big ones. */
export function checkRedemption(input: {
  balance: number;
  reward: Pick<RewardOption, 'costPoints' | 'isBig'>;
  activeWeeks: number;
  pinVerifiedAt: Date | null;
  now: Date;
}): RedemptionCheck {
  if (!isPinFresh(input.pinVerifiedAt, input.now)) return { ok: false, reason: 'pin_required' };
  if (input.balance < input.reward.costPoints) {
    return {
      ok: false,
      reason: 'insufficient_points',
      missingPoints: input.reward.costPoints - input.balance,
    };
  }
  if (input.reward.isBig && input.activeWeeks < REQUIRED_ACTIVE_WEEKS) {
    return {
      ok: false,
      reason: 'needs_active_weeks',
      missingWeeks: REQUIRED_ACTIVE_WEEKS - input.activeWeeks,
    };
  }
  return {
    ok: true,
    status: input.reward.isBig ? 'in_review' : 'delivered',
    pointsDelta: -input.reward.costPoints,
  };
}

/** A rejected big redemption gives the points back (13.3), as an `adjustment` entry. */
export function rejectedRedemptionRefund(redeemedPoints: number): {
  type: 'adjustment';
  points: number;
} {
  return { type: 'adjustment', points: Math.abs(redeemedPoints) };
}
