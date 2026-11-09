import type { ImageClass, ScreenshotLayout, ScreenshotOperation } from '../ai/schemas.js';
import {
  AMOUNT_WHITELIST,
  type AmountRead,
  type AmountReadFailure,
  amountFromLine,
  DIGITS_WHITELIST,
} from './amount.js';
import { classifyByKeywords } from './classify.js';
import type { OcrEngine } from './engine.js';
import { segmentAmountBand } from './glyphs.js';
import { matchLayout } from './layouts/index.js';
import { bandPixels, grayToPng, preprocessForOcr } from './preprocess.js';
import type { OcrLineRead, OcrPage } from './types.js';

/** The cleaned amount is read at these digit heights (px); every read must agree. */
const AMOUNT_DIGIT_HEIGHTS = [24, 40, 64] as const;
/** At least one read must have every digit at this confidence (0..100) or more. */
const MIN_DIGIT_CONFIDENCE = 50;
/** Confidence reported for an amount that passed every check. */
const VERIFIED_AMOUNT_CONFIDENCE = 0.97;
/** Below this line confidence (0..1) an OCR operation number is dropped: a wrong one would break
 * duplicate detection (11.4), a missing one only weakens it. */
const MIN_OPERATION_NUMBER_CONFIDENCE = 0.6;

export type OcrMissingField = 'amount' | 'occurred_at';

export interface OcrReading {
  page: OcrPage;
  layout: ScreenshotLayout | null;
  /** From the layout (individual receipt) or keywords; null = undecided. */
  imageClass: ImageClass | null;
  /** Fields read by the layout parser; `amount` is set only when verified. */
  operation: ScreenshotOperation | null;
  /** What the OCR saw as amount, verified or not (to compare with the vision model). */
  amountCandidate: string | null;
  /** Every distinct amount the re-reads produced. */
  amountCandidates: string[];
  amountVerified: boolean;
  /** Why the amount was not verified (code), for stats. */
  amountIssue: string | null;
  missing: OcrMissingField[];
  amountReads: AmountRead[];
  /** Raw re-reads of the amount band (captured as test fixtures). */
  amountLines: OcrLineRead[];
  /** Glyphs segmentation drew for the amount (the reads must have as many characters). */
  amountGlyphCount: number;
  /** A raised «S/» was removed by segmentation. */
  amountSignRemoved: boolean;
  timings: { preprocessMs: number; pageMs: number; amountMs: number };
}

/**
 * Local reading (D33): preprocess → OCR page → layout parser → amount band → glyph segmentation
 * (removes the raised «S/», redraws the digits alone) → three OCR reads at different sizes with a
 * digits whitelist → verify. The amount is verified only if every read agrees and has as many
 * characters as glyphs, the «S/» sign was found, digits are confident enough, and no other printed
 * amount contradicts it. Otherwise the caller falls back to the vision model.
 */
