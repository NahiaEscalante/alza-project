/**
 * Display helpers shared by the image, the PDF and the Excel. Money always goes through
 * `formatSoles` (one format for the whole app, 8.6); dates through `ledger/labels`.
 */
import { formatAmount, type IsoDate, limaWallClock } from '../domain/index.js';

/** «1 250» (points, counts): same grouping as money, as in the web. */
export function formatPoints(points: number): string {
  return formatAmount(Math.round(points) * 100);
}

export function capitalize(value: string): string {
  return value.charAt(0).toLocaleUpperCase('es-PE') + value.slice(1);
}

/** «1 cierre completo» / «3 cierres completos». */
export function plural(count: number, one: string, many: string): string {
  return `${formatPoints(count)} ${count === 1 ? one : many}`;
}

/** Cuts `value` to `max` characters with «…» (8.6, business name). */
export function truncate(value: string, max: number): string {
  const chars = [...value.trim()];
  if (chars.length <= max) return chars.join('');
  return `${chars
    .slice(0, max - 1)
    .join('')
    .trimEnd()}…`;
}

/** «10/11/2026». */
export function formatShortDate(day: IsoDate): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
}

/** «10/11/26». */
export function formatCompactDate(day: IsoDate): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(2, 4)}`;
}

/** «10/11/26 14:05» (Lima). */
export function formatCompactDateTime(instant: Date): string {
  const { date, hour, minute } = limaWallClock(instant);
  return `${formatCompactDate(date)} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** «10/11/2026 14:05» (Lima). */
export function formatDateTime(instant: Date): string {
  const { date, hour, minute } = limaWallClock(instant);
  return `${formatShortDate(date)} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

const PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'do', 'dos', 'das']);

/**
 * PR04 / RF-RP-04: clients only as initials, «Rosa María Quispe» → «R. M.». Up to two initials
 * of the name words (joining words like «de la» are skipped). Null when nothing is left.
 */
export function initials(name: string | null | undefined): string | null {
  if (!name) return null;
  const words = name
    .split(/[\s\-_.,;:/]+/)
    .map((word) => word.replace(/[^\p{L}]/gu, ''))
    .filter((word) => word !== '')
    .filter((word) => !PARTICLES.has(word.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()));
  if (words.length === 0) return null;
  return words
    .slice(0, 2)
    .map((word) => `${[...word][0]?.toLocaleUpperCase('es-PE')}.`)
    .join(' ');
}
