import { describe, expect, it } from 'vitest';
import { chatToolSpecs, resolveToolDay } from './tools.js';

describe('resolveToolDay (the server does the date arithmetic)', () => {
  const thursday = '2026-11-12';

  it.each([
    ['2026-11-03', '2026-11-03'],
    ['hoy', '2026-11-12'],
    ['ayer', '2026-11-11'],
    ['anteayer', '2026-11-10'],
    ['martes', '2026-11-10'],
    ['el Martes', '2026-11-10'],
    ['miércoles', '2026-11-11'],
    ['jueves', '2026-11-12'],
    ['viernes', '2026-11-06'],
    ['lunes', '2026-11-09'],
    ['domingo', '2026-11-08'],
  ])('«%s» → %s', (word, day) => {
    expect(resolveToolDay(word, thursday)).toBe(day);
  });

  it('anything else is not a day', () => {
    expect(resolveToolDay('la otra semana', thursday)).toBeNull();
    expect(resolveToolDay('2026-13-01', thursday)).toBeNull();
  });
});

describe('chatToolSpecs', () => {
  const names = (message: string) => chatToolSpecs(message).map((spec) => spec.name);

  it('offers propose_change only when her message asks for a change', () => {
    expect(names('¿cuánto vendí el martes?')).not.toContain('propose_change');
    expect(names('¿cuánto vendí el martes?')).toContain('search_entries');
    expect(names('el yape de 100 era de mi hermano, sácalo')).toContain('propose_change');
  });
});
