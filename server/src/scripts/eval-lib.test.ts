import { describe, expect, it } from 'vitest';
import {
  type CloseQuestion,
  closeReplyInterpretationSchema,
  screenshotExtractionSchema,
  textInterpretationSchema,
} from '../ai/schemas.js';
import { type AnswerRow, parseCsv, scoreCloseReply, scoreImage, scoreText } from './eval-lib.js';

describe('parseCsv', () => {
  it('handles quotes, commas and doubled quotes', () => {
    const rows = parseCsv('id,notes\nC-1,"a, b ""c"""\nC-2,plain\n');
    expect(rows).toEqual([
      { id: 'C-1', notes: 'a, b "c"' },
      { id: 'C-2', notes: 'plain' },
    ]);
  });
});

const answer: AnswerRow = {
  id: 'C-001',
  file: 'x.jpg',
  type: 'individual_receipt',
  amount: '2.00',
  direction: 'in',
  payment_method: 'yape',
  occurred_at: '2026-11-04T20:44:00-05:00',
  counterparty: 'Fernando Sar*',
  operation_number: '32811444',
  scope: 'single',
  receipt_header: 'yape_received',
  holder_role: 'payee',
  visible_holder_name: '',
  notes: '',
};

const extraction = (amount: string | null) =>
  screenshotExtractionSchema.parse({
    content_type: 'individual_receipt',
    legible: amount !== null,
    operations: [
      {
        amount,
        payment_method: 'yape',
        receipt_header: 'yape_received',
        holder_role: 'payee',
        occurred_at: '2026-11-04T20:44:00-05:00',
        operation_number: '32811444',
      },
    ],
  });

describe('scoreImage', () => {
  it('counts a wrong legible amount, or any amount on an unreadable image, as invented', () => {
    expect(scoreImage(extraction('2.00'), 'same', answer)).toMatchObject({
      amountOk: true,
      invented: false,
      directionOk: true,
      dateOk: true,
    });
    expect(scoreImage(extraction('9.00'), 'same', answer).invented).toBe(true);
    expect(scoreImage(extraction('2.00'), 'unreadable', answer).invented).toBe(true);
    expect(scoreImage(extraction(null), 'unreadable', answer)).toMatchObject({
      invented: false,
      unreadableDetected: true,
    });
  });
});

describe('scoreText', () => {
  const record = (amount: string | null, confidence: number, alternatives: string[] = []) =>
    textInterpretationSchema.parse({
      intent: 'record',
      operations: [
        {
          amount,
          amount_alternatives: alternatives,
          direction: 'in',
          payment_method: 'cash',
          scope: 'single',
          suggested_category: 'sale',
          confidence: { amount: confidence },
        },
      ],
    });
  const expected = {
    intent: 'record',
    operations: [
      {
        amount: '3.50',
        direction: 'in' as const,
        payment_method: ['cash'],
        scope: 'single',
        category: ['sale'],
      },
    ],
  };

  it('a confident correct amount is correct', () => {
    expect(scoreText(record('3.50', 0.95), expected)).toMatchObject({ correct: true, invented: 0 });
  });

  it('a confident wrong amount is invented; an unsure one is only a miss', () => {
    expect(scoreText(record('350.00', 0.95), expected).invented).toBe(1);
    expect(scoreText(record('350.00', 0.5), expected)).toMatchObject({
      correct: false,
      invented: 0,
    });
    expect(scoreText(record('350.00', 0.95, ['3.50']), expected).invented).toBe(0);
  });

  it('ambiguous amounts must come with a doubt', () => {
    const ambiguous = {
      intent: 'record',
      operations: [
        {
          amount: '3.50',
          amount_requires_doubt: true,
          acceptable_amounts: ['3.50', '350.00'],
          direction: 'in' as const,
          payment_method: ['cash', 'unknown'],
          scope: ['single'],
        },
      ],
    };
    expect(scoreText(record('3.50', 0.6, ['350.00']), ambiguous).correct).toBe(true);
    expect(scoreText(record('3.50', 0.95), ambiguous)).toMatchObject({
      correct: false,
      invented: 0,
    });
  });
});

describe('scoreCloseReply', () => {
  const questions: CloseQuestion[] = [
    { number: 1, type: 'unreadable', text: '' },
    { number: 2, type: 'cash_check', text: '' },
  ];
  const expected = {
    answers: [
      { number: 1, resolved: true, value: { amount: '12.00' } },
      { number: 2, resolved: true, value: { cash_check: 'not_balanced' } },
    ],
    new_entries: [
      {
        amount: '40.00',
        direction: 'out' as const,
        category: ['household'],
        payment_method: 'cash',
      },
    ],
  };

  it('matches answers and new entries', () => {
    const actual = closeReplyInterpretationSchema.parse({
      answers: [
        { number: 1, resolved: true, value: { amount: '12' } },
        { number: 2, resolved: true, value: { cash_check: 'not_balanced' } },
      ],
      new_entries: [
        { amount: '40', payment_method: 'cash', direction: 'out', category: 'household' },
      ],
    });
    expect(scoreCloseReply(actual, expected, questions)).toMatchObject({
      correct: true,
      invented: 0,
    });
  });

  it('a wrong amount or an unexpected entry is invented', () => {
    const actual = closeReplyInterpretationSchema.parse({
      answers: [
        { number: 1, resolved: true, value: { amount: '21' } },
        { number: 2, resolved: true, value: { cash_check: 'not_balanced' } },
      ],
      new_entries: [
        { amount: '70', payment_method: 'cash', direction: 'out', category: 'household' },
      ],
    });
    const score = scoreCloseReply(actual, expected, questions);
    expect(score.correct).toBe(false);
    expect(score.invented).toBe(2);
  });
});
