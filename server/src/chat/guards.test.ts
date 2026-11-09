import { describe, expect, it } from 'vitest';
import { asksForChange, isCreditQuestion, normalizeText, reviewReply } from './guards.js';
import { CHAT_TEXTS } from './texts.js';

describe('normalizeText', () => {
  it('lowercases, strips accents and collapses spaces', () => {
    expect(normalizeText('  ¿Me DARÁN   un préstamo? ')).toBe('¿me daran un prestamo?');
  });
});

describe('isCreditQuestion (RF-CH-02, HU-13)', () => {
  it.each([
    '¿me darán un préstamo?',
    'Me darán un prestamo con esto?',
    '¿Me van a dar crédito?',
    'me pueden prestar plata?',
    '¿Puedo sacar un préstamo con mi historial?',
    '¿califico para un crédito?',
    '¿Qué banco me da un préstamo?',
    'me conviene un credito?',
  ])('«%s» is a credit question', (message) => {
    expect(isCreditQuestion(message)).toBe(true);
  });

  it.each([
    '¿cuánto vendí el martes?',
    'el préstamo de mi tía era otro ingreso',
    '¿cuánto me prestaron el lunes?',
    'agrega el préstamo de 50 del lunes',
    '¿Cuántos puntos tengo?',
  ])('«%s» is not', (message) => {
    expect(isCreditQuestion(message)).toBe(false);
  });
});

describe('asksForChange (gate of propose_change)', () => {
  it.each([
    'el Yape de 100 era de mi hermano, sácalo',
    'quita el de 20',
    'eso no era venta',
    'eran 52, no 25',
    'cambia el de ayer a mercadería',
    'el lunes vendí 30 en efectivo y me olvidé, agrégalo',
    'está repetido',
    'ese es personal',
    'el lunes vendí 30 soles de pan en efectivo y no lo anoté',
    'ayer se me pasó mandar un yape de 20',
  ])('«%s» asks for a change', (message) => {
    expect(asksForChange(message)).toBe(true);
  });

  it.each([
    '¿cuánto vendí el martes?',
    '¿Qué movimientos tuve hoy?',
    '¿Cuántos puntos tengo?',
    '¿Qué es un comodín?',
    'gracias',
  ])('«%s» does not', (message) => {
    expect(asksForChange(message)).toBe(false);
  });
});

describe('reviewReply', () => {
  it('replaces credit promises and eligibility talk with the approved text', () => {
    for (const text of [
      '¡Sí! Con esas ventas te darán un préstamo seguro.',
      'Calificas para un crédito de Mibanco.',
      'Te recomiendo pedir un préstamo en Mibanco.',
      'Podrás sacar un crédito sin problema.',
    ]) {
      expect(reviewReply(text, { hasProposal: false })).toEqual({
        text: CHAT_TEXTS.credit,
        flags: ['credit'],
      });
    }
  });

  it('never lets the chat claim a change it cannot make', () => {
    expect(reviewReply('Listo, borré todo.', { hasProposal: false })).toEqual({
      text: CHAT_TEXTS.noChange,
      flags: ['claimed_change'],
    });
    expect(reviewReply('Ya lo saqué de tus ventas.', { hasProposal: true }).text).toBe(
      CHAT_TEXTS.proposal,
    );
    expect(reviewReply('Ya está cambiado.', { hasProposal: true }).text).toBe(CHAT_TEXTS.proposal);
  });

  it('keeps offers in the subjunctive («si quieres que lo saque»)', () => {
    const text = 'Encontré un Yape de S/ 100. ¿Quieres que lo saque de tus ventas?';
    expect(reviewReply(text, { hasProposal: false })).toEqual({ text, flags: [] });
  });

  it('never says «ganancia»', () => {
    const review = reviewReply('Tu ganancia de la semana fue S/ 232.', { hasProposal: false });
    expect(review.flags).toEqual(['profit_word']);
    expect(review.text).toBe('lo que te quedó de la semana fue S/ 232.');
    expect(review.text.toLowerCase()).not.toContain('ganancia');
  });

  it('leaves a normal answer as is', () => {
    const text = 'El martes vendiste S/ 412: S/ 298 con captura y S/ 114 que contaste tú.';
    expect(reviewReply(text, { hasProposal: false })).toEqual({ text, flags: [] });
  });
});
