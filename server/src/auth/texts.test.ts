import { describe, expect, it } from 'vitest';
import { limaInstant } from '../domain/index.js';
import { lockedMessage, wrongPinMessage } from './texts.js';

describe('access texts (HU-10)', () => {
  it('says when she can try again, with a single period after «p. m.»', () => {
    const until = limaInstant('2026-11-10', 21, 7);
    expect(lockedMessage(until, true)).toBe(
      'Escribiste mal tu PIN 5 veces. Por seguridad, espera 15 minutos. Puedes volver a intentar a las 9:07 p. m.',
    );
    expect(lockedMessage(until, false)).toBe(
      'Tu PIN está bloqueado por unos minutos. Puedes volver a intentar a las 9:07 p. m.',
    );
  });

  it('counts the attempts left', () => {
    expect(wrongPinMessage(1)).toBe('PIN incorrecto. Te queda 1 intento.');
    expect(wrongPinMessage(4)).toBe('PIN incorrecto. Te quedan 4 intentos.');
  });
});
