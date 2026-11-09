import { describe, expect, it } from 'vitest';
import {
  type CounterpartyRuleView,
  decideCategory,
  isCategoryValidFor,
  outflowMemoryRule,
  shouldOfferPersonalRule,
} from './categories.js';

const memory: CounterpartyRuleView = {
  counterpartyNormalized: 'distribuidora sur',
  direction: 'out',
  category: 'inventory',
  source: 'memory',
  active: true,
};
const personal: CounterpartyRuleView = {
  counterpartyNormalized: 'carlos r',
  direction: 'in',
  category: 'personal',
  source: 'accepted',
  active: true,
};

describe('decideCategory (11.3)', () => {
  it('incoming is a sale by default (D09), even from her brother', () => {
    expect(
      decideCategory({ direction: 'in', counterpartyNormalized: 'juan q', rules: [] }),
    ).toEqual({
      category: 'sale',
      fromHistory: false,
      needsCategoryDoubt: false,
    });
  });

  it('incoming follows what she says or an accepted personal rule', () => {
    expect(
      decideCategory({
        direction: 'in',
        counterpartyNormalized: null,
        stated: 'other_income',
        rules: [],
      }).category,
    ).toBe('other_income');
    expect(
      decideCategory({ direction: 'in', counterpartyNormalized: 'carlos r', rules: [personal] }),
    ).toEqual({
      category: 'personal',
      fromHistory: true,
      needsCategoryDoubt: false,
    });
    expect(
      decideCategory({
        direction: 'in',
        counterpartyNormalized: 'carlos r',
        rules: [{ ...personal, active: false }],
      }).category,
    ).toBe('sale');
  });

  it('outgoing: stated > history > suggestion > unclassified with a doubt (PR15)', () => {
    const base = { direction: 'out' as const, counterpartyNormalized: 'distribuidora sur' };
    expect(decideCategory({ ...base, stated: 'expense', rules: [memory] }).category).toBe(
      'expense',
    );
    expect(decideCategory({ ...base, suggested: 'household', rules: [memory] })).toEqual({
      category: 'inventory',
      fromHistory: true,
      needsCategoryDoubt: false,
    });
    expect(decideCategory({ ...base, suggested: 'inventory', rules: [] }).category).toBe(
      'inventory',
    );
    expect(decideCategory({ ...base, rules: [] })).toEqual({
      category: 'unclassified',
      fromHistory: false,
      needsCategoryDoubt: true,
    });
  });

  it('ignores categories that do not fit the direction', () => {
    expect(isCategoryValidFor('sale', 'out')).toBe(false);
    expect(isCategoryValidFor('internal', 'out')).toBe(true);
    expect(
      decideCategory({ direction: 'out', counterpartyNormalized: null, stated: 'sale', rules: [] })
        .category,
    ).toBe('unclassified');
  });
});

describe('counterparty memory (PR14)', () => {
  it('offers the personal rule from the third mark on, once', () => {
    expect(shouldOfferPersonalRule({ personalMarks: 2, hasActiveRule: false })).toBe(false);
    expect(shouldOfferPersonalRule({ personalMarks: 3, hasActiveRule: false })).toBe(true);
    expect(shouldOfferPersonalRule({ personalMarks: 4, hasActiveRule: true })).toBe(false);
  });

  it('remembers outgoing classifications only', () => {
    expect(outflowMemoryRule('distribuidora sur', 'inventory')).toEqual({
      counterpartyNormalized: 'distribuidora sur',
      direction: 'out',
      category: 'inventory',
      source: 'memory',
    });
    expect(outflowMemoryRule('ana t', 'sale')).toBeNull();
    expect(outflowMemoryRule(null, 'expense')).toBeNull();
    expect(outflowMemoryRule('x', 'unclassified')).toBeNull();
  });
});
