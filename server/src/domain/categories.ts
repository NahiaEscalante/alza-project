/**
 * Categories (11.3, D09, PR14, PR15).
 *
 * - Incoming: always a sale unless she says otherwise, or she accepted the «personal» rule for that
 *   counterparty (offered after marking it personal 3 times).
 * - Outgoing: what she said; else the last category she chose for that counterparty («según tu
 *   historial»); else what the reader suggests (e.g. a distributor → inventory); else
 *   «por clasificar», which counts in «salió» and creates a low-priority `category` doubt.
 */
import type { Category, Direction } from './types.js';

const VALID_DIRECTIONS: Record<Category, readonly Direction[]> = {
  sale: ['in'],
  other_income: ['in'],
  inventory: ['out'],
  expense: ['out'],
  household: ['out'],
  unclassified: ['out'],
  internal: ['in', 'out'],
  personal: ['in', 'out'],
};

export function isCategoryValidFor(category: Category, direction: Direction): boolean {
  return VALID_DIRECTIONS[category].includes(direction);
}

/** Subset of `counterparty_rules`. */
export interface CounterpartyRuleView {
  counterpartyNormalized: string;
  direction: Direction;
  category: Category;
  source: 'memory' | 'accepted';
  active: boolean;
}

export interface CategoryDecision {
  category: Category;
  /** Show «según tu historial». */
  fromHistory: boolean;
  /** PR15: create a `category` doubt (priority 6). */
  needsCategoryDoubt: boolean;
}

export function decideCategory(input: {
  direction: Direction;
  counterpartyNormalized: string | null;
  /** What she said in text, audio or the close reply. */
  stated?: Category | null;
  /** What the reader or the AI suggests (categoria_sugerida). */
  suggested?: Category | null;
  rules: readonly CounterpartyRuleView[];
}): CategoryDecision {
  const { direction } = input;
  const valid = (category: Category | null | undefined): category is Category =>
    category !== null && category !== undefined && isCategoryValidFor(category, direction);
  const decided = (category: Category, fromHistory = false): CategoryDecision => ({
    category,
    fromHistory,
    needsCategoryDoubt: category === 'unclassified',
  });

  if (valid(input.stated)) return decided(input.stated);
  const rule = input.rules.find(
    (candidate) =>
      candidate.active &&
      candidate.direction === direction &&
      candidate.counterpartyNormalized === input.counterpartyNormalized &&
      isCategoryValidFor(candidate.category, direction),
  );

  if (direction === 'in') {
    if (rule && rule.source === 'accepted' && rule.category === 'personal') {
      return decided('personal', true);
    }
    return decided('sale');
  }
  if (rule && rule.source === 'memory') return decided(rule.category, true);
  if (valid(input.suggested) && input.suggested !== 'personal') return decided(input.suggested);
  return decided('unclassified');
}

/** Marks needed before the web offers «¿Quieres que los Yapes de {contraparte} no cuenten…?». */
export const PERSONAL_RULE_OFFER_MARKS = 3;

/** Case 25 (PR14): offer the rule after the 3rd «personal» mark, if it does not exist yet. */
export function shouldOfferPersonalRule(input: {
  personalMarks: number;
  hasActiveRule: boolean;
}): boolean {
  return input.personalMarks >= PERSONAL_RULE_OFFER_MARKS && !input.hasActiveRule;
}

/** PR14: when she classifies an outgoing payment, remember it for that counterparty. */
export function outflowMemoryRule(
  counterpartyNormalized: string | null,
  category: Category,
): Omit<CounterpartyRuleView, 'active'> | null {
  if (
    !counterpartyNormalized ||
    !isCategoryValidFor(category, 'out') ||
    category === 'unclassified'
  ) {
    return null;
  }
  return { counterpartyNormalized, direction: 'out', category, source: 'memory' };
}
