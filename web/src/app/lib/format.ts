/**
 * Money and dates for the screens. `formatSoles` and `parseAmountToCents` mirror
 * `server/src/domain/money.ts` (one format for the whole app, 8.6): keep them in sync.
 */

export const MAX_AMOUNT_CENTS = 9_999_999;

/** «1 234,50» (no currency); whole amounts without «,00». */
export function formatAmount(cents: number): string {
  const absolute = Math.abs(Math.trunc(cents));
  const soles = Math.floor(absolute / 100);
  const rest = absolute % 100;
  const grouped = String(soles).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const body = rest !== 0 ? `${grouped},${String(rest).padStart(2, '0')}` : grouped;
  return cents < 0 ? `-${body}` : body;
}

/** «S/ 1 234,50», «S/ 232», «-S/ 50». */
export function formatSoles(cents: number): string {
  const body = formatAmount(Math.abs(cents));
  return cents < 0 ? `-S/ ${body}` : `S/ ${body}`;
}

/** Points with the spec's grouping: «2 500». */
export function formatPoints(points: number): string {
  return String(Math.round(points)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export type ParseAmountError = 'empty' | 'invalid' | 'decimals' | 'zero' | 'too_large';

export const PARSE_AMOUNT_MESSAGES: Record<ParseAmountError, string> = {
  empty: 'Escribe el monto.',
  invalid: 'Escribe solo el número, por ejemplo 12,50.',
  decimals: 'Usa como máximo 2 decimales.',
  zero: 'El monto debe ser mayor a S/ 0.',
  too_large: 'El monto puede ser hasta S/ 99 999,99.',
};

/**
 * Her typed amount to cents: «12», «12,50», «12.50», «1 285,50», «S/ 3.5». Anything that could be
 * read two ways («1.285») is rejected: a question is better than an invented amount.
 */
export function parseAmountToCents(
  input: string,
): { ok: true; cents: number } | { ok: false; error: ParseAmountError } {
  let text = input.trim().replace(/^s\/\.?\s*/i, '');
  if (text === '') return { ok: false, error: 'empty' };
  if (!/^[0-9.,\s ]+$/.test(text) || !/^\d/.test(text) || !/\d$/.test(text)) {
    return { ok: false, error: 'invalid' };
  }
  // Spaces only as thousands groups: «1 285,50».
  if (/[\s ]/.test(text) && !/^\d{1,3}([\s ]\d{3})+([.,]\d{1,2})?$/.test(text)) {
    return { ok: false, error: 'invalid' };
  }
  text = text.replace(/[\s ]/g, '');
  const dots = text.split('.').length - 1;
  const commas = text.split(',').length - 1;
  let integer = text;
  let fraction = '';
  if (dots > 0 && commas > 0) {
    const decimal = text.lastIndexOf('.') > text.lastIndexOf(',') ? '.' : ',';
    const group = decimal === '.' ? ',' : '.';
    if (text.split(decimal).length - 1 !== 1) return { ok: false, error: 'invalid' };
    const index = text.lastIndexOf(decimal);
    fraction = text.slice(index + 1);
    if (fraction.includes(group)) return { ok: false, error: 'invalid' };
    const parts = text.slice(0, index).split(group);
    if (!validGroups(parts)) return { ok: false, error: 'invalid' };
    integer = parts.join('');
  } else if (dots + commas > 0) {
    const separator = dots > 0 ? '.' : ',';
    const parts = text.split(separator);
    if (parts.length > 2) {
      if (separator === '.' || !validGroups(parts)) return { ok: false, error: 'invalid' };
      integer = parts.join('');
    } else {
      const [before = '', after = ''] = parts;
      if (separator === ',' && after.length === 3) {
        integer = before + after;
      } else {
        integer = before;
        fraction = after;
      }
    }
  }
  if (!/^\d+$/.test(integer) || !/^\d*$/.test(fraction)) return { ok: false, error: 'invalid' };
  if (fraction.length > 2) return { ok: false, error: 'decimals' };
  const significant = integer.replace(/^0+(?=\d)/, '');
  if (significant.length > 9) return { ok: false, error: 'too_large' };
  const cents = Number(significant) * 100 + Number(fraction.padEnd(2, '0'));
  if (cents === 0) return { ok: false, error: 'zero' };
  if (cents > MAX_AMOUNT_CENTS) return { ok: false, error: 'too_large' };
  return { ok: true, cents };
}

function validGroups(parts: string[]): boolean {
  const [first, ...rest] = parts;
  return first !== undefined && /^\d{1,3}$/.test(first) && rest.every((p) => /^\d{3}$/.test(p));
}

// ---------------------------------------------------------------------------
// Dates (America/Lima, business day from 4:00 a. m., D12)
// ---------------------------------------------------------------------------

const LIMA = 'America/Lima';
const DAY_MS = 86_400_000;

const limaParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: LIMA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function wallClock(instant: Date) {
  const parts = Object.fromEntries(limaParts.formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/** Today's business day: from 4:00 a. m. to 3:59 a. m., Lima time. */
export function todayBusinessDay(now = new Date()): string {
  return wallClock(new Date(now.getTime() - 4 * 3_600_000)).date;
}

function toUtc(day: string): number {
  return Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
}

export function addDays(day: string, days: number): string {
  return new Date(toUtc(day) + days * DAY_MS).toISOString().slice(0, 10);
}

/** 1 = Monday … 7 = Sunday. */
export function isoWeekday(day: string): number {
  const weekday = new Date(toUtc(day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

export function weekStart(day: string): string {
  return addDays(day, 1 - isoWeekday(day));
}

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && addDays(value, 0) === value;
}

const WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];
const SHORT_MONTHS = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'set',
  'oct',
  'nov',
  'dic',
];

export const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** «martes 10». */
export function dayLabel(day: string): string {
  return `${WEEKDAYS[isoWeekday(day) - 1]} ${Number(day.slice(8, 10))}`;
}

/** «martes 10 de noviembre». */
export function longDayLabel(day: string): string {
  return `${dayLabel(day)} de ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
}

/** «L», «M», «X»… for the chart. */
export function weekdayInitial(day: string): string {
  return ['L', 'M', 'X', 'J', 'V', 'S', 'D'][isoWeekday(day) - 1] as string;
}

/** «8 nov, 14:05» (Lima). */
export function formatDateTime(iso: string): string {
  const w = wallClock(new Date(iso));
  return `${w.day} ${SHORT_MONTHS[w.month - 1]}, ${String(w.hour).padStart(2, '0')}:${String(w.minute).padStart(2, '0')}`;
}

/** «8 nov» (Lima). */
export function formatShortDate(iso: string): string {
  const w = wallClock(new Date(iso));
  return `${w.day} ${SHORT_MONTHS[w.month - 1]}`;
}

/** «Semana del 9 al 15 nov», as the server labels a week (12.2). */
export function weekLabel(monday: string): string {
  const sunday = addDays(monday, 6);
  const d1 = Number(monday.slice(8, 10));
  const d2 = Number(sunday.slice(8, 10));
  const m1 = SHORT_MONTHS[Number(monday.slice(5, 7)) - 1];
  const m2 = SHORT_MONTHS[Number(sunday.slice(5, 7)) - 1];
  return m1 === m2 ? `Semana del ${d1} al ${d2} ${m2}` : `Semana del ${d1} ${m1} al ${d2} ${m2}`;
}

/** «Tienes 2 cosas por revisar» (12.2 Inicio, same text as the server's `pendingNotice`). */
export function pendingNotice(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? 'Tienes 1 cosa por revisar' : `Tienes ${count} cosas por revisar`;
}

export const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
