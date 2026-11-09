/**
 * Name normalization and `coincide()` (11.2).
 *
 * Yape and Plin show abbreviated or truncated names: «Marta Q.», «Fernando Sar*»,
 * «Jenny Patricia ...». Normalizing lowercases, removes accents and punctuation and collapses
 * spaces, but keeps a trailing «*» on a truncated word, so the stored `*_normalized` value can be
 * matched again later without losing that information.
 */

export interface NameToken {
  /** Lowercase letters/digits, no accents. */
  text: string;
  /** The screen cut the word («Sar*», «independ...»): it matches any word that starts with it. */
  truncated: boolean;
  /** A single letter («Q.»): only usable as an initial. */
  initial: boolean;
}

/** Joining words that never count as a name word («María de la Cruz»). */
const PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'do', 'dos', 'das']);

const TRUNCATION = /(?:\*|…|\.{2,})$/;

export function nameTokens(raw: string | null | undefined): NameToken[] {
  if (!raw) return [];
  const ascii = raw.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const tokens: NameToken[] = [];
  for (const chunk of ascii.split(/[\s-]+/)) {
    const truncated = TRUNCATION.test(chunk);
    const text = chunk.replace(/[^a-z0-9]/g, '');
    if (text === '') continue;
    tokens.push({ text, truncated, initial: text.length === 1 && !truncated });
  }
  return tokens;
}

/** «Fernando Sar*» → «fernando sar*»; «MARÍA  Ñañez» → «maria nanez»; «Marta Q.» → «marta q». */
export function normalizeName(raw: string | null | undefined): string {
  return nameTokens(raw)
    .map((token) => (token.truncated ? `${token.text}*` : token.text))
    .join(' ');
}

/** Two words are the same word, allowing for a truncated one («sar*» ~ «sarmiento»). */
function sameWord(a: NameToken, b: NameToken): boolean {
  if (a.initial || b.initial) return false;
  if (a.truncated && b.truncated) return a.text.startsWith(b.text) || b.text.startsWith(a.text);
  if (a.truncated) return b.text.startsWith(a.text);
  if (b.truncated) return a.text.startsWith(b.text);
  return a.text === b.text;
}

function meaningful(tokens: NameToken[]): NameToken[] {
  return tokens.filter((token) => !PARTICLES.has(token.text));
}

/**
 * Initials of the word that may be the first surname. Peruvian names are «given names + paternal
 * surname + maternal surname», but screens drop or abbreviate parts, so:
 * 2 words → the 2nd; 3 words → the 2nd or the 3rd («Marta Elena Quispe» / «Marta Quispe Huamán»);
 * 4 or more → the second to last.
 */
function firstSurnameInitials(tokens: NameToken[]): string[] {
  const n = tokens.length;
  const candidates =
    n < 2 ? [] : n === 2 ? [tokens[1]] : n === 3 ? [tokens[1], tokens[2]] : [tokens[n - 2]];
  return candidates.flatMap((token) => (token ? [token.text.charAt(0)] : []));
}

function sharedWords(a: NameToken[], b: NameToken[]): number {
  const used = new Set<number>();
  let shared = 0;
  for (const token of a) {
    const index = b.findIndex((other, i) => !used.has(i) && sameWord(token, other));
    if (index >= 0) {
      used.add(index);
      shared += 1;
    }
  }
  return shared;
}

/**
 * `coincide(a, b)` (11.2): same first name and same initial of the first surname, or at least two
 * shared words. Initials never count as shared words.
 */
export function matchesName(a: string | null | undefined, b: string | null | undefined): boolean {
  const ta = meaningful(nameTokens(a));
  const tb = meaningful(nameTokens(b));
  const firstA = ta[0];
  const firstB = tb[0];
  if (!firstA || !firstB) return false;

  if (sameWord(firstA, firstB)) {
    const initialsB = firstSurnameInitials(tb);
    if (firstSurnameInitials(ta).some((initial) => initialsB.includes(initial))) return true;
  }
  return sharedWords(ta, tb) >= 2;
}

/** Principal holder plus up to 2 additional ones (D31). */
export const MAX_ADDITIONAL_HOLDERS = 2;

/** `coincide(name, alguno de los titulares del negocio)`. */
export function matchesAnyHolder(
  name: string | null | undefined,
  holders: readonly string[],
): boolean {
  return holders.some((holder) => matchesName(name, holder));
}

/**
 * Looser match for what she writes («me yapearon 20 de Rosa»): every word she wrote matches a word
 * of the screen's name, so «Rosa» matches «Rosa Mendoza» and «Rosa M.».
 */
export function mentionMatchesName(
  mention: string | null | undefined,
  name: string | null | undefined,
): boolean {
  const words = meaningful(nameTokens(mention)).filter((token) => !token.initial);
  const target = meaningful(nameTokens(name));
  if (words.length === 0 || target.length === 0) return false;
  return sharedWords(words, target) === words.length;
}
