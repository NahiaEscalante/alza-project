import type { Logger } from '../lib/logger.js';
import { OCR_MODEL_ID, type OcrEngine } from '../ocr/engine.js';
import { OCR_PARSERS_VERSION } from '../ocr/layouts/index.js';
import { type OcrReading, readWithOcr } from '../ocr/read.js';
import type { AiLayer } from './layer.js';
import { checkScreenshotExtraction } from './post-checks.js';
import type { MediaInput } from './providers/types.js';
import type { AiFailureKind } from './router.js';
import type { ScreenshotExtraction, ScreenshotLayout, ScreenshotOperation } from './schemas.js';

/** A vision amount alone is accepted only at this confidence (D33: «se lee con seguridad»). */
export const VISION_MIN_AMOUNT_CONFIDENCE = 0.9;
/** A vision amount that equals an OCR candidate (two readers agree) needs this much. */
const VISION_AGREEING_AMOUNT_CONFIDENCE = 0.7;

export type ScreenshotSource = 'ocr' | 'vision' | 'ocr+vision' | 'none';

export interface ScreenshotReading {
  /** Validated and post-checked; `legible: false` → «ilegible» clarification. */
  extraction: ScreenshotExtraction;
  source: ScreenshotSource;
  layout: ScreenshotLayout | null;
  /** Stored with the extraction (8.3). */
  meta: { provider: string; model: string; promptVersion: string };
  /**
   * The vision fallback failed (all routes down or invalid output twice) and the OCR alone could
   * not read the amount: the caller should retry the job (RF-IN-05) rather than ask her.
   */
  aiFailure: AiFailureKind | null;
  /** Codes only (safe to log). */
  issues: string[];
  timings: { ocrMs: number; visionMs: number };
}

export interface ReadScreenshotDeps {
  ocr: OcrEngine;
  ai: Pick<AiLayer, 'extractScreenshot'>;
  now?: () => Date;
  logger?: Logger;
  /**
   * D74: `false` never calls the vision model (public Telegram demo, `AI_VISION_FALLBACK`). What
   * the OCR cannot read is unreadable («ilegible»), never retried. Default true (D33).
   */
  visionFallback?: boolean;
}

const OCR_META = { provider: 'local', model: OCR_MODEL_ID, promptVersion: OCR_PARSERS_VERSION };

/**
 * Reads a screenshot (D33, RF-EX-01/02/06):
 * 1. Local OCR + layout parser. If the layout is known, the amount verified and the date read → done.
 * 2. Otherwise the vision model. Its amount is accepted only if it has confidence ≥ 0.9, or ≥ 0.7
 *    and equals what the OCR saw. If OCR and vision saw different amounts, nobody is believed.
 * 3. Deterministic post-checks. A receipt without a trustworthy amount → `legible: false`.
 * Never invents an amount.
 */
export async function readScreenshot(
  image: MediaInput,
  deps: ReadScreenshotDeps,
): Promise<ScreenshotReading> {
  const now = deps.now?.() ?? new Date();
  const issues: string[] = [];
  const t0 = performance.now();
  let ocr: OcrReading | null = null;
  try {
    ocr = await readWithOcr(image.data, deps.ocr);
  } catch (err) {
    issues.push('ocr_failed');
    deps.logger?.warn({ err }, 'ocr failed');
  }
  const ocrMs = performance.now() - t0;
  const layout = ocr?.layout ?? null;
  const checkOptions = { now, layout };

  if (ocr?.operation && ocr.amountVerified && ocr.missing.length === 0) {
    const checked = checkScreenshotExtraction(
      { content_type: 'individual_receipt', legible: true, operations: [ocr.operation] },
      checkOptions,
    );
    return {
      extraction: checked.extraction,
      source: 'ocr',
      layout,
      meta: OCR_META,
      aiFailure: null,
      issues: [...issues, ...checked.issues],
      timings: { ocrMs, visionMs: 0 },
    };
  }
  if (ocr?.amountIssue) issues.push(`ocr_${ocr.amountIssue}`);

  if (deps.visionFallback === false) {
    issues.push('vision_disabled');
    if (ocr?.operation && ocr.amountVerified) {
      // Only the date (or another optional field) was missing: the OCR read stands.
      const checked = checkScreenshotExtraction(
        { content_type: 'individual_receipt', legible: true, operations: [ocr.operation] },
        checkOptions,
      );
      return {
        extraction: checked.extraction,
        source: 'ocr',
        layout,
        meta: OCR_META,
        aiFailure: null,
        issues: [...issues, ...checked.issues],
        timings: { ocrMs, visionMs: 0 },
      };
    }
    return {
      extraction: {
        content_type: ocr?.imageClass ?? 'individual_receipt',
        legible: false,
        operations: ocr?.operation ? [{ ...ocr.operation, amount: null }] : [],
      },
      source: 'none',
      layout,
      meta: OCR_META,
      aiFailure: null,
      issues,
      timings: { ocrMs, visionMs: 0 },
    };
  }

  const t1 = performance.now();
  const vision = await deps.ai.extractScreenshot(image, now);
  const visionMs = performance.now() - t1;

  if (!vision.ok) {
    issues.push(`vision_${vision.error}`);
    if (ocr?.operation && ocr.amountVerified) {
      // Only the date (or another optional field) was missing: the OCR read stands.
      const checked = checkScreenshotExtraction(
        { content_type: 'individual_receipt', legible: true, operations: [ocr.operation] },
        checkOptions,
      );
      return {
        extraction: checked.extraction,
        source: 'ocr',
        layout,
        meta: OCR_META,
        aiFailure: null,
        issues: [...issues, ...checked.issues],
        timings: { ocrMs, visionMs },
      };
    }
    return {
      extraction: {
        content_type: ocr?.imageClass ?? 'individual_receipt',
        legible: false,
        operations: ocr?.operation ? [{ ...ocr.operation, amount: null }] : [],
      },
      source: 'none',
      layout,
      meta: OCR_META,
      aiFailure: vision.error,
      issues,
      timings: { ocrMs, visionMs },
    };
  }

  const merged = mergeVision(vision.value, ocr, issues);
  const checked = checkScreenshotExtraction(merged.extraction, {
    now,
    layout: merged.usedOcr ? layout : null,
  });
  return {
    extraction: checked.extraction,
    source: merged.usedOcr ? 'ocr+vision' : 'vision',
    layout: merged.usedOcr ? layout : null,
    meta: merged.usedOcr
      ? {
          provider: `local+${vision.meta.provider}`,
          model: `${OCR_MODEL_ID}+${vision.meta.model}`,
          promptVersion: `${OCR_PARSERS_VERSION}+${vision.meta.promptVersion}`,
        }
      : {
          provider: vision.meta.provider,
          model: vision.meta.model,
          promptVersion: vision.meta.promptVersion,
        },
    aiFailure: null,
    issues: [...issues, ...checked.issues],
    timings: { ocrMs, visionMs },
  };
}

