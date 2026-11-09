import { describe, expect, it } from 'vitest';
import {
  businessNameAnswer,
  firstNameOf,
  holderNameAnswer,
  isDeleteDataRequest,
  isSmallTalk,
} from './answers.js';
import { parseCloseTimeAnswer } from './close-time.js';

describe('WA-05 close time answers (RF-ON-04, D12)', () => {
  it.each([
    ['9', '21:00'],
    ['9 pm', '21:00'],
    ['9pm', '21:00'],
    ['9:30 pm', '21:30'],
    ['9.30 p. m.', '21:30'],
    ['21:00', '21:00'],
    ['21:00:00', '21:00'],
    ['20 hrs', '20:00'],
    ['a las 10', '22:00'],
    ['a las 10 de la noche', '22:00'],
    ['Cierro como a las 8', '20:00'],
    ['nueve y media', '21:30'],
    ['a la una', '01:00'],
    ['1 am', '01:00'],
    ['2 a. m.', '02:00'],
    ['2:00', '02:00'],
    ['12', '00:00'],
    ['12 am', '00:00'],
    ['medianoche', '00:00'],
    ['00:30', '00:30'],
    ['11 p.m.', '23:00'],
    ['3', '15:00'],
    ['12 pm', '12:00'],
    ['20:00', '20:00'],
  ])('«%s» → %s', (input, closeTime) => {
    expect(parseCloseTimeAnswer(input)).toEqual({ ok: true, closeTime });
  });

  it.each([
    ['3 am', 'too_late'],
    ['2:30', 'too_late'],
    ['2:30 am', 'too_late'],
    ['a las 3 de la madrugada', 'too_late'],
    ['10 am', 'too_late'],
    ['8 de la mañana', 'too_late'],
    ['hola', 'not_a_time'],
    ['', 'not_a_time'],
    ['25:00', 'not_a_time'],
    ['9:75', 'not_a_time'],
    ['14 am', 'not_a_time'],
  ])('«%s» is rejected (%s)', (input, error) => {
    expect(parseCloseTimeAnswer(input)).toEqual({ ok: false, error });
  });
});

describe('WA-03 / WA-04 answers', () => {
  it('cleans the business name and rejects small talk', () => {
    expect(businessNameAnswer('  Bodega   Marta. ')).toBe('Bodega Marta');
    expect(businessNameAnswer('Se llama «Bodega Rosita»')).toBe('Bodega Rosita');
    expect(businessNameAnswer('Hola ALZA')).toBeNull();
    expect(businessNameAnswer('buenas tardes!')).toBeNull();
    expect(businessNameAnswer('...')).toBeNull();
    expect(businessNameAnswer('x'.repeat(81))).toBeNull();
    expect(businessNameAnswer(null)).toBeNull();
  });

  it('D48: the holder is written as in the app and normalized', () => {
    expect(holderNameAnswer('Marta Quispe H.')).toEqual({
      name: 'Marta Quispe H',
      normalized: 'marta quispe h',
    });
    expect(holderNameAnswer('Está a nombre de María Ñañez')).toEqual({
      name: 'María Ñañez',
      normalized: 'maria nanez',
    });
    expect(holderNameAnswer('De la Cruz Rosa')).toEqual({
      name: 'De la Cruz Rosa',
      normalized: 'de la cruz rosa',
    });
    expect(holderNameAnswer('ok')).toBeNull();
    expect(holderNameAnswer('M')).toBeNull();
    expect(holderNameAnswer('12345')).toBeNull();
  });

  it('{nombre} is her first name', () => {
    expect(firstNameOf('MARTA QUISPE', 'Bodega')).toBe('Marta');
    expect(firstNameOf('maría elena', 'Bodega')).toBe('María');
    expect(firstNameOf('M. Quispe', 'Bodega')).toBe('Quispe');
    expect(firstNameOf(null, 'Bodega Marta')).toBe('Bodega Marta');
  });

  it('recognizes small talk and «borra mis datos»', () => {
    expect(isSmallTalk('Hola ALZA 👋')).toBe(true);
    expect(isSmallTalk('Bodega Buenos Días')).toBe(false);
    expect(isDeleteDataRequest('Borra mis datos por favor')).toBe(true);
    expect(isDeleteDataRequest('quiero eliminar mi cuenta')).toBe(true);
    expect(isDeleteDataRequest('Bodega Marta')).toBe(false);
  });
});
