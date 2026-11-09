import { describe, expect, it } from 'vitest';
import { limaInstant } from '../domain/index.js';
import { describeClarification } from './clarification-texts.js';
import {
  dayLabel,
  formatTime12,
  formatTime24,
  LABEL_TEXT,
  longDayLabel,
  weekLabel,
} from './labels.js';

describe('web labels (11.3, PR12, Anexo A)', () => {
  it('uses the spec tags and never «ganancia»', () => {
    expect(LABEL_TEXT).toEqual({
      screenshot: 'Con captura',
      self_reported: 'Lo contaste tú',
      unitemized: 'Lo contaste tú (sin detalle)',
    });
  });

  it('formats Lima times and days', () => {
    expect(formatTime12(limaInstant('2026-11-10', 15, 10))).toBe('3:10 p. m.');
    expect(formatTime12(limaInstant('2026-11-10', 14, 0))).toBe('2 p. m.');
    expect(formatTime12(limaInstant('2026-11-10', 11, 42))).toBe('11:42 a. m.');
    expect(formatTime12(limaInstant('2026-11-11', 0, 30))).toBe('12:30 a. m.');
    expect(formatTime24(limaInstant('2026-11-10', 9, 5))).toBe('09:05');
    expect(dayLabel('2026-11-10')).toBe('martes 10');
    expect(longDayLabel('2026-11-15')).toBe('domingo 15 de noviembre');
    expect(weekLabel('2026-11-09', '2026-11-15')).toBe('Semana del 9 al 15 nov');
    expect(weekLabel('2026-10-26', '2026-11-01')).toBe('Semana del 26 oct al 1 nov');
  });

  it('builds the 11.8 questions for Pendientes', () => {
    const entry = {
      amountCents: 8_000,
      direction: 'in' as const,
      paymentMethod: 'yape' as const,
      counterparty: null,
      operationAt: limaInstant('2026-11-10', 14, 0),
      createdAt: limaInstant('2026-11-10', 14, 1),
    };
    const direction = describeClarification(
      { type: 'direction', businessDay: '2026-11-10', detail: null },
      entry,
      null,
    );
    expect(direction.question).toBe('El Yape de S/ 80 de las 2 p. m., ¿te pagaron o pagaste tú?');
    expect(direction.options.map((o) => o.label)).toEqual([
      'Me pagaron',
      'Pagué mercadería',
      'Pagué un gasto',
      'Fue para la casa',
    ]);
    const category = describeClarification(
      { type: 'category', businessDay: '2026-11-10', detail: null },
      { ...entry, amountCents: 6_000, direction: 'out', counterparty: 'Distribuidora Sur' },
      null,
    );
    expect(category.question).toBe(
      'Pagaste S/ 60 a Distribuidora Sur. ¿Fue mercadería o un gasto?',
    );
    const audio = describeClarification(
      { type: 'unreadable', businessDay: '2026-11-10', detail: null },
      null,
      { type: 'text', text: 'vendí pan', receivedAt: limaInstant('2026-11-10', 9, 0) },
    );
    expect(audio.question).toBe('Dijiste «vendí pan». ¿Por cuánto?');
    const date = describeClarification(
      { type: 'date', businessDay: '2026-11-10', detail: null },
      entry,
      null,
    );
    expect(date.question).toBe('Esta captura no muestra la fecha. ¿Es del martes 10?');
  });
});
