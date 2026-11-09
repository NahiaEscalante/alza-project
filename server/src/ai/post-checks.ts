import type { PaymentMethod } from '../db/schema.js';
import { normalizeAmount } from './amount.js';
import type {
  CloseAnswer,
  CloseAnswerValue,
  CloseQuestion,
  CloseQuestionType,
  CloseReplyInterpretation,
  ScreenshotExtraction,
  ScreenshotLayout,
  ScreenshotOperation,
  TextInterpretation,
  TextOperation,
} from './schemas.js';

/**
 * Deterministic checks applied after ANY reader (OCR, vision, text models), Fase 2:
 * ≤ 2 decimals and positive amounts, no future dates, plausible operation numbers, and close-reply
 * answers that fit their question. A value that fails is dropped (null), never repaired.
 * Issues are codes only (safe to log).
 */

/** Clock skew tolerated between a phone screenshot and the server. */
const FUTURE_SKEW_MS = 10 * 60 * 1000;

const OPERATION_NUMBER_FORMATS: Record<ScreenshotLayout, RegExp> = {
  yape: /^\d{8}$/,
  bbva: /^\d{6,12}$/,
  bancom: /^[0-9a-f]{20,32}$/,
  luqea: /^[0-9a-f]{12,32}-\d{2,6}$/,
};

/** Operation numbers seen in Yape/Plin/bank receipts when the layout is unknown (vision). */
const GENERIC_OPERATION_NUMBER = /^[A-Za-z0-9][A-Za-z0-9-]{3,39}$/;

export function isPlausibleOperationNumber(
  value: string,
  layout: ScreenshotLayout | null,
  paymentMethod: PaymentMethod,
): boolean {
  if (layout) return OPERATION_NUMBER_FORMATS[layout].test(value);
  if (paymentMethod === 'yape') return /^\d{6,12}$/.test(value);
  return GENERIC_OPERATION_NUMBER.test(value) && /\d/.test(value);
}

export interface ScreenshotCheckOptions {
  now: Date;
  layout?: ScreenshotLayout | null;
}

export function checkScreenshotOperation(
  input: ScreenshotOperation,
  options: ScreenshotCheckOptions,
): { op: ScreenshotOperation; issues: string[] } {
  const issues: string[] = [];
  const op: ScreenshotOperation = { ...input, confidence: { ...input.confidence } };

  if (op.amount !== null) {
    const normalized = normalizeAmount(op.amount);
    if (normalized === null) {
      issues.push('amount_invalid');
      op.amount = null;
      op.confidence.amount = 0;
    } else {
      op.amount = normalized;
    }
  }

  if (op.occurred_at !== null) {
    const time = Date.parse(op.occurred_at);
    if (Number.isNaN(time) || time > options.now.getTime() + FUTURE_SKEW_MS) {
      issues.push('date_in_future');
      op.occurred_at = null;
      op.confidence.occurred_at = 0;
    }
  }

  if (op.operation_number !== null) {
    const compact = op.operation_number.replace(/\s+/g, '');
    if (!isPlausibleOperationNumber(compact, options.layout ?? null, op.payment_method)) {
      issues.push('operation_number_implausible');
      op.operation_number = null;
      op.confidence.operation_number = 0;
    } else {
      op.operation_number = compact;
    }
  }

  return { op, issues };
}

/**
 * Checks every operation and recomputes `legible`: a receipt or invoice is legible only if every
 * operation kept its amount; a list, if at least one row did. Non-financial images carry no
 * operations.
 */
export function checkScreenshotExtraction(
  input: ScreenshotExtraction,
  options: ScreenshotCheckOptions,
): { extraction: ScreenshotExtraction; issues: string[] } {
  const issues: string[] = [];
  if (input.content_type === 'non_financial' || input.content_type === 'other_financial') {
    if (input.operations.length > 0) issues.push('operations_dropped_non_payment');
    return { extraction: { ...input, legible: true, operations: [] }, issues };
  }
  const operations = input.operations.map((op) => {
    const checked = checkScreenshotOperation(op, options);
    issues.push(...checked.issues);
    return checked.op;
  });
  const withAmount = operations.filter((op) => op.amount !== null).length;
  const legible =
    input.content_type === 'activity_list'
      ? withAmount > 0
      : operations.length > 0 && withAmount === operations.length;
  return { extraction: { ...input, legible, operations }, issues };
}

