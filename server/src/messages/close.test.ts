import { describe, expect, it } from 'vitest';
import { cashCheckQuestion, NO_COMPARISON_TEXT } from '../domain/index.js';
import {
  ALREADY_SENT_TEXT,
  afterCloseLine,
  clarifyText,
  closeMessageText,
  confirmationText,
  digitalShortfallLine,
  LATE_REPLY_TEXT,
  NOTHING_RECORDED_TEXT,
  replyExampleLine,
  TEXT_ONLY_LINE,
  unitemizedCashLine,
} from './close.js';

const MARTA = {
  inCents: 41_200,
  digitalSalesCents: 29_800,
  cashSalesCents: 11_400,
  unknownMethodSalesCents: 0,
  outCents: 18_000,
  inventoryCents: 15_000,
  expensesCents: 0,
  householdCents: 3_000,
  unclassifiedCents: 0,
};

describe('WA-10 (12.1)', () => {
  it('lays out the 10.3 example: summary, 2 doubts, cash last, example, link', () => {
    const text = closeMessageText({
      dayLabel: 'martes 10',
      summary: MARTA,
      notices: [],
      doubts: [
        {
          type: 'unreadable',
          text: 'Una captura de las 11:42 a. m. no se lee bien. ¿De cuánto era?',
        },
        {
          type: 'ambiguous_total',
          text: 'Dijiste «hoy vendí 150». ¿Es todo el día o solo efectivo?',
        },
      ],
      cashQuestion: cashCheckQuestion(8_400).text,
      webCount: 0,
      week: null,
      link: 'https://alza.test/app/entrar/TOKEN',
    });
    expect(text).toBe(
      [
        '📒 Tu cierre del martes 10',
        'Entró: S/ 412 (Yape y Plin S/ 298, efectivo S/ 114)',
        'Salió: S/ 180 (mercadería S/ 150, casa S/ 30)',
        '',
        'Tengo 3 dudas:',
        '1️⃣ Una captura de las 11:42 a. m. no se lee bien. ¿De cuánto era?',
        '2️⃣ Dijiste «hoy vendí 150». ¿Es todo el día o solo efectivo?',
        '3️⃣ Tu caja debería tener S/ 84 más que en la mañana. ¿Cuadra?',
        '',
        'Respóndeme en un solo mensaje o audio, por ejemplo: «1 son 12 soles, 2 solo efectivo, 3 sí».',
        'Ver todo (vale 7 días): https://alza.test/app/entrar/TOKEN',
      ].join('\n'),
    );
  });

  it('variante sin dudas: only the cash question; informative lines go before; web count and Sunday block before the link', () => {
    const text = closeMessageText({
      dayLabel: 'domingo 15',
      summary: {
        ...MARTA,
        unknownMethodSalesCents: 1_000,
        outCents: 0,
        inventoryCents: 0,
        householdCents: 0,
      },
      notices: [afterCloseLine(2_500, 'lunes 9'), TEXT_ONLY_LINE],
      doubts: [],
      cashQuestion: cashCheckQuestion(0).text,
      webCount: 1,
      week: {
        inCents: 214_000,
        outCents: 90_000,
        leftCents: 124_000,
        completeCount: 1,
        comparison: { comparable: false, text: NO_COMPARISON_TEXT },
      },
      link: 'https://x/e/T',
    });
    expect(text).toContain(
      'Entró: S/ 412 (Yape y Plin S/ 298, efectivo S/ 114, sin detalle S/ 10)',
    );
    expect(text).toContain('Salió: S/ 0\nAgregaste S/ 25 al lunes 9 después de su cierre.');
    expect(text).not.toContain('Tengo');
    expect(text).toContain('\n\nTu caja debería tener lo mismo que en la mañana. ¿Cuadra?\n\n');
    expect(text).toContain(
      'por ejemplo: «sí» o «no, saqué 20 para la casa».\nTienes 1 cosa más por revisar en la web.',
    );
    expect(
      text.endsWith(
        [
          '📅 Tu semana: entró S/ 2 140, salió S/ 900, te quedó S/ 1 240, 1 cierre completo.',
          'Esta semana no comparo porque faltaron cierres completos.',
          'Ver todo (vale 7 días): https://x/e/T',
        ].join('\n'),
      ),
    ).toBe(true);
  });

  it('comparison line only when PR02 applies (D60)', () => {
    const base = {
      dayLabel: 'domingo 15',
      summary: MARTA,
      notices: [],
      doubts: [],
      cashQuestion: 'q',
      webCount: 0,
      link: 'l',
    };
    const comparable = (leftDeltaCents: number) =>
      closeMessageText({
        ...base,
        week: {
          inCents: 1,
          outCents: 1,
          leftCents: 0,
          completeCount: 5,
          comparison: { comparable: true, inDeltaCents: 0, outDeltaCents: 0, leftDeltaCents },
        },
      });
    expect(comparable(12_000)).toContain('Te quedó S/ 120 más que la semana pasada.');
    expect(comparable(-500)).toContain('Te quedó S/ 5 menos que la semana pasada.');
    expect(comparable(0)).toContain('Te quedó lo mismo que la semana pasada.');
  });

  it('informative lines (PR09, PR03, D40, D27) with the exact texts', () => {
    expect(
      unitemizedCashLine({ recordedCents: 9_500, declaredCents: 20_000, addedCents: 10_500 }),
    ).toBe(
      'Ojo: anotaste S/ 95 en efectivo pero dijiste que vendiste S/ 200. Registré S/ 105 más. Si no es así, dímelo en tu respuesta.',
    );
    expect(digitalShortfallLine(4_000)).toBe(
      'Faltan S/ 40 en capturas. Si quieres, manda tu lista de movimientos.',
    );
    expect(TEXT_ONLY_LINE).toBe(
      'Desde hoy tu resumen va solo en texto. Para volver a la imagen, escribe “con imagen”.',
    );
  });

  it('the reply example follows the doubts actually sent', () => {
    expect(
      replyExampleLine([
        { type: 'possible_duplicate' },
        { type: 'direction' },
        { type: 'category' },
      ]),
    ).toBe(
      'Respóndeme en un solo mensaje o audio, por ejemplo: «1 fueron dos, 2 me pagaron, 3 mercadería, 4 sí».',
    );
  });
});

