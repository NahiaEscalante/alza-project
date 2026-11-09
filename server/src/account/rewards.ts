/**
 * Rewards (13.2, 13.3, D20, D22, D23, HU-12). The catalog is an example for the demo (3.2) and
 * the screen says so. Redeeming needs balance ≥ cost and the PIN in the last 10 minutes; big
 * rewards also 8 active weeks and go `in_review` (the team releases the code in the panel).
 */
import { randomInt } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  pointsEntries,
  type Redemption,
  type Reward,
  redemptions,
  rewards,
  users,
} from '../db/schema.js';
import { BIG_GOAL, checkRedemption, REQUIRED_ACTIVE_WEEKS } from '../domain/index.js';
import { REDEMPTION_STATUS_TEXT } from '../ledger/labels.js';
import { type DbOrTx, inTransaction } from '../ledger/types.js';
import { getActiveWeeks, getPointsBalance } from './points.js';

/** 13.2 example catalog, one or two per milestone, plus the big goal. */
export const EXAMPLE_REWARDS: readonly Pick<
  Reward,
  'name' | 'category' | 'costPoints' | 'isBig'
>[] = [
  {
    name: 'Descuento en compra de mercadería',
    category: 'inventory_purchase',
    costPoints: 50,
    isBig: false,
  },
  {
    name: 'Descuento en pago de servicios',
    category: 'utility_bills',
    costPoints: 50,
    isBig: false,
  },
  { name: 'Útiles escolares', category: 'school_supplies', costPoints: 100, isBig: false },
  { name: 'Artículos de limpieza', category: 'cleaning', costPoints: 100, isBig: false },
  { name: 'Descuento en tu proveedor', category: 'supplier', costPoints: 200, isBig: false },
  {
    name: 'Descuento mayor en tu proveedor',
    category: 'supplier',
    costPoints: 400,
    isBig: false,
  },
  { name: 'Kit escolar completo', category: 'school_kit', costPoints: 400, isBig: false },
  { name: 'Electrodoméstico', category: 'appliance', costPoints: BIG_GOAL, isBig: true },
];

/**
 * Example rewards taken out of the catalog (D76). They are deactivated, never deleted, so past
 * redemptions keep their reward.
 */
export const RETIRED_EXAMPLE_REWARDS: readonly string[] = [
  'Descuento en app de comida',
  'Descuento en app de transporte',
];

/**
 * Inserts the example rewards that are missing (by name) and deactivates the retired ones.
 * Returns how many were added.
 */
export async function ensureRewardsCatalog(db: DbOrTx): Promise<number> {
  return inTransaction(db, async (tx) => {
    await tx
      .update(rewards)
      .set({ active: false })
      .where(
        and(
          eq(rewards.isExample, true),
          eq(rewards.active, true),
          inArray(rewards.name, [...RETIRED_EXAMPLE_REWARDS]),
        ),
      );
    const existing = await tx
      .select({ name: rewards.name })
      .from(rewards)
      .where(eq(rewards.isExample, true));
    const names = new Set(existing.map((row) => row.name));
    const missing = EXAMPLE_REWARDS.filter((reward) => !names.has(reward.name));
    if (missing.length > 0) {
      await tx
        .insert(rewards)
        .values(missing.map((reward) => ({ ...reward, isExample: true, active: true })));
    }
    return missing.length;
  });
}

// ---------------------------------------------------------------------------

export interface RewardItem {
  id: string;
  name: string;
  costPoints: number;
  isExample: boolean;
  canRedeem: boolean;
  missingPoints: number;
}

export interface RedemptionItem {
  id: string;
  rewardName: string;
  points: number;
  status: Redemption['status'];
  statusText: string;
  /** DEMO-XXXX; null while in review. */
  code: string | null;
  createdAt: string;
}

export interface RewardsView {
  balance: number;
  /** Regular rewards grouped by cost (the bar's milestones, 13.2). */
  milestones: { points: number; reached: boolean; rewards: RewardItem[] }[];
  bigGoal: {
    rewards: RewardItem[];
    costPoints: number;
    missingPoints: number;
    activeWeeks: number;
    requiredActiveWeeks: number;
    missingWeeks: number;
  };
  redemptions: RedemptionItem[];
}

export async function getRewardsView(db: Db, userId: string): Promise<RewardsView> {
  const [balance, activeWeeks, catalog, history] = await Promise.all([
    getPointsBalance(db, userId),
    getActiveWeeks(db, userId),
    db.select().from(rewards).where(eq(rewards.active, true)),
    db
      .select({ redemption: redemptions, rewardName: rewards.name })
      .from(redemptions)
      .innerJoin(rewards, eq(rewards.id, redemptions.rewardId))
      .where(eq(redemptions.userId, userId))
      .orderBy(desc(redemptions.createdAt)),
  ]);

  const missingWeeks = Math.max(0, REQUIRED_ACTIVE_WEEKS - activeWeeks);
  const item = (reward: Reward): RewardItem => ({
    id: reward.id,
    name: reward.name,
    costPoints: reward.costPoints,
    isExample: reward.isExample,
    canRedeem: balance >= reward.costPoints && (!reward.isBig || missingWeeks === 0),
    missingPoints: Math.max(0, reward.costPoints - balance),
  });
  const sorted = [...catalog].sort(
    (a, b) => a.costPoints - b.costPoints || a.name.localeCompare(b.name, 'es'),
  );
  const regular = sorted.filter((reward) => !reward.isBig);
  const costs = [...new Set(regular.map((reward) => reward.costPoints))];

  return {
    balance,
    milestones: costs.map((points) => ({
      points,
      reached: balance >= points,
      rewards: regular.filter((reward) => reward.costPoints === points).map(item),
    })),
    bigGoal: {
      rewards: sorted.filter((reward) => reward.isBig).map(item),
      costPoints: BIG_GOAL,
      missingPoints: Math.max(0, BIG_GOAL - balance),
      activeWeeks,
      requiredActiveWeeks: REQUIRED_ACTIVE_WEEKS,
      missingWeeks,
    },
    redemptions: history.map(({ redemption, rewardName }) => ({
      id: redemption.id,
      rewardName,
      points: redemption.points,
      status: redemption.status,
      statusText: REDEMPTION_STATUS_TEXT[redemption.status],
      code: redemption.code,
      createdAt: redemption.createdAt.toISOString(),
    })),
  };
}