/** Decides whether a vision amount can be trusted, given what the OCR saw. */
export function acceptVisionAmount(
  amount: string | null,
  confidence: number | undefined,
  ocrCandidates: string[],
): { accept: boolean; reason: string } {
  if (amount === null) return { accept: false, reason: 'vision_no_amount' };
  const c = confidence ?? 0;
  if (ocrCandidates.length === 0) {
    return c >= VISION_MIN_AMOUNT_CONFIDENCE
      ? { accept: true, reason: 'vision_confident' }
      : { accept: false, reason: 'vision_low_confidence' };
  }
  if (!ocrCandidates.includes(amount)) return { accept: false, reason: 'ocr_vision_conflict' };
  return c >= VISION_AGREEING_AMOUNT_CONFIDENCE
    ? { accept: true, reason: 'ocr_vision_agree' }
    : { accept: false, reason: 'vision_low_confidence' };
}

/** Fills OCR gaps with vision values (OCR wins where it read something). */
function fillGaps(ocrOp: ScreenshotOperation, visionOp: ScreenshotOperation): ScreenshotOperation {
  const pick = <K extends keyof ScreenshotOperation>(key: K): ScreenshotOperation[K] =>
    ocrOp[key] ?? visionOp[key];
  return {
    ...ocrOp,
    counterparty_name: pick('counterparty_name'),
    visible_holder_name: pick('visible_holder_name'),
    occurred_at: pick('occurred_at'),
    operation_number: pick('operation_number'),
    receipt_header_text: pick('receipt_header_text'),
    confidence: {
      ...visionOp.confidence,
      ...Object.fromEntries(
        Object.entries(ocrOp.confidence).filter(([key]) => {
          const value = ocrOp[key as keyof ScreenshotOperation];
          return value !== null && value !== undefined;
        }),
      ),
    },
  };
}

function mergeVision(
  vision: ScreenshotExtraction,
  ocr: OcrReading | null,
  issues: string[],
): { extraction: ScreenshotExtraction; usedOcr: boolean } {
  const candidates =
    ocr?.amountVerified && ocr.amountCandidate
      ? [ocr.amountCandidate]
      : (ocr?.amountCandidates ?? []);
  const gated = vision.operations.map((op) => {
    const verdict = acceptVisionAmount(op.amount, op.confidence.amount, candidates);
    if (op.amount !== null) issues.push(verdict.reason);
    return verdict.accept
      ? op
      : { ...op, amount: null, confidence: { ...op.confidence, amount: 0 } };
  });

  const ocrOp = ocr?.operation;
  if (!ocrOp) {
    return { extraction: { ...vision, operations: gated }, usedOcr: false };
  }

  // The OCR recognized the layout: it is an individual receipt and its header/role stand.
  const visionOp = gated[0];
  let operation: ScreenshotOperation;
  if (ocr.amountVerified) {
    operation = visionOp && visionOp.amount === ocrOp.amount ? fillGaps(ocrOp, visionOp) : ocrOp;
    if (visionOp && visionOp.amount !== ocrOp.amount) issues.push('vision_ignored_amount_differs');
  } else if (visionOp && visionOp.amount !== null) {
    const filled = fillGaps(ocrOp, visionOp);
    operation = {
      ...filled,
      amount: visionOp.amount,
      confidence: { ...filled.confidence, amount: visionOp.confidence.amount ?? 0 },
    };
  } else {
    operation = { ...fillGaps(ocrOp, visionOp ?? ocrOp), amount: null };
  }
  return {
    extraction: { content_type: 'individual_receipt', legible: true, operations: [operation] },
    usedOcr: true,
  };
}
