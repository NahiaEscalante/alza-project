/**
 * Fonts shipped with the server (8.6: never downloaded at render time). Inter 4.1 static TTFs
 * from rsms/inter (SIL OFL 1.1, `assets/fonts/LICENSE-Inter.txt`). Satori needs TTF/OTF/WOFF, so
 * no WOFF2 here.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SERVER_ROOT } from '../paths.js';

export const FONTS_DIR = resolve(SERVER_ROOT, 'assets', 'fonts');
export const FONT_FAMILY = 'Inter';

export type FontWeight = 400 | 600 | 700 | 800;

export const FONT_FILES: Record<FontWeight, string> = {
  400: 'Inter-Regular.ttf',
  600: 'Inter-SemiBold.ttf',
  700: 'Inter-Bold.ttf',
  800: 'Inter-ExtraBold.ttf',
};

export function fontPath(weight: FontWeight): string {
  return resolve(FONTS_DIR, FONT_FILES[weight]);
}

const cache = new Map<FontWeight, Buffer>();

/** Font bytes, read once per process. */
export function fontData(weight: FontWeight): Buffer {
  let data = cache.get(weight);
  if (!data) {
    data = readFileSync(fontPath(weight));
    cache.set(weight, data);
  }
  return data;
}

/**
 * Advance widths (per 1000 em) of the characters used in amounts, measured from the shipped
 * fonts with fontkit. Used to pick a font size that fits S/ 0 to S/ 99 999,99 in every field;
 * kerning only makes real text narrower, so the estimate is safe.
 */
const AMOUNT_ADVANCES: Record<FontWeight, Record<string, number>> = {
  400: digits([631, 407, 610, 618, 646, 593, 620, 566, 619, 620], { S: 642, '/': 360, ' ': 281 }),
  600: digits([660, 423, 623, 636, 666, 612, 640, 576, 640, 640], { S: 650, '/': 379, ' ': 252 }),
  700: digits([674, 431, 630, 646, 676, 622, 649, 582, 651, 649], { S: 655, '/': 388, ' ': 237 }),
  800: digits([692, 441, 638, 657, 688, 634, 662, 588, 664, 662], { S: 660, '/': 400, ' ': 219 }),
};

function digits(widths: number[], extra: Record<string, number>): Record<string, number> {
  const table: Record<string, number> = { ',': 353, '.': 353, '-': 471, '+': 686, ...extra };
  widths.forEach((width, digit) => {
    table[String(digit)] = width;
  });
  return table;
}

/** Estimated width in px of `text` at `size` px (unknown characters count as 0.72 em). */
export function estimateTextWidth(text: string, size: number, weight: FontWeight): number {
  const table = AMOUNT_ADVANCES[weight];
  let total = 0;
  for (const char of text) total += table[char] ?? 720;
  return (total / 1000) * size;
}

/** Largest size ≤ `max` (and ≥ `min`) at which `text` fits in `width` px. */
export function fitFontSize(
  text: string,
  width: number,
  weight: FontWeight,
  max: number,
  min = 10,
): number {
  const atOne = estimateTextWidth(text, 1, weight);
  if (atOne === 0) return max;
  return Math.max(min, Math.min(max, Math.floor((width / atOne) * 2) / 2));
}
