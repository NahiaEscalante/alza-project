/**
 * WA-12 shows the points of the day before they exist: they are written at 12:00 of the next day
 * (Fase 6, `jobs/finalize-closes.ts`). This preview applies the same rules (13.1) to the stored
 * streak: `applyDailyClose`, the Sunday weekly bonus and the D22 hold (case 22: an open holder
 * alert earns nothing). Nothing is written here.
 */
import { and, eq, gte, isNotNull, lt } from 'drizzle-orm';
import { getPointsBalance } from '../../account/points.js';
import { hasOpenHolderConflict } from '../../antifraud/holder-conflict.js';
import { dailyCloses, rewards, streaks } from '../../db/schema.js';
import {
  applyDailyClose,
  type CloseLevel,
  INITIAL_STREAK,
  type IsoDate,
  isSunday,
  nextRewardHint,
  type StreakState,
  weeklyBonus,
  weekStart,
} from '../../domain/index.js';
import type { DbOrTx } from '../../ledger/types.js';

export interface PointsPreview {
  points: number;
  /** Balance including `points`. */
  balance: number;
  nextReward: { name: string; missingPoints: number } | null;
}

export async function previewClosePoints(
  db: DbOrTx,
  userId: string,
  day: IsoDate,
  level: Exclude<CloseLevel, 'no_close'>,
): Promise<PointsPreview> {
  const [streak] = await db.select().from(streaks).where(eq(streaks.userId, userId));
  const state: StreakState = streak
    ? {
        days: streak.days,
        isoWeek: streak.isoWeek === '' ? null : streak.isoWeek,
        freezesUsed: streak.freezesUsed,
        firstStreakAwarded: streak.firstStreakAwarded,
      }
    : { ...INITIAL_STREAK };
  let points = applyDailyClose(state, day, level).points;

  if (isSunday(day)) {
    const week = await db
      .select({ level: dailyCloses.level })
      .from(dailyCloses)
      .where(
        and(
          eq(dailyCloses.userId, userId),
          gte(dailyCloses.businessDay, weekStart(day)),
          lt(dailyCloses.businessDay, day),
          isNotNull(dailyCloses.finalAt),
        ),
      );
    points += weeklyBonus([...week.map((row) => row.level ?? 'no_close'), level])?.points ?? 0;
  }
  if (await hasOpenHolderConflict(db, userId)) points = 0;

  const balance = (await getPointsBalance(db, userId)) + points;
  const catalog = await db
    .select({
      id: rewards.id,
      name: rewards.name,
      costPoints: rewards.costPoints,
      isBig: rewards.isBig,
    })
    .from(rewards)
    .where(eq(rewards.active, true));
  const hint = nextRewardHint(balance, catalog);
  return {
    points,
    balance,
    nextReward: hint ? { name: hint.reward.name, missingPoints: hint.missingPoints } : null,
  };
}