describe('WA-11, WA-12, WA-18, WA-21, WA-22', () => {
  it('WA-11 asks only for what was missing', () => {
    expect(
      clarifyText([
        { number: 2, question: 'Dijiste «hoy vendí 150». ¿Es todo el día o solo efectivo?' },
      ]),
    ).toBe(
      'No entendí el punto 2: dijiste «hoy vendí 150». ¿Es todo el día o solo efectivo? ¿Me lo dices de nuevo?',
    );
    expect(
      clarifyText([
        { number: 1, question: 'Una captura de las 9 a. m. no se lee bien. ¿De cuánto era?' },
        { number: 3, question: 'Tu caja debería tener S/ 5 más que en la mañana. ¿Cuadra?' },
      ]),
    ).toBe(
      [
        'No entendí los puntos 1 y 3:',
        '1️⃣ Una captura de las 9 a. m. no se lee bien. ¿De cuánto era?',
        '3️⃣ Tu caja debería tener S/ 5 más que en la mañana. ¿Cuadra?',
        '¿Me los dices de nuevo?',
      ].join('\n'),
    );
  });

  it('WA-12 as in 4.2, with the missing-list line', () => {
    expect(
      confirmationText({
        weekday: 'martes',
        level: 'complete',
        points: 10,
        balance: 340,
        nextReward: { name: 'Kit de limpieza', missingPoints: 60 },
        missingFromListCount: 0,
      }),
    ).toBe('✅ Martes cerrado completo.\n+10 ⭐ · Tienes 340. Te faltan 60 para kit de limpieza.');
    expect(
      confirmationText({
        weekday: 'sábado',
        level: 'partial',
        points: 4,
        balance: 4,
        nextReward: null,
        missingFromListCount: 2,
      }),
    ).toBe(
      '✅ Sábado cerrado a medias.\n+4 ⭐ · Tienes 4.\nEncontré 2 cobros sin registrar en tu lista: revísalos en la web.',
    );
  });

  it('fixed texts, and «ganancia» never appears', () => {
    expect(LATE_REPLY_TEXT).toBe('Lo anoté. Como pasó la hora, ya no suma puntos.');
    expect(NOTHING_RECORDED_TEXT).toBe(
      'Hoy todavía no tengo nada anotado. Cuando me mandes tus capturas o ventas, te armo tu cierre.',
    );
    expect(ALREADY_SENT_TEXT).toBe('Tu cierre de hoy está más arriba 👆');
    for (const text of [
      LATE_REPLY_TEXT,
      NOTHING_RECORDED_TEXT,
      ALREADY_SENT_TEXT,
      TEXT_ONLY_LINE,
    ]) {
      expect(text.toLowerCase()).not.toContain('ganancia');
    }
  });
});
