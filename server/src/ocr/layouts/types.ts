import type { HolderRole, ReceiptHeader, ScreenshotLayout } from '../../ai/schemas.js';
import type { PaymentMethod } from '../../db/schema.js';
import { isWordLine } from '../text.js';
import type { Band, OcrLine, OcrPage } from '../types.js';

export interface LayoutMatch {
  layout: ScreenshotLayout;
  /** Line right above the big amount (screen title or «Importe ...»). */
  anchorIndex: number;
}

/** Everything a layout reads except the amount, which is re-read on its own band. */
export interface LayoutFields {
  payment_method: PaymentMethod;
  receipt_header: ReceiptHeader;
  receipt_header_text: string | null;
  holder_role: HolderRole;
  counterparty_name: string | null;
  visible_holder_name: string | null;
  occurred_at: string | null;
  operation_number: string | null;
  /** 0..1 per field, from OCR line confidence. */
  confidence: Record<string, number>;
}

export interface LayoutParser {
  layout: ScreenshotLayout;
  match(page: OcrPage): LayoutMatch | null;
  amountBand(page: OcrPage, match: LayoutMatch): Band;
  parse(page: OcrPage, match: LayoutMatch): LayoutFields;
  /** Other amounts printed on the screen that must equal the main one (BBVA «Importe abonado»). */
  crossCheckAmounts?(page: OcrPage): string[];
}

/** Lines that can sit inside the amount band without ending it (the amount itself, OCR noise). */
function endsAmountBand(line: OcrLine): boolean {
  return isWordLine(line);
}

/**
 * Band between the anchor line and the next line of words (a name, «Comisión», «N° Op»), capped at
 * `maxFactor` anchor heights.
 */
export function bandBelow(page: OcrPage, anchorIndex: number, maxFactor: number): Band {
  const anchor = page.lines[anchorIndex] as OcrLine;
  const anchorHeight = anchor.bbox.y1 - anchor.bbox.y0;
  let bottom = Math.min(page.height, anchor.bbox.y1 + maxFactor * anchorHeight);
  for (let i = anchorIndex + 1; i < page.lines.length; i++) {
    const line = page.lines[i] as OcrLine;
    if (line.bbox.y0 <= anchor.bbox.y1 + anchorHeight * 0.3) continue;
    if (line.bbox.y0 >= bottom) break;
    if (endsAmountBand(line)) {
      bottom = line.bbox.y0;
      break;
    }
  }
  return { top: anchor.bbox.y1 + 2, bottom: Math.max(anchor.bbox.y1 + 3, bottom - 2) };
}