// ---------------------------------------------------------------------------

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** `DEMO-XXXX` (13.3), without look-alike characters (0/O, 1/I). */
export function demoRedemptionCode(): string {
  let code = '';
  for (let i = 0; i < 4; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `DEMO-${code}`;
}

export type RedeemResult =
  | {
      ok: true;
      redemption: RedemptionItem;
      balance: number;
      message: string;
    }
  | { ok: false; error: 'not_found'; message: string }
  | { ok: false; error: 'pin_required'; message: string }
  | { ok: false; error: 'insufficient_points'; missingPoints: number; message: string }
  | { ok: false; error: 'needs_active_weeks'; missingWeeks: number; message: string };

export const REDEEM_MESSAGES = {
  not_found: 'No encontramos ese premio.',
  pin_required: 'Para canjear, escribe tu PIN.',
  insufficient: (missing: number) => `Te faltan ${missing} puntos para este premio.`,
  needsWeeks: (missing: number) =>
    `Para los premios grandes necesitas ${REQUIRED_ACTIVE_WEEKS} semanas activas (con al menos 3 cierres). Te faltan ${missing}.`,
  delivered: (code: string) => `¡Listo! Tu código es ${code}.`,
  inReview: 'Tu canje quedó en revisión. Cuando el equipo lo apruebe, verás tu código aquí.',
} as const;

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  return (e?.code ?? e?.cause?.code) === '23505';
}

/** Redeems a reward (13.3). Serialized per user, so two taps never spend the points twice. */
export async function redeemReward(
  db: Db,
  input: { userId: string; rewardId: string; pinVerifiedAt: Date | null; now: Date },
): Promise<RedeemResult> {
  return inTransaction(db, async (tx): Promise<RedeemResult> => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).for('update');
    const [reward] = await tx
      .select()
      .from(rewards)
      .where(and(eq(rewards.id, input.rewardId), eq(rewards.active, true)));
    if (!reward) return { ok: false, error: 'not_found', message: REDEEM_MESSAGES.not_found };

    const [balance, activeWeeks] = await Promise.all([
      getPointsBalance(tx, input.userId),
      getActiveWeeks(tx, input.userId),
    ]);
    const check = checkRedemption({
      balance,
      reward,
      activeWeeks,
      pinVerifiedAt: input.pinVerifiedAt,
      now: input.now,
    });
    if (!check.ok) {
      switch (check.reason) {
        case 'pin_required':
          return { ok: false, error: 'pin_required', message: REDEEM_MESSAGES.pin_required };
        case 'insufficient_points':
          return {
            ok: false,
            error: 'insufficient_points',
            missingPoints: check.missingPoints,
            message: REDEEM_MESSAGES.insufficient(check.missingPoints),
          };
        case 'needs_active_weeks':
          return {
            ok: false,
            error: 'needs_active_weeks',
            missingWeeks: check.missingWeeks,
            message: REDEEM_MESSAGES.needsWeeks(check.missingWeeks),
          };
      }
    }

    let redemption: Redemption | undefined;
    for (let attempt = 0; attempt < 5 && !redemption; attempt++) {
      const code = check.status === 'delivered' ? demoRedemptionCode() : null;
      try {
        // Savepoint: a code collision retries without aborting the transaction.
        [redemption] = await tx.transaction((sp) =>
          sp
            .insert(redemptions)
            .values({
              userId: input.userId,
              rewardId: reward.id,
              points: reward.costPoints,
              status: check.status,
              code,
              createdAt: input.now,
            })
            .returning(),
        );
      } catch (err) {
        if (!isUniqueViolation(err) || code === null) throw err;
      }
    }
    if (!redemption) throw new Error('could not generate a unique redemption code');

    await tx.insert(pointsEntries).values({
      userId: input.userId,
      type: 'redemption',
      points: check.pointsDelta,
      referenceId: redemption.id,
      createdAt: input.now,
    });
    return {
      ok: true,
      redemption: {
        id: redemption.id,
        rewardName: reward.name,
        points: redemption.points,
        status: redemption.status,
        statusText: REDEMPTION_STATUS_TEXT[redemption.status],
        code: redemption.code,
        createdAt: redemption.createdAt.toISOString(),
      },
      balance: balance + check.pointsDelta,
      message: redemption.code
        ? REDEEM_MESSAGES.delivered(redemption.code)
        : REDEEM_MESSAGES.inReview,
    };
  });
}
