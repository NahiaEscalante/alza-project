import { resolve } from 'node:path';
import sharp from 'sharp';
import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import { SERVER_ROOT } from '../paths.js';
import type { BBox, OcrLine, OcrLineRead, OcrPage, OcrSymbol, OcrWord } from './types.js';

/** `spa.traineddata` from tesseract-ocr/tessdata_fast, shipped with the server (no downloads). */
export const TESSDATA_DIR = resolve(SERVER_ROOT, 'assets', 'tessdata');
export const OCR_MODEL_ID = 'tesseract.js@7/spa-tessdata_fast';

export interface OcrEngine {
  /** Full page, automatic segmentation. */
  readPage(png: Buffer): Promise<OcrPage>;
  /** One text line with symbol boxes, optionally restricted to `whitelist` characters. */
  readLine(png: Buffer, whitelist?: string): Promise<OcrLineRead>;
  close(): Promise<void>;
}

interface TessSymbol {
  text: string;
  confidence: number;
  bbox: BBox;
}
interface TessWord {
  text: string;
  confidence: number;
  bbox: BBox;
  symbols?: TessSymbol[];
}
interface TessLine {
  text: string;
  confidence: number;
  bbox: BBox;
  words: TessWord[];
}
interface TessBlock {
  paragraphs: { lines: TessLine[] }[];
}

const box = (b: BBox): BBox => ({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 });
const round = (n: number): number => Math.round(n * 10) / 10;

function linesOf(blocks: TessBlock[] | null | undefined): TessLine[] {
  return (blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
}

/**
 * tesseract.js worker with the local Spanish model. One worker, calls serialized (parameters
 * change between page and line reads). Create once per process and `close()` on shutdown.
 */
export async function createTesseractEngine(
  options: { langPath?: string } = {},
): Promise<OcrEngine> {
  const worker: Worker = await createWorker('spa', OEM.LSTM_ONLY, {
    langPath: options.langPath ?? TESSDATA_DIR,
    cacheMethod: 'none',
    gzip: false,
  });
  // Fixed DPI (screenshots carry none) and tesseract's debug chatter out of the server logs.
  await worker.setParameters({ user_defined_dpi: '300', debug_file: '/dev/null' });

  let queue: Promise<unknown> = Promise.resolve();
  function serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  }

  return {
    readPage(png: Buffer): Promise<OcrPage> {
      return serialize(async () => {
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.AUTO,
          tessedit_char_whitelist: '',
        });
        const { data } = await worker.recognize(png, {}, { text: true, blocks: true });
        const lines: OcrLine[] = linesOf(data.blocks as unknown as TessBlock[])
          .map((l) => ({
            text: l.text.trim(),
            confidence: round(l.confidence),
            bbox: box(l.bbox),
            words: l.words.map(
              (w): OcrWord => ({
                text: w.text,
                confidence: round(w.confidence),
                bbox: box(w.bbox),
              }),
            ),
          }))
          .filter((l) => l.text !== '')
          .sort((a, b) => a.bbox.y0 - b.bbox.y0);
        const meta = await imageSize(png);
        return { ...meta, confidence: round(data.confidence), lines };
      });
    },

    readLine(png: Buffer, whitelist = ''): Promise<OcrLineRead> {
      return serialize(async () => {
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.SINGLE_LINE,
          tessedit_char_whitelist: whitelist,
        });
        const { data } = await worker.recognize(png, {}, { text: true, blocks: true });
        const symbols: OcrSymbol[] = linesOf(data.blocks as unknown as TessBlock[]).flatMap((l) =>
          l.words.flatMap((w) =>
            (w.symbols ?? []).map((s) => ({
              text: s.text,
              confidence: round(s.confidence),
              bbox: box(s.bbox),
            })),
          ),
        );
        return { text: data.text.trim(), confidence: round(data.confidence), symbols };
      });
    },

    async close(): Promise<void> {
      await queue;
      await worker.terminate();
    },
  };
}

async function imageSize(png: Buffer): Promise<{ width: number; height: number }> {
  const meta = await sharp(png).metadata();
  return { width: meta.width, height: meta.height };
}
