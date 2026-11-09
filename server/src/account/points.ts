/**
 * Points as she sees them (13.1, 13.2): one balance from `points_entries` (RF-PT-04), the
 * milestones bar, the streak and the freezes left this week.
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { dailyCloses, pointsEntries, rewards, streaks } from '../db/schema.js';
import {
  BIG_GOAL,
  businessDayOf,
  type CloseLevel,
  countActiveWeeks,
  FREEZES_PER_WEEK,
  isoWeekOf,
  MILESTONES,
  milestoneProgress,
  nextRewardHint,
  pointsBalance,
} from '../domain/index.js';
import type { DbOrTx } from '../ledger/types.js';

export async function getPointsBalance(db: DbOrTx, userId: string): Promise<number> {
  const rows = await db
    .select({ points: pointsEntries.points })
    .from(pointsEntries)
    .where(eq(pointsEntries.userId, userId));
  return pointsBalance(rows);
}

/** PR18 active weeks, from the final level of each day (improvements after 12:00 do not count). */
export async function getActiveWeeks(db: DbOrTx, userId: string): Promise<number> {
  const rows = await db
    .select({ businessDay: dailyCloses.businessDay, level: dailyCloses.level })
    .from(dailyCloses)
    .where(and(eq(dailyCloses.userId, userId), isNotNull(dailyCloses.level)));
  return countActiveWeeks(rows as { businessDay: string; level: CloseLevel }[]);
}

export interface PointsSummary {
  balance: number;
  milestones: readonly number[];
  reached: number[];
  /** Next milestone on the bar (null when all are reached). */
  nextMilestone: number | null;
  missingForNextMilestone: number;
  bigGoal: number;
  missingForBigGoal: number;
  /** «Te faltan {X} para {premio}» (12.2 Inicio). */
  nextReward: { id: string; name: string; costPoints: number; missingPoints: number } | null;
  streakDays: number;
  freezesLeft: number;
}

export async function getPointsSummary(db: Db, userId: string, now: Date): Promise<PointsSummary> {
  const [balance, catalog, [streak]] = await Promise.all([
    getPointsBalance(db, userId),
    db
      .select({
        id: rewards.id,
        name: rewards.name,
        costPoints: rewards.costPoints,
        isBig: rewards.isBig,
      })
      .from(rewards)
      .where(eq(rewards.active, true)),
    db.select().from(streaks).where(eq(streaks.userId, userId)),
  ]);
  const progress = milestoneProgress(balance);
  const hint = nextRewardHint(balance, catalog);
  const thisWeek = isoWeekOf(businessDayOf(now));
  const freezesUsed = streak && streak.isoWeek === thisWeek ? streak.freezesUsed : 0;
  return {
    balance,
    milestones: MILESTONES,
    reached: progress.reached,
    nextMilestone: progress.next,
    missingForNextMilestone: progress.missingForNext,
    bigGoal: BIG_GOAL,
    missingForBigGoal: progress.missingForBigGoal,
    nextReward: hint
      ? {
          id: hint.reward.id,
          name: hint.reward.name,
          costPoints: hint.reward.costPoints,
          missingPoints: hint.missingPoints,
        }
      : null,
    streakDays: streak?.days ?? 0,
    freezesLeft: Math.max(0, FREEZES_PER_WEEK - freezesUsed),
  };
}
