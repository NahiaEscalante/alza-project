import { describe, expect, it } from 'vitest';
import { parseModelJson } from './json.js';
import { InvalidOutput } from './router.js';
import {
  closeReplyInterpretationSchema,
  normalizeIsoDateTime,
  screenshotExtractionSchema,
  textInterpretationSchema,
} from './schemas.js';

const yapeReceived = {
  content_type: 'individual_receipt',
  legible: true,
  operations: [
    {
      amount: '12.50',
      payment_method: 'yape',
      counterparty_name: 'Ana T.',
      visible_holder_name: null,
      receipt_header: 'yape_received',
      receipt_header_text: '¡Te Yapearon!',
      holder_role: 'payee',
      occurred_at: '2026-11-08T10:42:00-05:00',
      operation_number: '00000001',
      scope: 'single',
      suggested_category: 'sale',
      confidence: { amount: 0.98, occurred_at: 0.95, holder_role: 0.93 },
    },
  ],
};

describe('screenshot extraction schema (10.2)', () => {
  it('accepts the spec example', () => {
    const parsed = screenshotExtractionSchema.parse(yapeReceived);
    expect(parsed.operations[0]?.amount).toBe('12.50');
    expect(parsed.operations[0]?.holder_role).toBe('payee');
  });

  it('normalizes amounts and turns unreadable ones into null, never a guess', () => {
    const op = (amount: unknown) =>
      screenshotExtractionSchema.parse({
        ...yapeReceived,
        operations: [{ ...yapeReceived.operations[0], amount }],
      }).operations[0]?.amount;
    expect(op('S/ 1,285.00')).toBe('1285.00');
    expect(op(7.5)).toBe('7.50');
    expect(op('7.505')).toBeNull();
    expect(op('1.285')).toBeNull();
    expect(op('ilegible')).toBeNull();
  });

  it('scales percentage confidences and drops junk', () => {
    const parsed = screenshotExtractionSchema.parse({
      ...yapeReceived,
      operations: [{ ...yapeReceived.operations[0], confidence: { amount: 98, x: 'no', y: -1 } }],
    });
    expect(parsed.operations[0]?.confidence).toEqual({ amount: 0.98 });
  });

  it('fills optional fields with defaults', () => {
    const parsed = screenshotExtractionSchema.parse({
      content_type: 'individual_receipt',
      legible: true,
      operations: [{ amount: '5', payment_method: 'plin' }],
    });
    expect(parsed.operations[0]).toMatchObject({
      amount: '5.00',
      receipt_header: 'unknown',
      holder_role: 'unknown',
      occurred_at: null,
      scope: 'single',
      confidence: {},
    });
  });

  it('rejects wrong enums (the call is retried)', () => {
    const result = screenshotExtractionSchema.safeParse({
      ...yapeReceived,
      operations: [{ ...yapeReceived.operations[0], payment_method: 'efectivo' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('normalizeIsoDateTime', () => {
  it('normalizes offsets and reads local times as Lima', () => {
    expect(normalizeIsoDateTime('2026-11-04T20:44:00-05:00')).toBe('2026-11-04T20:44:00-05:00');
    expect(normalizeIsoDateTime('2026-11-04T20:44')).toBe('2026-11-04T20:44:00-05:00');
    expect(normalizeIsoDateTime('2026-11-04 20:44:10Z')).toBe('2026-11-04T20:44:10+00:00');
    expect(normalizeIsoDateTime('2026-11-04T20:44:00-0500')).toBe('2026-11-04T20:44:00-05:00');
  });

  it('rejects invalid dates', () => {
    expect(normalizeIsoDateTime('2026-13-04T20:44:00-05:00')).toBeNull();
    expect(normalizeIsoDateTime('2026-11-04T25:00:00-05:00')).toBeNull();
    expect(normalizeIsoDateTime('04/11/2026')).toBeNull();
    expect(normalizeIsoDateTime(null)).toBeNull();
  });
});

describe('text interpretation schema', () => {
  it('parses the spec audio example (two cash sales)', () => {
    const parsed = textInterpretationSchema.parse({
      intent: 'record',
      operations: [
        {
          amount: '3.50',
          direction: 'in',
          payment_method: 'cash',
          scope: 'single',
          suggested_category: 'sale',
          confidence: { amount: 0.9 },
        },
        {
          amount: '2.00',
          direction: 'in',
          payment_method: 'cash',
          scope: 'single',
          suggested_category: 'sale',
          confidence: { amount: 0.95 },
        },
      ],
    });
    expect(parsed.operations.map((o) => o.amount)).toEqual(['3.50', '2.00']);
    expect(parsed.request).toBeNull();
    expect(parsed.correction).toBeNull();
  });

  it('keeps a missing amount as null («vendí pan»)', () => {
    const parsed = textInterpretationSchema.parse({
      intent: 'record',
      operations: [{ amount: null, direction: 'in', payment_method: 'cash', scope: 'single' }],
    });
    expect(parsed.operations[0]?.amount).toBeNull();
  });

  it('rejects an unknown intent', () => {
    expect(
      textInterpretationSchema.safeParse({ intent: 'registrar', operations: [] }).success,
    ).toBe(false);
  });
});

describe('close reply schema (10.3)', () => {
  it('parses the spec example', () => {
    const parsed = closeReplyInterpretationSchema.parse({
      answers: [
        { number: 1, resolved: true, value: { amount: '12.00' } },
        { number: 2, resolved: true, value: { scope: 'day_total', payment_method: 'cash' } },
        { number: 3, resolved: true, value: { cash_check: 'not_balanced' } },
      ],
      new_entries: [
        { amount: '40.00', payment_method: 'cash', direction: 'out', category: 'household' },
      ],
      not_understood: [],
    });
    expect(parsed.new_entries[0]?.amount).toBe('40.00');
  });

  it('rejects a new entry without a valid amount', () => {
    const result = closeReplyInterpretationSchema.safeParse({
      answers: [],
      new_entries: [
        { amount: 'cuarenta', payment_method: 'cash', direction: 'out', category: 'household' },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe('parseModelJson', () => {
  it('reads plain, fenced and wrapped JSON', () => {
    const json = JSON.stringify({ intent: 'other', operations: [] });
    for (const raw of [json, `\`\`\`json\n${json}\n\`\`\``, `Aquí está: ${json} listo`]) {
      expect(parseModelJson(raw, textInterpretationSchema)).toMatchObject({ intent: 'other' });
    }
  });

  it('returns InvalidOutput with a reason code, never the content', () => {
    const notJson = parseModelJson('hola, vendiste 20', textInterpretationSchema);
    expect(notJson).toBeInstanceOf(InvalidOutput);
    expect((notJson as InvalidOutput).reason).toBe('json_parse');
    const badSchema = parseModelJson('{"intent":"vender"}', textInterpretationSchema);
    expect((badSchema as InvalidOutput).reason).toBe('schema:intent');
  });
});
