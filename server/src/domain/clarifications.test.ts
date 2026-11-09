import { describe, expect, it } from 'vitest';
import {
  CLOSE_MESSAGE_LIMITS,
  type ClarificationCandidate,
  clarificationPriority,
  closeMessageLimit,
  isWebOnly,
  selectClarificationsForClose,
  sortClarifications,
} from './clarifications.js';
import { lima } from './test-support.js';
import type { ClarificationType } from './types.js';

let sequence = 0;
function doubt(
  type: ClarificationType,
  amountCents: number | null = null,
  createdAt = lima('2026-11-10T10:00'),
): ClarificationCandidate & { text: string } {
  sequence += 1;
  return {
    id: `d${sequence}`,
    type,
    amountCents,
    createdAt,
    text: `Duda ${sequence} de tipo ${type}`,
  };
}

/** A close message shaped like WA-10 (summary, numbered doubts, cash question, web line, link). */
function render(selected: readonly { text: string }[], webCount: number): string {
  const lines = ['📒 Tu cierre del martes 10', 'Entró: S/ 412', 'Salió: S/ 180', ''];
  if (selected.length > 0) lines.push(`Tengo ${selected.length + 1} dudas:`);
  selected.forEach((item, index) => {
    lines.push(`${index + 1}️⃣ ${item.text}`);
  });
  lines.push(`${selected.length + 1}️⃣ Tu caja debería tener S/ 84 más que en la mañana. ¿Cuadra?`);
  lines.push('Respóndeme en un solo mensaje o audio.');
  if (webCount > 0) lines.push(`Tienes ${webCount} cosas más por revisar en la web.`);
  lines.push('Ver todo (vale 7 días): https://alza.pe/e/TOKEN');
  return lines.join('\n');
}

describe('priorities (11.8)', () => {
  it('ranks 1..6 and keeps missing_from_list for the web', () => {
    expect(clarificationPriority('ambiguous_total')).toBe(1);
    expect(clarificationPriority('possible_duplicate')).toBe(2);
    expect(clarificationPriority('unreadable')).toBe(3);
    expect(clarificationPriority('direction')).toBe(4);
    expect(clarificationPriority('date')).toBe(5);
    expect(clarificationPriority('category')).toBe(6);
    expect(isWebOnly('missing_from_list')).toBe(true);
    expect(isWebOnly('category')).toBe(false);
  });

  it('orders by priority, then larger amount first', () => {
    const small = doubt('direction', 2_000);
    const big = doubt('direction', 8_000);
    const noAmount = doubt('direction', null);
    const top = doubt('ambiguous_total', 100);
    const category = doubt('category', 99_000);
    expect(sortClarifications([category, small, noAmount, big, top]).map((d) => d.id)).toEqual([
      top.id,
      big.id,
      small.id,
      noAmount.id,
      category.id,
    ]);
  });
});

describe('selectClarificationsForClose (D37, D50, PR08)', () => {
  it('puts at most 5 doubts in the message and the cash question after them', () => {
    const doubts = Array.from({ length: 7 }, (_, i) => doubt('unreadable', 1_000 * (i + 1)));
    const result = selectClarificationsForClose({
      clarifications: doubts,
      render,
      maxLength: CLOSE_MESSAGE_LIMITS.textOnly,
    });
    expect(result.inMessage).toHaveLength(5);
    expect(result.inMessage[0]?.amountCents).toBe(7_000);
    expect(result.toWeb).toHaveLength(2);
    expect(result.cashCheckNumber).toBe(6);
    expect(result.text).toContain('6️⃣ Tu caja debería tener');
    expect(result.text).toContain('Tienes 2 cosas más por revisar en la web.');
    expect(result.fits).toBe(true);
  });

  it('adds doubts by priority only while the caption fits in 1,024 characters', () => {
    const long = (type: ClarificationType) => ({ ...doubt(type, 5_000), text: 'x'.repeat(300) });
    const doubts = [long('category'), long('ambiguous_total'), long('unreadable'), long('date')];
    const result = selectClarificationsForClose({
      clarifications: doubts,
      render,
      maxLength: closeMessageLimit(true),
    });
    expect(result.inMessage.map((d) => d.type)).toEqual(['ambiguous_total', 'unreadable']);
    expect(result.toWeb.map((d) => d.type)).toEqual(['date', 'category']);
    expect(result.text.length).toBeLessThanOrEqual(1024);
    expect(result.text).toContain('https://alza.pe/e/TOKEN');
    expect(result.text).toContain('¿Cuadra?');
  });

  it('the same doubts fit as «solo texto» (4,096)', () => {
    const long = (type: ClarificationType) => ({ ...doubt(type, 5_000), text: 'x'.repeat(300) });
    const doubts = [long('category'), long('ambiguous_total'), long('unreadable'), long('date')];
    const result = selectClarificationsForClose({
      clarifications: doubts,
      render,
      maxLength: closeMessageLimit(false),
    });
    expect(result.inMessage).toHaveLength(4);
  });

  it('web-only doubts never enter the message but count for the web line', () => {
    const result = selectClarificationsForClose({
      clarifications: [doubt('missing_from_list', 3_000), doubt('direction', 1_000)],
      render,
      maxLength: 1024,
    });
    expect(result.inMessage.map((d) => d.type)).toEqual(['direction']);
    expect(result.toWeb.map((d) => d.type)).toEqual(['missing_from_list']);
    expect(result.text).toContain('Tienes 1 cosas más');
  });

  it('without doubts only the cash question remains (number 1)', () => {
    const result = selectClarificationsForClose({ clarifications: [], render, maxLength: 1024 });
    expect(result.inMessage).toEqual([]);
    expect(result.cashCheckNumber).toBe(1);
    expect(result.text).toContain('1️⃣ Tu caja');
  });

  it('reports when even the bare message does not fit', () => {
    const result = selectClarificationsForClose({
      clarifications: [doubt('date')],
      render: () => 'y'.repeat(2000),
      maxLength: 1024,
    });
    expect(result.inMessage).toEqual([]);
    expect(result.fits).toBe(false);
  });
});