/** A text/audio amount below this confidence is not registered silently (RF-EX-06). */
export const TEXT_MIN_AMOUNT_CONFIDENCE = 0.9;

/**
 * The amount of a text/audio operation that can be registered without asking, or null when it must
 * become a clarification: no amount («vendí pan»), an ambiguous one («tres cincuenta» with
 * alternatives) or low confidence.
 */
export function confidentTextAmount(op: TextOperation): string | null {
  if (op.amount === null || op.amount_alternatives.length > 0) return null;
  return (op.confidence.amount ?? 0) >= TEXT_MIN_AMOUNT_CONFIDENCE ? op.amount : null;
}

/** Text/audio: only «record» carries operations; alternatives never repeat the amount. */
export function checkTextInterpretation(input: TextInterpretation): {
  value: TextInterpretation;
  issues: string[];
} {
  const issues: string[] = [];
  let operations = input.operations;
  if (input.intent !== 'record' && operations.length > 0) {
    issues.push('operations_dropped_intent');
    operations = [];
  }
  operations = operations.map((op) => ({
    ...op,
    amount_alternatives: [
      ...new Set(op.amount_alternatives.filter((a): a is string => a !== null && a !== op.amount)),
    ],
    confidence: op.amount === null ? { ...op.confidence, amount: 0 } : { ...op.confidence },
  }));
  const correction = input.intent === 'correct' ? input.correction : null;
  if (input.intent === 'correct' && !correction) issues.push('correction_missing');
  const request = input.intent === 'request' ? input.request : null;
  if (input.intent === 'request' && !request) issues.push('request_kind_missing');
  return { value: { ...input, operations, correction, request }, issues };
}

/** Value keys an answer may carry per question type; the first one is required. */
const ANSWER_KEYS: Record<CloseQuestionType, (keyof CloseAnswerValue)[]> = {
  unreadable: ['amount'],
  ambiguous_total: ['payment_method', 'scope'],
  possible_duplicate: ['is_duplicate'],
  direction: ['direction'],
  date: ['is_today'],
  category: ['category'],
  missing_from_list: ['is_duplicate', 'category'],
  cash_check: ['cash_check'],
};

/**
 * Keeps only answers to questions that exist, with the value keys of their type. A «resolved»
 * answer without its required value moves to `not_understood`.
 */
export function checkCloseReply(
  input: CloseReplyInterpretation,
  questions: CloseQuestion[],
): { value: CloseReplyInterpretation; issues: string[] } {
  const issues: string[] = [];
  const byNumber = new Map(questions.map((q) => [q.number, q]));
  const answers: CloseAnswer[] = [];
  const notUnderstood = new Set<number>();
  const seen = new Set<number>();

  for (const answer of input.answers) {
    const question = byNumber.get(answer.number);
    if (!question) {
      issues.push('answer_unknown_number');
      continue;
    }
    if (seen.has(answer.number)) {
      issues.push('answer_repeated');
      continue;
    }
    seen.add(answer.number);
    const keys = ANSWER_KEYS[question.type];
    const value: CloseAnswerValue = {};
    for (const key of keys) {
      const v = answer.value[key];
      if (v !== undefined && v !== null) (value as Record<string, unknown>)[key] = v;
    }
    if (question.type === 'ambiguous_total' && value.payment_method && !value.scope) {
      value.scope = 'day_total';
    }
    const required = keys[0] as keyof CloseAnswerValue;
    if (answer.resolved && value[required] === undefined) {
      issues.push('answer_value_missing');
      notUnderstood.add(answer.number);
      continue;
    }
    answers.push(answer.resolved ? { ...answer, value } : { ...answer, value: {} });
  }

  for (const n of input.not_understood) {
    if (byNumber.has(n) && !seen.has(n)) notUnderstood.add(n);
  }
  for (const a of answers) notUnderstood.delete(a.number);

  return {
    value: {
      answers: answers.sort((a, b) => a.number - b.number),
      new_entries: input.new_entries,
      not_understood: [...notUnderstood].sort((a, b) => a - b),
    },
    issues,
  };
}
