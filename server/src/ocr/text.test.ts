import { describe, expect, it } from 'vitest';
import { classifyByKeywords } from './classify.js';
import {
  cleanHexCode,
  cleanName,
  fold,
  parseDateTime,
  parseSpanishDate,
  parseTime,
} from './text.js';
import type { OcrPage } from './types.js';

describe('dates and times as printed by Yape, BBVA, Bancom and Luqea', () => {
  it.each([
    ['8 04 nov. 2026 | O 8:44 p.m.', '2026-11-04T20:44:00-05:00'],
    ['05 nov. 2026 | 6:34 p. m.', '2026-11-05T18:34:00-05:00'],
    ['27 enero 2024, 17:02 h', '2024-01-27T17:02:00-05:00'],
    ['28 noviembre 2025, 12:41 h', '2025-11-28T12:41:00-05:00'],
    ['Fecha y hora: 28 nov 2025 - 10:31', '2025-11-28T10:31:00-05:00'],
    ['15/09/25, 07:33', '2025-09-15T07:33:00-05:00'],
    ['01 set. 2026 | 12:05 a.m.', '2026-09-01T00:05:00-05:00'],
  ])('%s', (text, iso) => {
    expect(parseDateTime(text)).toBe(iso);
  });

  it('rejects impossible dates and lines without time', () => {
    expect(parseSpanishDate('31 feb 2026')).toBeNull();
    expect(parseSpanishDate('32/01/26')).toBeNull();
    expect(parseDateTime('04 nov. 2026')).toBeNull();
    expect(parseTime('25:61')).toBeNull();
  });
});

describe('text helpers', () => {
  it('folds accents and case', () => {
    expect(fold('  ¡Te  YAPEARON!  Operación ')).toBe('¡te yapearon! operacion');
  });

  it('cleans names without inventing them', () => {
    expect(cleanName('Titular: "Andres Alejandro')).toBe('Titular: Andres Alejandro');
    expect(cleanName('| Sofia Rey* |')).toBe('Sofia Rey*');
    expect(cleanName('— 12 —')).toBeNull();
    expect(cleanName(undefined)).toBeNull();
  });

  it('fixes only non-hex confusions in operation codes', () => {
    expect(cleanHexCode('72f2caccal9ac89ded8fa67b0')).toBe('72f2cacca19ac89ded8fa67b0');
    expect(cleanHexCode('a/bc6')).toBe('a/bc6');
  });
});

const page = (...texts: string[]): OcrPage => ({
  width: 1000,
  height: 1000,
  confidence: 90,
  lines: texts.map((text, i) => ({
    text,
    confidence: 90,
    bbox: { x0: 0, y0: i * 40, x1: 500, y1: i * 40 + 30 },
    words: [],
  })),
});

describe('classifyByKeywords (RF-EX-01)', () => {
  it('recognizes receipts, lists, invoices and other financial screens', () => {
    expect(classifyByKeywords(page('Envío a contactos', 'Operación exitosa'))?.imageClass).toBe(
      'individual_receipt',
    );
    expect(
      classifyByKeywords(page('Movimientos', 'Ana S/ 2.00', 'Luis S/ 5.50', 'Rosa S/ 7.00'))
        ?.imageClass,
    ).toBe('activity_list');
    expect(
      classifyByKeywords(page('BOLETA DE VENTA ELECTRONICA', 'RUC 20123456789'))?.imageClass,
    ).toBe('supplier_invoice');
    expect(classifyByKeywords(page('Saldo disponible', 'S/ 150.00'))?.imageClass).toBe(
      'other_financial',
    );
  });

  it('leaves the rest to the vision model (never decides «non financial» from little text)', () => {
    expect(classifyByKeywords(page('jajaja', 'buenos días'))).toBeNull();
    expect(classifyByKeywords(page())).toBeNull();
  });
});
