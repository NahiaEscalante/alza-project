import { describe, expect, it } from 'vitest';
import {
  checkCloseReply,
  checkScreenshotExtraction,
  checkScreenshotOperation,
  checkTextInterpretation,
  isPlausibleOperationNumber,
} from './post-checks.js';
import {
  type CloseQuestion,
  closeReplyInterpretationSchema,
  type ScreenshotOperation,
  screenshotOperationSchema,
  textInterpretationSchema,
} from './schemas.js';

const NOW = new Date('2026-11-08T15:00:00-05:00');

const op = (fields: Partial<ScreenshotOperation> = {}): ScreenshotOperation =>
  screenshotOperationSchema.parse({
    amount: '20.00',
    payment_method: 'yape',
    occurred_at: '2026-11-08T10:00:00-05:00',
    operation_number: '32811444',
    confidence: { amount: 0.97 },
    ...fields,
  });

describe('screenshot post-checks', () => {
  it('keeps a valid operation', () => {
    const { op: checked, issues } = checkScreenshotOperation(op(), { now: NOW, layout: 'yape' });
    expect(issues).toEqual([]);
    expect(checked.amount).toBe('20.00');
  });

  it('drops a date in the future (beyond 10 minutes of clock skew)', () => {
    const future = checkScreenshotOperation(op({ occurred_at: '2026-11-09T10:00:00-05:00' }), {
      now: NOW,
    });
    expect(future.op.occurred_at).toBeNull();
    expect(future.issues).toContain('date_in_future');
    const skew = checkScreenshotOperation(op({ occurred_at: '2026-11-08T15:05:00-05:00' }), {
      now: NOW,
    });
    expect(skew.op.occurred_at).not.toBeNull();
  });

  it('drops operation numbers that do not fit the layout', () => {
    expect(isPlausibleOperationNumber('32811444', 'yape', 'yape')).toBe(true);
    expect(isPlausibleOperationNumber('262908363', 'yape', 'yape')).toBe(false);
    expect(isPlausibleOperationNumber('000001356', 'bbva', 'bank_transfer')).toBe(true);
    expect(isPlausibleOperationNumber('72f2cacca19ac89ded8fa67b0', 'bancom', 'plin')).toBe(true);
    expect(isPlausibleOperationNumber('be449e2ba19e771e31dda/bc6', 'bancom', 'plin')).toBe(false);
    expect(isPlausibleOperationNumber('56576c55a1994c4ffc8ca-3424', 'luqea', 'plin')).toBe(true);
    expect(isPlausibleOperationNumber('836', null, 'yape')).toBe(false);
    const checked = checkScreenshotOperation(op({ operation_number: '836' }), {
      now: NOW,
      layout: 'yape',
    });
    expect(checked.op.operation_number).toBeNull();
    expect(checked.op.confidence.operation_number).toBe(0);
  });

  it('recomputes legible: a receipt without amount is unreadable, a non-payment has no operations', () => {
    const unreadable = checkScreenshotExtraction(
      { content_type: 'individual_receipt', legible: true, operations: [op({ amount: null })] },
      { now: NOW },
    );
    expect(unreadable.extraction.legible).toBe(false);
    const none = checkScreenshotExtraction(
      { content_type: 'individual_receipt', legible: true, operations: [] },
      { now: NOW },
    );
    expect(none.extraction.legible).toBe(false);
    const meme = checkScreenshotExtraction(
      { content_type: 'non_financial', legible: false, operations: [op()] },
      { now: NOW },
    );
    expect(meme.extraction).toEqual({
      content_type: 'non_financial',
      legible: true,
      operations: [],
    });
    const list = checkScreenshotExtraction(
      { content_type: 'activity_list', legible: true, operations: [op(), op({ amount: null })] },
      { now: NOW },
    );
    expect(list.extraction.legible).toBe(true);
  });
});

describe('text post-checks', () => {
  it('only «record» carries operations; alternatives never repeat the amount', () => {
    const value = textInterpretationSchema.parse({
      intent: 'close_now',
      operations: [{ amount: '5', direction: 'in', payment_method: 'cash', scope: 'single' }],
    });
    expect(checkTextInterpretation(value).value.operations).toEqual([]);

    const ambiguous = textInterpretationSchema.parse({
      intent: 'record',
      operations: [
        {
          amount: '3.50',
          amount_alternatives: ['3.50', '350', '350.00'],
          direction: 'in',
          payment_method: 'cash',
          scope: 'single',
        },
      ],
    });
    expect(checkTextInterpretation(ambiguous).value.operations[0]?.amount_alternatives).toEqual([
      '350.00',
    ]);
  });

  it('flags a correction intent without correction', () => {
    const value = textInterpretationSchema.parse({ intent: 'correct', operations: [] });
    expect(checkTextInterpretation(value).issues).toContain('correction_missing');
  });
});

const QUESTIONS: CloseQuestion[] = [
  { number: 1, type: 'unreadable', text: '¿De cuánto era?' },
  { number: 2, type: 'ambiguous_total', text: '¿Es todo el día o solo efectivo?' },
  { number: 3, type: 'cash_check', text: '¿Cuadra?' },
];

describe('close reply post-checks', () => {
  it('keeps only known numbers and the value keys of each type', () => {
    const value = closeReplyInterpretationSchema.parse({
      answers: [
        { number: 1, resolved: true, value: { amount: '12', cash_check: 'balanced' } },
        { number: 2, resolved: true, value: { payment_method: 'cash' } },
        { number: 7, resolved: true, value: { amount: '99' } },
        { number: 3, resolved: true, value: { cash_check: 'not_balanced' } },
      ],
      new_entries: [],
      not_understood: [9],
    });
    const { value: checked, issues } = checkCloseReply(value, QUESTIONS);
    expect(checked.answers).toEqual([
      { number: 1, resolved: true, value: { amount: '12.00' } },
      { number: 2, resolved: true, value: { payment_method: 'cash', scope: 'day_total' } },
      { number: 3, resolved: true, value: { cash_check: 'not_balanced' } },
    ]);
    expect(checked.not_understood).toEqual([]);
    expect(issues).toContain('answer_unknown_number');
  });

  it('a «resolved» answer without its value becomes not understood', () => {
    const value = closeReplyInterpretationSchema.parse({
      answers: [{ number: 1, resolved: true, value: {} }],
      not_understood: [],
    });
    const { value: checked } = checkCloseReply(value, QUESTIONS);
    expect(checked.answers).toEqual([]);
    expect(checked.not_understood).toEqual([1]);
  });
});
