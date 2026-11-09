/**
 * Plain-JSON OCR results, so parsers are pure functions and tests run on captured fixtures
 * (no tesseract in unit tests). Coordinates are pixels of the preprocessed image.
 */

export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrWord {
  text: string;
  /** 0..100 */
  confidence: number;
  bbox: BBox;
}

export interface OcrLine {
  text: string;
  /** 0..100 */
  confidence: number;
  bbox: BBox;
  words: OcrWord[];
}

export interface OcrPage {
  width: number;
  height: number;
  /** Mean confidence 0..100 */
  confidence: number;
  /** Top to bottom. */
  lines: OcrLine[];
}

export interface OcrSymbol {
  text: string;
  confidence: number;
  bbox: BBox;
}

/** A single text line read with symbol boxes (used for the amount). */
export interface OcrLineRead {
  text: string;
  confidence: number;
  symbols: OcrSymbol[];
}

/** Horizontal band of the page, in preprocessed-image pixels. */
export interface Band {
  top: number;
  bottom: number;
}
