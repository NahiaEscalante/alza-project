import type { OcrLine, OcrPage } from './types.js';

/** Lowercase, no accents, single spaces: what the layout regexes match against. */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function findLineIndex(
  page: OcrPage,
  pattern: RegExp,
  options: { from?: number; to?: number } = {},
): number {
  const to = Math.min(options.to ?? page.lines.length, page.lines.length);
  for (let i = options.from ?? 0; i < to; i++) {
    if (pattern.test(fold((page.lines[i] as OcrLine).text))) return i;
  }
  return -1;
}

export function pageText(page: OcrPage): string {
  return fold(page.lines.map((l) => l.text).join('\n'));
}

/** A line that reads as words (a name, a label), not digits or OCR noise from a logo. */
export function isWordLine(line: OcrLine, minConfidence = 50): boolean {
  if (line.confidence < minConfidence) return false;
  const letters = line.text.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '');
  const withoutSign = line.text.replace(/^\W*S\s*\/+/i, '');
  return letters.length >= 3 && /[A-Za-zÁÉÍÓÚÑáéíóúñ]{2,}/.test(withoutSign);
}

/** Trims OCR debris around a name: quotes, pipes, bullets, trailing punctuation. */
export function cleanName(text: string | null | undefined): string | null {
  if (!text) return null;
  const cleaned = text
    .replace(/[|"“”'`´_=~<>«»•●]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,:;-]+|[\s,:;-]+$/g, '')
    .trim();
  return /[A-Za-zÁÉÍÓÚÑáéíóúñ]{2,}/.test(cleaned) ? cleaned : null;
}

const MONTHS: Record<string, number> = {
  ene: 1,
  enero: 1,
  feb: 2,
  febrero: 2,
  mar: 3,
  marzo: 3,
  abr: 4,
  abril: 4,
  may: 5,
  mayo: 5,
  jun: 6,
  junio: 6,
  jul: 7,
  julio: 7,
  ago: 8,
  agosto: 8,
  set: 9,
  sep: 9,
  sept: 9,
  setiembre: 9,
  septiembre: 9,
  oct: 10,
  octubre: 10,
  nov: 11,
  noviembre: 11,
  dic: 12,
  diciembre: 12,
};

const MONTH_WORDS = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join('|');
const DAY_MONTH_YEAR = new RegExp(
  `(?:^|\\D)(\\d{1,2})\\s+(${MONTH_WORDS})\\.?,?\\s+(\\d{4})(?!\\d)`,
);
const NUMERIC_DATE = /(?:^|\D)(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?!\d)/;
const TIME = /(?:^|\D)(\d{1,2}):(\d{2})(?!\d)\s*(?:h\b|hrs?\b)?\s*([ap])?\.?\s*(m\b|m\.)?/;

export interface DateParts {
  year: number;
  month: number;
  day: number;
}

export interface TimeParts {
  hour: number;
  minute: number;
}

/** «04 nov. 2026», «27 enero 2024», «28 nov 2025», «15/09/25» (day first). */
export function parseSpanishDate(text: string): DateParts | null {
  const folded = fold(text);
  const named = DAY_MONTH_YEAR.exec(folded);
  if (named) {
    return validDate(Number(named[3]), MONTHS[named[2] as string] ?? 0, Number(named[1]));
  }
  const numeric = NUMERIC_DATE.exec(folded);
  if (numeric) {
    const rawYear = Number(numeric[3]);
    const year = (numeric[3] as string).length === 2 ? 2000 + rawYear : rawYear;
    return validDate(year, Number(numeric[2]), Number(numeric[1]));
  }
  return null;
}

function validDate(year: number, month: number, day: number): DateParts | null {
  if (year < 2015 || year > 2100 || month < 1 || month > 12 || day < 1) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth ? { year, month, day } : null;
}

/** «8:44 p.m.», «8:44 p. m.», «17:02 h», «10:31», «07:33». */
export function parseTime(text: string): TimeParts | null {
  const folded = fold(text).replace(/([ap])\s*\.\s*m\b\.?/g, '$1m');
  const m = TIME.exec(folded);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const meridiem = m[3] && m[4] ? m[3] : /\b([ap])m\b/.exec(folded.slice(m.index))?.[1];
  if (meridiem === 'p' && hour < 12) hour += 12;
  if (meridiem === 'a' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** Lima local time (UTC-5, no DST) as ISO 8601. */
export function limaIso(date: DateParts, time: TimeParts): string {
  return `${date.year}-${pad(date.month)}-${pad(date.day)}T${pad(time.hour)}:${pad(time.minute)}:00-05:00`;
}

/** Date and time from one line («04 nov. 2026 | 8:44 p.m.») or null if either is missing. */
export function parseDateTime(text: string): string | null {
  const date = parseSpanishDate(text);
  if (!date) return null;
  const folded = fold(text);
  const named = DAY_MONTH_YEAR.exec(folded) ?? NUMERIC_DATE.exec(folded);
  const rest = named ? folded.slice(named.index + named[0].length) : folded;
  const time = parseTime(rest);
  return time ? limaIso(date, time) : null;
}

/**
 * Hex operation codes (Bancom, Luqea): fixes only confusions that cannot be hex (l, I, | → 1;
 * o → 0) and lowercases. Anything else stays and fails the format check later.
 */
export function cleanHexCode(text: string): string {
  return text.replace(/[lI|]/g, '1').replace(/[oO]/g, '0').replace(/\s+/g, '').toLowerCase();
}

/** Mean confidence of some lines as 0..1. */
export function confidenceOf(...lines: (OcrLine | undefined)[]): number {
  const present = lines.filter((l): l is OcrLine => l !== undefined);
  if (present.length === 0) return 0;
  const mean = present.reduce((sum, l) => sum + l.confidence, 0) / present.length;
  return Math.round(mean) / 100;
}
