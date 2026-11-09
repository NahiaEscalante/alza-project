import { describe, expect, it } from 'vitest';
import {
  checkOperationDuplicate,
  findMentionForScreenshot,
  findScreenshotForMention,
  isSameFile,
  normalizeOperationNumber,
  type OperationCandidate,
} from './duplicates.js';
import { entry, lima, screenshotEntry } from './test-support.js';

function candidate(overrides: Partial<OperationCandidate> = {}): OperationCandidate {
  return {
    amountCents: 2000,
    direction: 'in',
    paymentMethod: 'yape',
    counterpartyNormalized: 'rosa m',
    operationNumber: null,
    operationAt: lima('2026-11-10T15:10'),
    ...overrides,
  };
}

describe('isSameFile', () => {
  it('compares SHA-256 case-insensitively', () => {
    expect(isSameFile('ABC123', ['x', 'abc123'])).toBe(true);
    expect(isSameFile('abc124', ['abc123'])).toBe(false);
  });
});

describe('normalizeOperationNumber', () => {
  it('drops spaces and dashes but keeps leading zeros', () => {
    expect(normalizeOperationNumber(' 0000-4283 ')).toBe('00004283');
    expect(normalizeOperationNumber('')).toBeNull();
    expect(normalizeOperationNumber(null)).toBeNull();
  });
});

describe('checkOperationDuplicate (11.4)', () => {
  it('same method and operation number as a live entry → exact duplicate', () => {
    const existing = screenshotEntry({ id: 'a', operationNumber: '32811444' });
    expect(checkOperationDuplicate(candidate({ operationNumber: '32811444' }), [existing])).toEqual(
      {
        kind: 'exact_duplicate',
        entryId: 'a',
      },
    );
  });

  it('same operation number on another method is not a duplicate', () => {
    const existing = screenshotEntry({ operationNumber: '32811444', paymentMethod: 'plin' });
    expect(checkOperationDuplicate(candidate({ operationNumber: '32811444' }), [existing])).toEqual(
      {
        kind: 'new',
      },
    );
  });

  it('a voided or superseded entry with the same number does not block a new one', () => {
    const voided = screenshotEntry({ operationNumber: '1', status: 'voided' });
    const superseded = screenshotEntry({ operationNumber: '1', status: 'superseded' });
    expect(
      checkOperationDuplicate(candidate({ operationNumber: '1' }), [voided, superseded]),
    ).toEqual({ kind: 'new' });
  });

  it('different operation numbers are never duplicates, even if everything else matches', () => {
    const existing = screenshotEntry({
      operationNumber: '111',
      amountCents: 2000,
      counterpartyNormalized: 'rosa m',
      operationAt: lima('2026-11-10T15:10'),
    });
    expect(checkOperationDuplicate(candidate({ operationNumber: '222' }), [existing])).toEqual({
      kind: 'new',
    });
  });

  it('no operation number, same amount/direction/counterparty within 2 minutes → possible duplicate', () => {
    const existing = screenshotEntry({
      id: 'b',
      amountCents: 2000,
      counterpartyNormalized: 'rosa m',
      operationAt: lima('2026-11-10T15:08'),
    });
    expect(checkOperationDuplicate(candidate(), [existing])).toEqual({
      kind: 'possible_duplicate',
      entryId: 'b',
    });
  });

  it.each([
    ['3 minutes apart', { operationAt: lima('2026-11-10T15:07') }],
    ['another amount', { amountCents: 2500 }],
    ['another counterparty', { counterpartyNormalized: 'ana t' }],
    ['another direction', { direction: 'out' as const }],
    ['no time on the existing entry', { operationAt: null }],
  ])('no operation number but %s → new', (_label, overrides) => {
    const existing = screenshotEntry({
      amountCents: 2000,
      counterpartyNormalized: 'rosa m',
      operationAt: lima('2026-11-10T15:10'),
      ...overrides,
    });
    expect(checkOperationDuplicate(candidate(), [existing])).toEqual({ kind: 'new' });
  });

  it('cash is never compared with screenshots, in either direction', () => {
    const cash = entry({ amountCents: 2000, operationAt: lima('2026-11-10T15:10') });
    expect(checkOperationDuplicate(candidate({ counterpartyNormalized: null }), [cash])).toEqual({
      kind: 'new',
    });
    const screenshot = screenshotEntry({
      amountCents: 2000,
      operationAt: lima('2026-11-10T15:10'),
    });
    expect(
      checkOperationDuplicate(candidate({ paymentMethod: 'cash', counterpartyNormalized: null }), [
        screenshot,
      ]),
    ).toEqual({ kind: 'new' });
  });
});

describe('text mention linked to a screenshot (11.4)', () => {
  const rosa = screenshotEntry({
    id: 'rosa',
    amountCents: 2000,
    counterparty: 'Rosa Mendoza',
    counterpartyNormalized: 'rosa mendoza',
    operationAt: lima('2026-11-10T15:10'),
  });

  it('«me yapearon 20 de Rosa» links to the matching screenshot and adds nothing', () => {
    const mention = {
      amountCents: 2000,
      direction: 'in' as const,
      paymentMethod: 'yape' as const,
      counterpartyName: 'Rosa',
      businessDay: '2026-11-10',
    };
    expect(findScreenshotForMention(mention, [rosa])?.id).toBe('rosa');
    expect(findScreenshotForMention(mention, [rosa], new Set(['rosa']))).toBeNull();
    expect(findScreenshotForMention({ ...mention, counterpartyName: 'Ana' }, [rosa])).toBeNull();
    expect(findScreenshotForMention({ ...mention, amountCents: 2100 }, [rosa])).toBeNull();
    expect(findScreenshotForMention({ ...mention, businessDay: '2026-11-11' }, [rosa])).toBeNull();
    expect(findScreenshotForMention({ ...mention, paymentMethod: 'plin' }, [rosa])).toBeNull();
  });

  it('picks the screenshot closest in time when several match', () => {
    const early = screenshotEntry({
      id: 'early',
      amountCents: 500,
      operationAt: lima('2026-11-10T09:00'),
    });
    const late = screenshotEntry({
      id: 'late',
      amountCents: 500,
      operationAt: lima('2026-11-10T18:00'),
    });
    const mention = {
      amountCents: 500,
      direction: 'in' as const,
      paymentMethod: 'unknown' as const,
      counterpartyName: null,
      businessDay: '2026-11-10',
      at: lima('2026-11-10T17:30'),
    };
    expect(findScreenshotForMention(mention, [early, late])?.id).toBe('late');
  });

  it('a screenshot that arrives after the mention supersedes the self-reported entry', () => {
    const said = entry({
      id: 'said',
      paymentMethod: 'yape',
      amountCents: 2000,
      counterparty: 'Rosa',
      counterpartyNormalized: 'rosa',
    });
    const screenshot = {
      amountCents: 2000,
      direction: 'in' as const,
      paymentMethod: 'yape' as const,
      counterpartyName: 'Rosa Mendoza',
      businessDay: '2026-11-10',
      operationAt: lima('2026-11-10T15:10'),
    };
    expect(findMentionForScreenshot(screenshot, [said])?.id).toBe('said');
    const cashSale = entry({ amountCents: 2000 });
    expect(findMentionForScreenshot(screenshot, [cashSale])).toBeNull();
  });
});
