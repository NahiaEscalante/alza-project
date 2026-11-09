import type { OcrPage } from '../types.js';
import { bancomParser } from './bancom.js';
import { bbvaParser } from './bbva.js';
import { luqeaParser } from './luqea.js';
import type { LayoutMatch, LayoutParser } from './types.js';
import { yapeParser } from './yape.js';

export type { LayoutFields, LayoutMatch, LayoutParser } from './types.js';

/** Version of the deterministic readers, stored like a prompt version (8.3). */
export const OCR_PARSERS_VERSION = 'ocr_layouts/2026-11-08.1';

/** Order matters: the most specific titles first. */
export const LAYOUT_PARSERS: LayoutParser[] = [yapeParser, luqeaParser, bancomParser, bbvaParser];

export function matchLayout(page: OcrPage): { parser: LayoutParser; match: LayoutMatch } | null {
  for (const parser of LAYOUT_PARSERS) {
    const match = parser.match(page);
    if (match) return { parser, match };
  }
  return null;
}
