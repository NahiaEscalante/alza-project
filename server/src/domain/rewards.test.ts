import { describe, expect, it } from 'vitest';
import {
  checkRedemption,
  countActiveWeeks,
  isPinFresh,
  milestoneProgress,
  nextRewardHint,
  type RewardOption,
  rejectedRedemptionRefund,
} from './rewards.js';
import { lima } from './test-support.js';
import { addDays } from './time.js';
import type { CloseLevel } from './types.js';

const CATALOG: RewardOption[] = [
  { id: 'inventory', name: 'Descuento en compra de mercadería', costPoints: 50, isBig: false },
  { id: 'school', name: 'Útiles escolares', costPoints: 100, isBig: false },
  { id: 'supplier', name: 'Descuento en proveedor', costPoints: 200, isBig: false },
  { id: 'kit', name: 'Kit de limpieza', costPoints: 400, isBig: false },
  { id: 'fridge', name: 'Electrodoméstico', costPoints: 2500, isBig: true },
];

describe('milestones (13.2)', () => {
  it('340 points: 50, 100 and 200 reached, 60 missing for 400, 2 160 for the big goal', () => {
    expect(milestoneProgress(340)).toEqual({
      reached: [50, 100, 200],
      next: 400,
      missingForNext: 60,
      missingForBigGoal: 2160,
    });
  });

  it('handles the ends of the bar', () => {
    expect(milestoneProgress(0)).toMatchObject({ reached: [], next: 50, missingForNext: 50 });
    expect(milestoneProgress(450)).toMatchObject({ next: null, missingForNext: 0 });
    expect(milestoneProgress(3000).missingForBigGoal).toBe(0);
  });

  it('«Te faltan X para {premio}»: cheapest regular reward not yet affordable, then the big one', () => {
    expect(nextRewardHint(340, CATALOG)).toEqual({ reward: CATALOG[3], missingPoints: 60 });
    expect(nextRewardHint(450, CATALOG)).toEqual({ reward: CATALOG[4], missingPoints: 2050 });
    expect(nextRewardHint(5000, CATALOG)).toBeNull();
  });
});

describe('redemption (13.3, PR11, PR18)', () => {
  const now = lima('2026-11-10T19:00');
  const pinVerifiedAt = lima('2026-11-10T18:55');

  it('HU-12: 340 points and a 100-point reward → delivered, balance goes to 240', () => {
    const result = checkRedemption({
      balance: 340,
      reward: CATALOG[1] as RewardOption,
      activeWeeks: 1,
      pinVerifiedAt,
      now,
    });
    expect(result).toEqual({ ok: true, status: 'delivered', pointsDelta: -100 });
    if (result.ok) expect(340 + result.pointsDelta).toBe(240);
  });

  it('rejects without enough points or without a fresh PIN', () => {
    expect(
      checkRedemption({
        balance: 340,
        reward: CATALOG[3] as RewardOption,
        activeWeeks: 9,
        pinVerifiedAt,
        now,
      }),
    ).toEqual({
      ok: false,
      reason: 'insufficient_points',
      missingPoints: 60,
    });
    expect(
      checkRedemption({
        balance: 340,
        reward: CATALOG[0] as RewardOption,
        activeWeeks: 9,
        pinVerifiedAt: lima('2026-11-10T18:49'),
        now,
      }),
    ).toEqual({ ok: false, reason: 'pin_required' });
    expect(isPinFresh(null, now)).toBe(false);
    expect(isPinFresh(lima('2026-11-10T18:50'), now)).toBe(true);
  });

  it('HU-12: a big reward with fewer than 8 active weeks says how many are missing', () => {
    expect(
      checkRedemption({
        balance: 3000,
        reward: CATALOG[4] as RewardOption,
        activeWeeks: 5,
        pinVerifiedAt,
        now,
      }),
    ).toEqual({
      ok: false,
      reason: 'needs_active_weeks',
      missingWeeks: 3,
    });
    expect(
      checkRedemption({
        balance: 3000,
        reward: CATALOG[4] as RewardOption,
        activeWeeks: 8,
        pinVerifiedAt,
        now,
      }),
    ).toEqual({
      ok: true,
      status: 'in_review',
      pointsDelta: -2500,
    });
    expect(rejectedRedemptionRefund(-2500)).toEqual({ type: 'adjustment', points: 2500 });
  });

  it('an active week has at least 3 complete or partial closes', () => {
    const week = (monday: string, levels: CloseLevel[]) =>
      levels.map((level, i) => ({ businessDay: addDays(monday, i), level }));
    const closes = [
      ...week('2026-11-02', ['complete', 'partial', 'partial', 'no_close']),
      ...week('2026-11-09', ['complete', 'complete', 'no_close', 'no_close', 'no_close']),
      ...week('2026-11-16', ['partial', 'partial', 'partial']),
    ];
    expect(countActiveWeeks(closes)).toBe(2);
  });
});