export async function readWithOcr(image: Buffer, engine: OcrEngine): Promise<OcrReading> {
  const t0 = performance.now();
  const prepared = await preprocessForOcr(image);
  const t1 = performance.now();
  const page = await engine.readPage(prepared.png);
  const t2 = performance.now();

  const found = matchLayout(page);
  if (!found) {
    const keywords = classifyByKeywords(page);
    return {
      page,
      layout: null,
      imageClass: keywords?.imageClass ?? null,
      operation: null,
      amountCandidate: null,
      amountCandidates: [],
      amountVerified: false,
      amountIssue: 'no_layout',
      missing: ['amount', 'occurred_at'],
      amountReads: [],
      amountLines: [],
      amountGlyphCount: 0,
      amountSignRemoved: false,
      timings: { preprocessMs: t1 - t0, pageMs: t2 - t1, amountMs: 0 },
    };
  }

  const { parser, match } = found;
  const band = parser.amountBand(page, match);
  const pixels = await bandPixels(prepared, band);
  const segmentation = segmentAmountBand(pixels.data, pixels.width, pixels.height);
  const signRemoved = segmentation.sign.length > 0;
  const amountLines: OcrLineRead[] = [];
  let amountReads: AmountRead[] = [];
  if (segmentation.image && !segmentation.failure) {
    for (const digitHeight of AMOUNT_DIGIT_HEIGHTS) {
      const png = await grayToPng(segmentation.image, digitHeight / segmentation.digitHeight);
      amountLines.push(
        await engine.readLine(png, signRemoved ? DIGITS_WHITELIST : AMOUNT_WHITELIST),
      );
    }
    amountReads = amountLines.map((line) =>
      amountFromLine(line, segmentation.body.length, signRemoved),
    );
  } else {
    const failure: AmountReadFailure = segmentation.failure ?? 'no_glyphs';
    amountReads = [{ amount: null, prefixFound: false, minDigitConfidence: 0, text: '', failure }];
  }
  const t3 = performance.now();

  const crossChecks = parser.crossCheckAmounts?.(page) ?? [];
  const verdict = verifyAmount(amountReads, crossChecks);
  const fields = parser.parse(page, match);
  const opConfidence = fields.confidence.operation_number ?? 0;
  const operation: ScreenshotOperation = {
    ...fields,
    operation_number:
      opConfidence >= MIN_OPERATION_NUMBER_CONFIDENCE ? fields.operation_number : null,
    amount: verdict.verified ? verdict.amount : null,
    scope: 'single',
    suggested_category: null,
    confidence: { ...fields.confidence, amount: verdict.verified ? VERIFIED_AMOUNT_CONFIDENCE : 0 },
  };
  const missing: OcrMissingField[] = [];
  if (!verdict.verified) missing.push('amount');
  if (!operation.occurred_at) missing.push('occurred_at');

  return {
    page,
    layout: parser.layout,
    imageClass: 'individual_receipt',
    operation,
    amountCandidate: verdict.amount,
    amountCandidates: [
      ...new Set(amountReads.map((r) => r.amount).filter((a): a is string => a !== null)),
    ],
    amountVerified: verdict.verified,
    amountIssue: verdict.issue,
    missing,
    amountReads,
    amountLines,
    amountGlyphCount: segmentation.body.length,
    amountSignRemoved: signRemoved,
    timings: { preprocessMs: t1 - t0, pageMs: t2 - t1, amountMs: t3 - t2 },
  };
}

export interface AmountVerdict {
  amount: string | null;
  verified: boolean;
  issue: string | null;
}

/** Pure decision over the re-reads (and amounts printed elsewhere on the screen). */
export function verifyAmount(reads: AmountRead[], crossChecks: string[]): AmountVerdict {
  const values = reads.map((r) => r.amount);
  const readValues = values.filter((v): v is string => v !== null);
  const printed = crossChecks[0];
  if (printed !== undefined && crossChecks.some((c) => c !== printed)) {
    return { amount: readValues[0] ?? null, verified: false, issue: 'cross_check_mismatch' };
  }
  const candidate =
    printed !== undefined && readValues.includes(printed) ? printed : (readValues[0] ?? null);
  if (candidate === null) {
    return { amount: printed ?? null, verified: false, issue: reads[0]?.failure ?? 'no_amount' };
  }
  if (printed !== undefined && printed !== candidate) {
    return { amount: candidate, verified: false, issue: 'cross_check_mismatch' };
  }
  const agree = values.every((v) => v === candidate);
  const crossConfirmed = printed !== undefined;
  if (!agree && !crossConfirmed)
    return { amount: candidate, verified: false, issue: 'reads_disagree' };
  const withValue = reads.filter((r) => r.amount === candidate);
  if (!withValue.some((r) => r.prefixFound)) {
    return { amount: candidate, verified: false, issue: 'no_currency_sign' };
  }
  const bestConfidence = Math.max(0, ...withValue.map((r) => r.minDigitConfidence));
  if (bestConfidence < MIN_DIGIT_CONFIDENCE && !crossConfirmed) {
    return { amount: candidate, verified: false, issue: 'low_confidence' };
  }
  return { amount: candidate, verified: true, issue: null };
}
