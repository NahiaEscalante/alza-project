import { describe, expect, it } from 'vitest';
import {
  matchesAnyHolder,
  matchesName,
  mentionMatchesName,
  nameTokens,
  normalizeName,
} from './names.js';

describe('normalizeName', () => {
  it.each([
    ['Fernando Sar*', 'fernando sar*'],
    ['MARÍA  Ñañez', 'maria nanez'],
    ['Marta Q.', 'marta q'],
    ['Jenny Patricia ...', 'jenny patricia'],
    ['Cuenta independ...', 'cuenta independ*'],
    ['  José   Quiñones-Pérez ', 'jose quinones perez'],
    ['Distribuidora Sur S.A.C.', 'distribuidora sur sac'],
    ['Ana T…', 'ana t*'],
    ['', ''],
  ])('%s → %s', (raw, normalized) => {
    expect(normalizeName(raw)).toBe(normalized);
  });

  it('round-trips the truncation mark', () => {
    expect(nameTokens(normalizeName('Fernando Sar*'))).toEqual(nameTokens('Fernando Sar*'));
    expect(nameTokens(null)).toEqual([]);
  });
});

describe('matchesName (coincide, 11.2)', () => {
  it.each([
    ['Marta Q.', 'Marta Quispe Huamán'],
    ['marta quispe', 'MARTA QUISPE'],
    ['Fernando Sar*', 'Fernando Sarmiento López'],
    ['Jenny Patricia ...', 'Jenny Patricia Rojas Díaz'],
    ['Juan Carlos Pérez G.', 'Juan Pérez'],
    ['Quispe Huamán Marta', 'Marta Quispe'],
    ['Marta Elena Quispe', 'Marta Q.'],
    ['María de la Cruz', 'María C.'],
  ])('%s matches %s', (a, b) => {
    expect(matchesName(a, b)).toBe(true);
    expect(matchesName(b, a)).toBe(true);
  });

  it.each([
    ['Marta R.', 'Marta Quispe'],
    ['Rosa Quispe', 'Marta Quispe'],
    ['María de la Cruz', 'Rosa de la Torre'],
    ['Marta', 'Marta Quispe'],
    ['Q.', 'Marta Quispe'],
    ['', 'Marta Quispe'],
    [null, 'Marta Quispe'],
  ])('%s does not match %s', (a, b) => {
    expect(matchesName(a, b)).toBe(false);
  });

  it('matches against the principal and up to 2 additional holders (D31)', () => {
    const holders = ['Marta Quispe Huamán', 'Pedro Rojas Vega'];
    expect(matchesAnyHolder('Pedro R.', holders)).toBe(true);
    expect(matchesAnyHolder('Ana T.', holders)).toBe(false);
    expect(matchesAnyHolder('Marta Q.', [])).toBe(false);
  });
});

describe('mentionMatchesName', () => {
  it('matches what she wrote against the screen name', () => {
    expect(mentionMatchesName('Rosa', 'Rosa Mendoza')).toBe(true);
    expect(mentionMatchesName('rosa', 'Rosa M.')).toBe(true);
    expect(mentionMatchesName('Rosa', 'Rosaura Díaz')).toBe(false);
    expect(mentionMatchesName('Rosa Díaz', 'Rosa Mendoza')).toBe(false);
    expect(mentionMatchesName('', 'Rosa Mendoza')).toBe(false);
  });
});
