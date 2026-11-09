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
  contactLinkedMessage,
  contactRequestMessage,
  dangerMessage,
  dataDeletedMessage,
  declinedMessage,
  deleteConfirmationQuestion,
  entryKindForHer,
  firstScreenshotMessage,
  formatCloseTimeForHer,
  habitMessage,
  messagingAppOf,
  SHARE_CONTACT_BUTTON,
  screenshotTipMessage,
  TELEGRAM_TEXTS,
  TEXTS,
  technicalIssueMessage,
  welcomeMessage,
} from './catalog.js';
import { CONSENT_TEXT_VERSION, consentTextVersion, DEMO_CONSENT_TEXT_VERSION } from './consent.js';

const SPEC_LINES = readFileSync(join(REPO_ROOT, 'docs', 'ALZA_PRODUCT_SPEC.md'), 'utf8').split(
  '\n',
);

/** The first quote after line `from`, lines joined with «\n». */
function quoteAfter(from: number): string {
  const quote: string[] = [];
  for (const line of SPEC_LINES.slice(from + 1)) {
    if (line.startsWith('> ')) quote.push(line.slice(2));
    else if (quote.length > 0) break;
  }
  return quote.join('\n');
}

/** The quoted text of one catalog entry in 12.1, lines joined with «\n». */
function specText(id: string): string {
  const start = SPEC_LINES.findIndex((line) => line.startsWith(`**${id} · `));
  if (start < 0) throw new Error(`${id} not found in the spec`);
  return quoteAfter(start);
}

/** The «Variante para Telegram» of one catalog entry (D73), before the next entry. */
function specTelegramVariant(id: string): string {
  const start = SPEC_LINES.findIndex((line) => line.startsWith(`**${id} · `));
  const next = SPEC_LINES.findIndex((line, i) => i > start && line.startsWith('**WA-'));
  const variant = SPEC_LINES.findIndex(
    (line, i) => i > start && i < next && line.startsWith('Variante para Telegram'),
  );
  if (start < 0 || variant < 0) throw new Error(`${id} has no Telegram variant in the spec`);
  return quoteAfter(variant);
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
  'WA-23': TEXTS['WA-23'](),
  'WA-24': TEXTS['WA-24'](),
};

const RENDERED_TELEGRAM: Record<keyof typeof TELEGRAM_TEXTS, string> = {
  'WA-01': TELEGRAM_TEXTS['WA-01']({ privacyUrl: '{enlace_privacidad}' }),
  'WA-06': TELEGRAM_TEXTS['WA-06']({
    name: '{nombre}',
    time: '{hora}',
    activationUrl: '{enlace_activacion}',
  }),
};

describe('message catalog (12.1)', () => {
  it.each(Object.entries(RENDERED))('%s is the spec text, verbatim', (id, text) => {
    expect(text).toBe(specText(id));
  });

  it.each(Object.entries(RENDERED_TELEGRAM))(
    '%s on Telegram is the spec variant, verbatim (D73)',
    (id, text) => {
      expect(text).toBe(specTelegramVariant(id));
    },
  );

  it('never says «ganancia»', () => {
    for (const text of [...Object.values(RENDERED), ...Object.values(RENDERED_TELEGRAM)])
      expect(text.toLowerCase()).not.toContain('ganancia');
  });

  it('Telegram: demo notice and its own consent version (D74), 👍 instead of ticks (D73)', () => {
    const body = (message: CatalogMessage) => (message.kind === 'text' ? message.body : '');
    const welcome = welcomeMessage('https://alza.pe/privacidad', 'telegram');
    expect(welcome.kind === 'buttons' && welcome.body).toContain(
      'Es una demo: usa capturas y datos de prueba, no los reales de tu negocio.',
    );
    expect(welcomeMessage('https://alza.pe/privacidad')).toEqual(
      welcomeMessage('https://alza.pe/privacidad', 'whatsapp'),
    );
    const habit = { name: 'Marta', closeTime: '21:00', activationUrl: 'https://alza.pe/a/x' };
    expect(body(habitMessage({ ...habit, app: 'telegram' }))).toContain('verás un 👍');
    expect(body(habitMessage(habit))).toContain('doble check azul');
    expect(consentTextVersion('telegram')).toBe(DEMO_CONSENT_TEXT_VERSION);
    expect(consentTextVersion()).toBe(CONSENT_TEXT_VERSION);
    expect(messagingAppOf('telegram')).toBe('telegram');
    expect(messagingAppOf('dialog360')).toBe('whatsapp');
    expect(contactRequestMessage()).toMatchObject({ catalogId: 'WA-23' });
    expect(contactLinkedMessage()).toMatchObject({ catalogId: 'WA-24', kind: 'text' });
    expect(SHARE_CONTACT_BUTTON.length).toBeLessThanOrEqual(META_LIMITS.buttonTitle);
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
