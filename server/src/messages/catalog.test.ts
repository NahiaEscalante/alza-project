import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertValidButtons, assertValidText, META_LIMITS } from '../channel/limits.js';
import { REPO_ROOT } from '../paths.js';
import {
  accessLinkMessage,
  activationLinkMessage,
  BUTTONS,
  type CatalogMessage,
  closeTimeQuestion,
  dangerMessage,
  dataDeletedMessage,
  declinedMessage,
  deleteConfirmationQuestion,
  entryKindForHer,
  firstScreenshotMessage,
  formatCloseTimeForHer,
  habitMessage,
  screenshotTipMessage,
  TEXTS,
  technicalIssueMessage,
  welcomeMessage,
} from './catalog.js';

/** The quoted text of one catalog entry in 12.1, lines joined with «\n». */
function specText(id: string): string {
  const spec = readFileSync(join(REPO_ROOT, 'docs', 'ALZA_PRODUCT_SPEC.md'), 'utf8');
  const lines = spec.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`**${id} · `));
  if (start < 0) throw new Error(`${id} not found in the spec`);
  const quote: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('> ')) quote.push(line.slice(2));
    else if (quote.length > 0) break;
  }
  return quote.join('\n');
}

/** Each template rendered with the spec's own placeholders. */
const RENDERED: Record<keyof typeof TEXTS, string> = {
  'WA-01': TEXTS['WA-01']({ privacyUrl: '{enlace_privacidad}' }),
  'WA-02': TEXTS['WA-02'](),
  'WA-03': TEXTS['WA-03'](),
  'WA-04': TEXTS['WA-04'](),
  'WA-05': TEXTS['WA-05'](),
  'WA-06': TEXTS['WA-06']({
    name: '{nombre}',
    time: '{hora}',
    activationUrl: '{enlace_activacion}',
  }),
  'WA-07': TEXTS['WA-07']({ kind: '{tipo}', method: '{medio}', amount: '{monto}' }),
  'WA-13': TEXTS['WA-13']({ accessUrl: '{enlace_7d}' }),
  'WA-14': TEXTS['WA-14']({ activationUrl: '{enlace_activacion}' }),
  'WA-15': TEXTS['WA-15'](),
  'WA-16': TEXTS['WA-16'](),
  'WA-17': TEXTS['WA-17'](),
  'WA-19': TEXTS['WA-19'](),
  'WA-20': TEXTS['WA-20'](),
};

describe('message catalog (12.1)', () => {
  it.each(Object.entries(RENDERED))('%s is the spec text, verbatim', (id, text) => {
    expect(text).toBe(specText(id));
  });

  it('never says «ganancia»', () => {
    for (const text of Object.values(RENDERED))
      expect(text.toLowerCase()).not.toContain('ganancia');
  });

  const sample: CatalogMessage[] = [
    welcomeMessage('https://alza.pe/privacidad'),
    declinedMessage(),
    closeTimeQuestion(),
    closeTimeQuestion(true),
    habitMessage({
      name: 'Marta',
      closeTime: '21:00',
      activationUrl: `https://alza.pe/app/activar/${'x'.repeat(43)}`,
    }),
    firstScreenshotMessage({
      direction: 'in',
      category: 'sale',
      paymentMethod: 'yape',
      amountCents: 1250,
    }),
    accessLinkMessage(`https://alza.pe/app/entrar/${'x'.repeat(43)}`),
    activationLinkMessage(`https://alza.pe/app/activar/${'x'.repeat(43)}`),
    deleteConfirmationQuestion(),
    dataDeletedMessage(),
    technicalIssueMessage(),
    screenshotTipMessage(),
    dangerMessage(),
  ];

  it('every message fits Meta limits (≤ 3 buttons, titles ≤ 20, unique ids)', () => {
    for (const message of sample) {
      if (message.kind === 'buttons') {
        expect(() => assertValidButtons(message)).not.toThrow();
        expect(message.buttons.length).toBeLessThanOrEqual(META_LIMITS.maxButtons);
      } else if (message.kind === 'text') {
        expect(() => assertValidText(message)).not.toThrow();
      }
    }
    for (const button of Object.values(BUTTONS)) {
      expect(button.title.length).toBeLessThanOrEqual(META_LIMITS.buttonTitle);
    }
  });

  it('buttons carry the spec titles', () => {
    const titles = (message: CatalogMessage) =>
      message.kind === 'buttons' ? message.buttons.map((b) => b.title) : [];
    expect(titles(welcomeMessage('x'))).toEqual(['Acepto', 'No, gracias']);
    expect(titles(closeTimeQuestion())).toEqual(['8 pm', '9 pm', '10 pm']);
    expect(titles(deleteConfirmationQuestion())).toEqual(['Sí, borrar todo', 'Cancelar']);
  });

  it('WA-07 says the real type and medium (D41)', () => {
    const body = (message: CatalogMessage) => (message.kind === 'text' ? message.body : '');
    expect(
      body(
        firstScreenshotMessage({
          direction: 'in',
          category: 'sale',
          paymentMethod: 'plin',
          amountCents: 1_234_50,
        }),
      ),
    ).toBe(
      '✅ Así lo anoté: venta por Plin de S/1 234,50. Desde ahora, en silencio hasta tu cierre.',
    );
    expect(entryKindForHer({ direction: 'out', category: 'inventory' })).toBe('pago');
    expect(entryKindForHer({ direction: 'in', category: 'other_income' })).toBe('ingreso');
    expect(() =>
      firstScreenshotMessage({
        direction: 'in',
        category: 'sale',
        paymentMethod: 'cash',
        amountCents: 100,
      }),
    ).toThrow(RangeError);
  });

  it.each([
    ['20:00', '8 p. m.'],
    ['21:30', '9:30 p. m.'],
    ['00:00', '12 a. m.'],
    ['01:00:00', '1 a. m.'],
    ['12:00', '12 p. m.'],
  ])('close time %s reads «%s»', (value, text) => {
    expect(formatCloseTimeForHer(value)).toBe(text);
  });
});
