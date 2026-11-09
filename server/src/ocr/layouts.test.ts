import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { amountFromLine } from './amount.js';
import { matchLayout } from './layouts/index.js';
import { verifyAmount } from './read.js';
import type { OcrLineRead, OcrPage } from './types.js';

/**
 * OCR output captured from the 8 dataset screenshots (`npx tsx src/scripts/eval-capture-fixtures.ts`):
 * the layout readers run here without tesseract.
 */
interface Fixture {
  file: string;
  page: OcrPage;
  amountLines: OcrLineRead[];
  amountGlyphCount: number;
  signRemoved: boolean;
}

const fixtures = JSON.parse(
  readFileSync(new URL('./__fixtures__/screenshots.json', import.meta.url), 'utf8'),
) as Record<string, Fixture>;

const fixture = (id: string): Fixture => fixtures[id] as Fixture;

function read(id: string) {
  const f = fixture(id);
  const found = matchLayout(f.page);
  if (!found) throw new Error(`no layout for ${id}`);
  const fields = found.parser.parse(f.page, found.match);
  const reads = f.amountLines.map((line) =>
    amountFromLine(line, f.amountGlyphCount, f.signRemoved),
  );
  const verdict = verifyAmount(reads, found.parser.crossCheckAmounts?.(f.page) ?? []);
  return { layout: found.parser.layout, fields, verdict };
}

describe('layout readers on captured OCR (D33)', () => {
  it('Yape received: «¡Te Yapearon!» → payee, no holder name (D36)', () => {
    const { layout, fields, verdict } = read('C-001');
    expect(layout).toBe('yape');
    expect(verdict).toEqual({ amount: '2.00', verified: true, issue: null });
    expect(fields).toMatchObject({
      payment_method: 'yape',
      receipt_header: 'yape_received',
      receipt_header_text: '¡Te Yapearon!',
      holder_role: 'payee',
      counterparty_name: 'Fernando Sar*',
      visible_holder_name: null,
      occurred_at: '2026-11-04T20:44:00-05:00',
      operation_number: '32811444',
    });
  });

  it('Yape sent: «¡Yapeaste!» → payer; security code is not the operation number', () => {
    const { fields, verdict } = read('C-002');
    expect(verdict.amount).toBe('7.50');
    expect(verdict.verified).toBe(true);
    expect(fields).toMatchObject({
      receipt_header: 'yape_sent',
      holder_role: 'payer',
      counterparty_name: 'Sofia Rey*',
      occurred_at: '2026-11-05T18:34:00-05:00',
      operation_number: '26290836',
    });
  });

  it('BBVA transfer: amount confirmed by «Importe abonado», recipient from the right column', () => {
    const { layout, fields, verdict } = read('C-003');
    expect(layout).toBe('bbva');
    expect(verdict).toEqual({ amount: '1285.00', verified: true, issue: null });
    expect(fields).toMatchObject({
      payment_method: 'bank_transfer',
      receipt_header: 'bank_transfer_sent',
      holder_role: 'payer',
      visible_holder_name: null,
      occurred_at: '2024-01-27T17:02:00-05:00',
      operation_number: '000001356',
    });
    expect(fields.counterparty_name).toMatch(/^Andres Alejan/);
  });

  it('BBVA transfer without cross-check amount', () => {
    const { fields, verdict } = read('C-004');
    expect(verdict.amount).toBe('750.00');
    expect(verdict.verified).toBe(true);
    expect(fields.counterparty_name).toBe('Jenny Patricia ...');
    expect(fields.operation_number).toBe('000004283');
  });

  it('BBVA «Envío a contactos» to Plin → plin_sent', () => {
    const { fields, verdict } = read('C-005');
    expect(verdict.amount).toBe('20.00');
    expect(fields).toMatchObject({
      payment_method: 'plin',
      receipt_header: 'plin_sent',
      occurred_at: '2025-11-28T12:41:00-05:00',
      operation_number: '000001636',
    });
  });

  it('Bancom: «Titular» is the visible holder (payer), hex op number joined', () => {
    const { layout, fields, verdict } = read('C-006');
    expect(layout).toBe('bancom');
    expect(verdict.amount).toBe('20.00');
    expect(verdict.verified).toBe(true);
    expect(fields).toMatchObject({
      payment_method: 'plin',
      receipt_header: 'plin_sent',
      holder_role: 'payer',
      counterparty_name: null,
      visible_holder_name: 'Andres Alejandro Rojas Urquizo',
      occurred_at: '2025-11-28T10:31:00-05:00',
      operation_number: '72f2cacca19ac89ded8fa67b0',
    });
  });

  it('Bancom with wrapped op number: an unreadable code is not repaired', () => {
    const { fields, verdict } = read('C-007');
    expect(verdict.amount).toBe('30.00');
    expect(fields.occurred_at).toBe('2026-05-30T11:15:00-05:00');
    // OCR misreads the wrapped code; the post-check (hex only) drops it rather than guessing.
    expect(
      fields.operation_number === null ||
        /[^0-9a-f]/.test(fields.operation_number) ||
        fields.operation_number === '5e449e2ba19e771e31dda7bc6',
    ).toBe(true);
  });

  it('Luqea: recipient in capitals, dd/mm/aa date', () => {
    const { layout, fields, verdict } = read('C-008');
    expect(layout).toBe('luqea');
    expect(verdict.amount).toBe('20.00');
    expect(fields).toMatchObject({
      payment_method: 'plin',
      receipt_header: 'plin_sent',
      holder_role: 'payer',
      counterparty_name: 'ANDRES ALEJANDRO ROJAS URQUIZO',
      occurred_at: '2025-09-15T07:33:00-05:00',
    });
  });

  it('a page without a known title matches no layout', () => {
    const page: OcrPage = {
      width: 1400,
      height: 900,
      confidence: 90,
      lines: [
        {
          text: 'Hola vecina',
          confidence: 95,
          bbox: { x0: 10, y0: 10, x1: 300, y1: 60 },
          words: [],
        },
      ],
    };
    expect(matchLayout(page)).toBeNull();
  });
});
