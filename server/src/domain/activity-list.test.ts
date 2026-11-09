import { describe, expect, it } from 'vitest';
import { type ActivityListRow, dedupeListRows, reconcileActivityList } from './activity-list.js';
import { entry, lima, screenshotEntry } from './test-support.js';

function row(overrides: Partial<ActivityListRow> = {}): ActivityListRow {
  return {
    amountCents: 1_000,
    direction: 'in',
    paymentMethod: 'yape',
    counterpartyNormalized: 'ana t',
    operationNumber: null,
    operationAt: lima('2026-11-10T10:42'),
    ...overrides,
  };
}

describe('dedupeListRows (overlapping scroll)', () => {
  it('removes rows repeated across screenshots of the same list', () => {
    const a = row({ operationNumber: '1' });
    const b = row({ amountCents: 2_000, counterpartyNormalized: 'rosa m' });
    const c = row({ amountCents: 500, operationAt: lima('2026-11-10T11:00') });
    const firstShot = [a, b];
    const secondShot = [{ ...b }, { ...c }];
    expect(dedupeListRows([...firstShot, ...secondShot])).toEqual([a, b, c]);
  });
});

describe('reconcileActivityList (11.10)', () => {
  it('links rows by operation number or by amount/direction/counterparty ±2 min; the rest go to the web', () => {
    const byNumber = screenshotEntry({ id: 'n', operationNumber: '0001' });
    const byFuzzy = screenshotEntry({
      id: 'f',
      amountCents: 2_000,
      counterpartyNormalized: 'rosa m',
      operationAt: lima('2026-11-10T12:01'),
    });
    const rows = [
      row({ operationNumber: '0001' }),
      row({
        amountCents: 2_000,
        counterpartyNormalized: 'rosa m',
        operationAt: lima('2026-11-10T12:00'),
      }),
      row({
        amountCents: 300,
        counterpartyNormalized: 'luis p',
        operationAt: lima('2026-11-10T13:00'),
      }),
      row({ amountCents: 4_000, direction: 'out', counterpartyNormalized: 'dist sur' }),
    ];
    const result = reconcileActivityList(rows, [byNumber, byFuzzy]);
    expect(result.matched.map((m) => m.entryId)).toEqual(['n', 'f']);
    expect(result.missing).toHaveLength(2);
    expect(result.missingIncomingCount).toBe(1);
    expect(result.totalRows).toBe(4);
    expect(result.captureRate).toBe(0.5);
  });

  it('never links one entry to two equal rows, nor to a different operation number', () => {
    const only = screenshotEntry({
      id: 'only',
      amountCents: 200,
      counterpartyNormalized: 'nino',
      operationAt: lima('2026-11-10T16:00'),
    });
    const rows = [
      row({
        amountCents: 200,
        counterpartyNormalized: 'nino',
        operationAt: lima('2026-11-10T16:00'),
        operationNumber: 'A',
      }),
      row({
        amountCents: 200,
        counterpartyNormalized: 'nino',
        operationAt: lima('2026-11-10T16:01'),
        operationNumber: 'B',
      }),
    ];
    const result = reconcileActivityList(rows, [only]);
    expect(result.matched).toHaveLength(1);
    expect(result.missing).toHaveLength(1);

    const numbered = screenshotEntry({ operationNumber: 'X1' });
    expect(
      reconcileActivityList([row({ operationNumber: 'X2' })], [numbered]).missing,
    ).toHaveLength(1);
  });

  it('ignores cash entries and dead entries; an empty list has rate 0', () => {
    const cash = entry({ amountCents: 1_000, operationAt: lima('2026-11-10T10:42') });
    const voided = screenshotEntry({ status: 'voided', operationNumber: '9' });
    const result = reconcileActivityList(
      [row({ counterpartyNormalized: null }), row({ operationNumber: '9' })],
      [cash, voided],
    );
    expect(result.matched).toHaveLength(0);
    expect(reconcileActivityList([], []).captureRate).toBe(0);
  });
});
