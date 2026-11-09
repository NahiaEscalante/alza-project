/**
 * HU-07 (answering the close in one message) and HU-08 (points and freezes) expressed with the
 * domain functions, with explicit timestamps.
 */
import { describe, expect, it } from 'vitest';
import {
  addDays,
  applyDailyClose,
  closeLevelAfterReply,
  closeReplyFollowUp,
  computeIndicators,
  decideCategory,
  expectedCashChange,
  finalCloseLevel,
  INITIAL_STREAK,
  isoWeekOf,
  type LedgerEntryView,
  type PointsAward,
  parseAmountToCents,
  pointsBalance,
  resolveAmbiguousTotal,
  resolveCashCheck,
  type StreakState,
  weeklyBonus,
} from './index.js';
import { entry, screenshotEntry } from './test-support.js';

/**
 * Tuesday 10 Nov: two cash sales (S/95) and one Yape (S/30). The close asks:
 * 1️⃣ an unreadable screenshot, 2️⃣ «hoy vendí 150» (ambiguous total), 3️⃣ the cash check.
 */
function tuesday(): LedgerEntryView[] {
  return [
    entry({ amountCents: 4_500 }),
    entry({ amountCents: 5_000 }),
    screenshotEntry({ amountCents: 3_000 }),
  ];
}

describe('HU-07 · answering the close in one message', () => {
  it('«1 son 12, 2 solo efectivo, 3 sí» → 1 resolved with S/12, 2 as a cash total, cash verified, complete', () => {
    const entries = tuesday();
    const amount = parseAmountToCents('12');
    if (!amount.ok) throw new Error('amount');
    entries.push(screenshotEntry({ amountCents: amount.cents }));

    const total = resolveAmbiguousTotal(15_000, 'cash', entries);
    expect(total).toMatchObject({
      kind: 'record_unitemized',
      amountCents: 5_500,
      paymentMethod: 'cash',
    });
    if (total.kind === 'record_unitemized') {
      entries.push(entry({ amountCents: total.amountCents, label: 'unitemized' }));
    }

    const cash = resolveCashCheck('yes', 0);
    expect(cash).toEqual({ kind: 'resolved', result: 'balanced', verified: true });
    expect(closeReplyFollowUp({ unresolvedNumbers: [], roundsUsed: 0 })).toEqual({
      kind: 'finish',
    });
    expect(
      closeLevelAfterReply({ messageClarificationsResolved: true, cashCheck: 'balanced' }),
    ).toBe('complete');
    expect(computeIndicators(entries)).toMatchObject({
      cashSalesCents: 15_000,
      digitalSalesCents: 4_200,
    });
  });

  it('«1 son 12, 3 sí» (2 missing) → asks only for 2; after 2 rounds without it, partial', () => {
    expect(closeReplyFollowUp({ unresolvedNumbers: [2], roundsUsed: 0 })).toEqual({
      kind: 'ask_again',
      numbers: [2],
    });
    expect(closeReplyFollowUp({ unresolvedNumbers: [2], roundsUsed: 1 })).toEqual({
      kind: 'ask_again',
      numbers: [2],
    });
    expect(closeReplyFollowUp({ unresolvedNumbers: [2], roundsUsed: 2 })).toEqual({
      kind: 'finish',
    });
    expect(
      finalCloseLevel({
        closeSent: true,
        repliedInTime: true,
        messageClarificationsResolved: false,
        cashCheck: 'balanced',
      }),
    ).toBe('partial');
  });

  it('«3 no, saqué 40 para la casa» → S/40 cash household «lo contaste tú», cash verified', () => {
    const entries = tuesday();
    const before = expectedCashChange(entries);
    const category = decideCategory({
      direction: 'out',
      counterpartyNormalized: null,
      stated: 'household',
      rules: [],
    });
    const withdrawal = entry({
      amountCents: 4_000,
      direction: 'out',
      category: category.category,
      label: 'self_reported',
      source: 'close_reply',
    });
    entries.push(withdrawal);
    expect(withdrawal).toMatchObject({
      category: 'household',
      paymentMethod: 'cash',
      label: 'self_reported',
    });
    expect(expectedCashChange(entries)).toBe(before - 4_000);
    expect(resolveCashCheck('no_explained', 0)).toEqual({
      kind: 'resolved',
      result: 'adjusted',
      verified: true,
    });
    expect(
      closeLevelAfterReply({ messageClarificationsResolved: true, cashCheck: 'adjusted' }),
    ).toBe('complete');
  });

  it('«3 no sé» → cash «sin revisar», partial close', () => {
    const cash = resolveCashCheck('unsure', 0);
    expect(cash).toEqual({ kind: 'resolved', result: 'unsure', verified: false });
    expect(closeLevelAfterReply({ messageClarificationsResolved: true, cashCheck: 'unsure' })).toBe(
      'partial',
    );
  });
});

describe('HU-08 · points and freezes over a simulated week', () => {
  /** Runs the 12:00 job for each day of the week starting Monday 9 Nov 2026. */
  function simulate(
    levels: Parameters<typeof applyDailyClose>[2][],
    state: StreakState = INITIAL_STREAK,
  ) {
    const ledger: PointsAward[] = [];
    let current = state;
    const days = levels.map((level, i) => {
      const result = applyDailyClose(current, addDays('2026-11-09', i), level);
      current = result.state;
      ledger.push(...result.awards);
      return result;
    });
    return { days, state: current, ledger };
  }

  it('a complete close adds 10 points and +1 to the streak at 12:00 of the next day', () => {
    const { days } = simulate(['complete']);
    expect(days[0]?.points).toBe(10);
    expect(days[0]?.state.days).toBe(1);
  });

  it('a day without close uses a freeze: streak kept, no points', () => {
    const { days } = simulate(['complete', 'no_close']);
    expect(days[1]).toMatchObject({ points: 0, freezeUsed: true });
    expect(days[1]?.state.days).toBe(1);
  });

  it('a third day without close in the same week resets the streak', () => {
    const { days } = simulate(['complete', 'no_close', 'partial', 'no_close', 'no_close']);
    expect(days[3]?.freezeUsed).toBe(true);
    expect(days[4]).toMatchObject({ freezeUsed: false, streakBroken: true });
    expect(days[4]?.state.days).toBe(0);
  });

  it('a full week: daily points, streak bonuses and Monday’s weekly bonus', () => {
    const levels = [
      'complete',
      'complete',
      'partial',
      'complete',
      'complete',
      'no_close',
      'complete',
    ] as const;
    const { state, ledger } = simulate([...levels]);
    expect(state).toMatchObject({ days: 6, freezesUsed: 1, isoWeek: isoWeekOf('2026-11-09') });
    const bonus = weeklyBonus(levels);
    expect(bonus).toEqual({ type: 'weekly_bonus', points: 15 });
    if (bonus) ledger.push(bonus);
    // 5 complete × 10 + 1 partial × 4 + weekly 15; the 7th streak day is not reached (freeze day).
    expect(pointsBalance(ledger)).toBe(69);
  });

  it('a partial close never spends a freeze', () => {
    const { state } = simulate(['partial', 'partial', 'partial']);
    expect(state.freezesUsed).toBe(0);
    expect(state.days).toBe(3);
  });
});
