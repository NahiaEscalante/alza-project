/**
 * Her close time as she writes it (WA-05, RF-ON-04, D12): «9», «9:30 pm», «21:00», «a las 10»,
 * «1 am», «nueve y media», «medianoche». The buttons send «20:00», «21:00» or «22:00».
 *
 * Without «a. m.»/«p. m.» an hour is read the way a bodega closes: 1–2 → a. m. (up to 2:00),
 * 3–11 → p. m., 12 → midnight. Accepted: from 12:00 (noon) to 2:00 a. m. (D12); later at night
 * («3 am») or morning times are `too_late` and WA-05 is asked again. Pure, no AI.
 */
import { parseCloseTime } from '../../domain/index.js';

export type CloseTimeAnswer =
  | { ok: true; closeTime: string }
  | { ok: false; error: 'not_a_time' | 'too_late' };

const NUMBER_WORDS: Record<string, number> = {
  una: 1,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
};

/** Noon, in minutes since midnight: earlier times (morning) are not a close time here. */
const EARLIEST_CLOSE_MINUTES = 12 * 60;

function normalize(input: string): string {
  return input.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

const TIME =
  /(\d{1,2})(?:\s*(?:[:.h]|y)\s*(\d{2})\b)?(\s*y\s*(?:media|cuarto)\b)?(?:\s*(?:hrs?|hs|horas?)\b\.?)?/;
const MERIDIEM =
  /^\s*(?:(a)\.?\s*m\b\.?|(p)\.?\s*m\b\.?|(?:de|en|por) la (manana|madrugada|tarde|noche))/;

export function parseCloseTimeAnswer(input: string): CloseTimeAnswer {
  let text = normalize(input);
  if (/\bmedianoche\b/.test(text)) return { ok: true, closeTime: '00:00' };
  if (/\bmediodia\b/.test(text)) return { ok: true, closeTime: '12:00' };
  text = text.replace(
    /\b(una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\b/g,
    (word) => String(NUMBER_WORDS[word]),
  );

  const match = TIME.exec(text);
  if (!match || match.index === undefined) return { ok: false, error: 'not_a_time' };
  const hour = Number(match[1]);
  let minute = match[2] !== undefined ? Number(match[2]) : 0;
  if (match[3]) minute = /media/.test(match[3]) ? 30 : 15;
  if (hour > 23 || minute > 59) return { ok: false, error: 'not_a_time' };

  const rest = text.slice(match.index + match[0].length);
  const meridiem = MERIDIEM.exec(rest);
  const period = meridiem
    ? meridiem[1] || meridiem[3] === 'manana' || meridiem[3] === 'madrugada'
      ? 'am'
      : 'pm'
    : null;

  let hour24: number;
  if (period === 'am') {
    if (hour > 12) return { ok: false, error: 'not_a_time' };
    hour24 = hour === 12 ? 0 : hour;
  } else if (period === 'pm') {
    hour24 = hour >= 12 ? hour : hour + 12;
  } else if (hour === 0 || hour >= 13) {
    hour24 = hour;
  } else if (hour <= 2) {
    hour24 = hour;
  } else if (hour === 12) {
    hour24 = 0;
  } else {
    hour24 = hour + 12;
  }

  const closeTime = `${pad(hour24)}:${pad(minute)}`;
  const minutesOfDay = hour24 * 60 + minute;
  const isNightOrAfternoon = minutesOfDay >= EARLIEST_CLOSE_MINUTES || minutesOfDay <= 2 * 60;
  if (!isNightOrAfternoon || parseCloseTime(closeTime) === null) {
    return { ok: false, error: 'too_late' };
  }
  return { ok: true, closeTime };
}
