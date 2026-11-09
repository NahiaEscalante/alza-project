/**
 * Her written answers in the onboarding (WA-03, WA-04, D48), cleaned and checked without AI.
 * A greeting or a «ok» is never taken as a business or holder name: the question is asked again.
 */
import { normalizeName } from '../../domain/index.js';

/** Same limit as the holders in Ajustes (`account/settings.ts`). */
export const ANSWER_MAX_LENGTH = 80;

/** Words that make a message small talk, not an answer («Hola ALZA», «buenas tardes», «ok»). */
const SMALL_TALK = new Set([
  'hola',
  'ola',
  'holi',
  'holaa',
  'buenas',
  'buenos',
  'buena',
  'buen',
  'dia',
  'dias',
  'tardes',
  'noches',
  'alza',
  'hey',
  'alo',
  'saludos',
  'que',
  'tal',
  'como',
  'estas',
  'hi',
  'hello',
  'ok',
  'okay',
  'oki',
  'si',
  'no',
  'gracias',
  'listo',
  'ya',
  'bueno',
  'dale',
]);

export function isSmallTalk(text: string): boolean {
  const words = normalizeName(text).split(' ').filter(Boolean);
  return words.length === 0 || words.every((word) => SMALL_TALK.has(word.replace(/\*$/, '')));
}

/** Collapses spaces and drops wrapping quotes and a final period or exclamation. */
function tidy(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[«"“'`]+/, '')
    .replace(/[»"”'`.!]+$/, '')
    .trim();
}

const BUSINESS_PREFIX = /^(?:(?:mi|el|la) (?:negocio|bodega|tienda) )?(?:se llama|es) /i;
const HOLDER_PREFIX =
  /^(?:(?:mi )?(?:yape|plin)(?: (?:y|o) (?:yape|plin))? )?(?:(?:est[aá]|es) )?a nombre de /i;
const HOLDER_PREFIX_SELF = /^(?:soy|es|mi nombre es) /i;

/** WA-03 answer → business name, or null to ask again. */
export function businessNameAnswer(raw: string | null): string | null {
  if (raw === null) return null;
  const name = tidy(tidy(raw).replace(BUSINESS_PREFIX, ''));
  if (name.length === 0 || name.length > ANSWER_MAX_LENGTH) return null;
  if (!/[\p{L}\p{N}]/u.test(name) || isSmallTalk(name)) return null;
  return name;
}

/** WA-04 answer (D48: written, as it shows in Yape or Plin) → holder name, or null. */
export function holderNameAnswer(raw: string | null): { name: string; normalized: string } | null {
  if (raw === null) return null;
  const name = tidy(tidy(raw).replace(HOLDER_PREFIX, '').replace(HOLDER_PREFIX_SELF, ''));
  if (name.length < 2 || name.length > ANSWER_MAX_LENGTH) return null;
  if ((name.match(/\p{L}/gu) ?? []).length < 2 || isSmallTalk(name)) return null;
  const normalized = normalizeName(name);
  if (normalized === '') return null;
  return { name, normalized };
}

/** {nombre} of WA-06: her first name from the holder («MARTA QUISPE» → «Marta»). */
export function firstNameOf(holderName: string | null, fallback: string): string {
  const word = (holderName ?? '')
    .split(' ')
    .find((token) => (token.match(/\p{L}/gu) ?? []).length >= 2);
  if (!word) return fallback;
  const clean = word.replace(/[^\p{L}'-]/gu, '');
  return clean.charAt(0).toLocaleUpperCase('es') + clean.slice(1).toLocaleLowerCase('es');
}

/** «borra mis datos», «elimina mi cuenta» (RF-PV-01), recognized also before the AI runs. */
export function isDeleteDataRequest(text: string | null): boolean {
  if (!text) return false;
  const plain = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return /\b(borr|elimin)\w*\b.*\b(datos|cuenta)\b/.test(plain);
}
