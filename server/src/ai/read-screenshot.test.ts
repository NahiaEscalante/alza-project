import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { OcrEngine } from '../ocr/engine.js';
import type { OcrLineRead, OcrPage } from '../ocr/types.js';
import { REPO_ROOT } from '../paths.js';
import type { AiLayer } from './layer.js';
import { acceptVisionAmount, readScreenshot } from './read-screenshot.js';
import type { AiResult } from './router.js';
import { type ScreenshotExtraction, screenshotExtractionSchema } from './schemas.js';

interface Fixture {
  page: OcrPage;
  amountLines: OcrLineRead[];
}

const fixtures = JSON.parse(
  readFileSync(new URL('../ocr/__fixtures__/screenshots.json', import.meta.url), 'utf8'),
) as Record<string, Fixture>;
const yapeSent = fixtures['C-002'] as Fixture;
const image = {
  data: readFileSync(
    join(REPO_ROOT, 'datasets/yape-imgs/WhatsApp Image 2026-11-08 at 12.40.24 PM.jpeg'),
  ),
  mimeType: 'image/jpeg',
};
const NOW = new Date('2026-11-08T15:00:00-05:00');

/** OCR engine that replays captured output (real preprocessing and segmentation still run). */
function fakeOcr(page: OcrPage, lines: OcrLineRead[]): OcrEngine {
  let i = 0;
  return {
    readPage: async () => page,
    readLine: async () => lines[i++ % lines.length] as OcrLineRead,
    close: async () => undefined,
  };
}

function fakeVision(result: AiResult<ScreenshotExtraction> | null) {
  const calls: number[] = [];
  const ai: Pick<AiLayer, 'extractScreenshot'> = {
    async extractScreenshot() {
      calls.push(1);
      if (!result) throw new Error('vision must not be called');
      return result;
    },
  };
  return { ai, calls };
}

const visionMeta = {
  provider: 'gemini' as const,
  model: 'gemini-x',
  promptVersion: 'extract_screenshot/test',
  routeId: 'gemini#1:gemini-x',
  latencyMs: 1,
  attempts: 1,
};

function visionSays(amount: string | null, confidence: number): AiResult<ScreenshotExtraction> {
  return {
    ok: true,
    meta: visionMeta,
    value: screenshotExtractionSchema.parse({
      content_type: 'individual_receipt',
      legible: amount !== null,
      operations: [
        {
          amount,
          payment_method: 'yape',
          receipt_header: 'yape_sent',
          holder_role: 'payer',
          occurred_at: '2026-11-05T18:34:00-05:00',
          confidence: { amount: confidence },
        },
      ],
    }),
  };
}

const unknownPage: OcrPage = {
  width: 1400,
  height: 2000,
  confidence: 40,
  lines: [
    { text: 'asdf qwer', confidence: 40, bbox: { x0: 0, y0: 0, x1: 300, y1: 40 }, words: [] },
  ],
};

describe('readScreenshot (D33)', () => {
  it('OCR reads a known layout completely → no vision call', async () => {
    const vision = fakeVision(null);
    const reading = await readScreenshot(image, {
      ocr: fakeOcr(yapeSent.page, yapeSent.amountLines),
      ai: vision.ai,
      now: () => NOW,
    });
    expect(vision.calls).toHaveLength(0);
    expect(reading.source).toBe('ocr');
    expect(reading.meta.provider).toBe('local');
    expect(reading.extraction.legible).toBe(true);
    expect(reading.extraction.operations[0]).toMatchObject({
      amount: '7.50',
      receipt_header: 'yape_sent',
      holder_role: 'payer',
      operation_number: '26290836',
    });
  });

  it('unknown layout → vision amount accepted only at ≥ 0.9', async () => {
    const confident = await readScreenshot(image, {
      ocr: fakeOcr(unknownPage, []),
      ai: fakeVision(visionSays('7.50', 0.95)).ai,
      now: () => NOW,
    });
    expect(confident.source).toBe('vision');
    expect(confident.extraction.operations[0]?.amount).toBe('7.50');
    expect(confident.meta).toEqual({
      provider: 'gemini',
      model: 'gemini-x',
      promptVersion: 'extract_screenshot/test',
    });

    const unsure = await readScreenshot(image, {
      ocr: fakeOcr(unknownPage, []),
      ai: fakeVision(visionSays('7.50', 0.6)).ai,
      now: () => NOW,
    });
    expect(unsure.extraction.legible).toBe(false);
    expect(unsure.extraction.operations[0]?.amount).toBeNull();
  });

  it('OCR and vision disagree → nobody is believed (never invent)', async () => {
    const disagreeing: OcrLineRead[] = [
      { text: '7.50', confidence: 90, symbols: [] },
      { text: '1.50', confidence: 90, symbols: [] },
    ];
    const reading = await readScreenshot(image, {
      ocr: fakeOcr(yapeSent.page, disagreeing),
      ai: fakeVision(visionSays('9.50', 0.99)).ai,
      now: () => NOW,
    });
    expect(reading.extraction.legible).toBe(false);
    expect(reading.issues).toContain('ocr_vision_conflict');
    // Layout fields still come from the OCR.
    expect(reading.extraction.operations[0]?.receipt_header).toBe('yape_sent');
  });

  it('vision agreeing with an OCR candidate is enough at ≥ 0.7', async () => {
    const disagreeing: OcrLineRead[] = [
      { text: '7.50', confidence: 90, symbols: [] },
      { text: '1.50', confidence: 90, symbols: [] },
    ];
    const reading = await readScreenshot(image, {
      ocr: fakeOcr(yapeSent.page, disagreeing),
      ai: fakeVision(visionSays('7.50', 0.8)).ai,
      now: () => NOW,
    });
    expect(reading.source).toBe('ocr+vision');
    expect(reading.extraction.operations[0]?.amount).toBe('7.50');
  });

  it('vision unavailable and OCR without amount → aiFailure (retry the job, not a clarification)', async () => {
    const reading = await readScreenshot(image, {
      ocr: fakeOcr(unknownPage, []),
      ai: fakeVision({ ok: false, error: 'unavailable', attempts: 4 }).ai,
      now: () => NOW,
    });
    expect(reading.aiFailure).toBe('unavailable');
    expect(reading.extraction.legible).toBe(false);
    expect(reading.source).toBe('none');
  });
});

describe('acceptVisionAmount', () => {
  it('applies the thresholds', () => {
    expect(acceptVisionAmount('2.00', 0.95, []).accept).toBe(true);
    expect(acceptVisionAmount('2.00', 0.89, []).accept).toBe(false);
    expect(acceptVisionAmount('2.00', 0.75, ['2.00', '9.00']).accept).toBe(true);
    expect(acceptVisionAmount('2.00', 0.99, ['9.00'])).toEqual({
      accept: false,
      reason: 'ocr_vision_conflict',
    });
    expect(acceptVisionAmount(null, 1, [])).toEqual({ accept: false, reason: 'vision_no_amount' });
  });
});
