/**
 * Generates the hard cases of the screenshot dataset (insumos 2, «Casos difíciles») from the 8
 * originals listed in `datasets/answers.csv`, with sharp. Deterministic: same inputs, same files.
 *
 *   npx tsx src/scripts/eval-generate.ts
 *
 * Writes `datasets/generated/*.{png,jpg}` and `datasets/generated/expected.jsonl`.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import sharp, { type Sharp } from 'sharp';
import { createTesseractEngine, type OcrEngine } from '../ocr/engine.js';
import { matchLayout } from '../ocr/layouts/index.js';
import { OCR_WIDTH, preprocessForOcr } from '../ocr/preprocess.js';
import { REPO_ROOT } from '../paths.js';
import { type AnswerRow, readAnswers } from './eval-lib.js';

const DATASETS = resolve(REPO_ROOT, 'datasets');
const OUT_DIR = join(DATASETS, 'generated');

/** same: must read the same amount · unreadable: must say «ilegible» · same_or_unreadable: either. */
type Expectation = 'same' | 'unreadable' | 'same_or_unreadable';

interface Variant {
  transform: string;
  expect: Expectation;
  /** Answer ids it applies to (all receipts when omitted). */
  only?: string[];
  make(
    input: Buffer,
    ctx: { band: { top: number; bottom: number } | null },
  ): Promise<{
    data: Buffer;
    ext: '.png' | '.jpg';
  } | null>;
}

/** Deterministic noise (LCG), so runs are reproducible. */
function noiseOverlay(width: number, height: number, seed: number): Buffer {
  let state = seed;
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    state = (state * 1_103_515_245 + 12_345) & 0x7fffffff;
    const v = state % 256;
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 28;
  }
  return data;
}

const png = async (s: Sharp) => ({ data: await s.png().toBuffer(), ext: '.png' as const });

const VARIANTS: Variant[] = [
  {
    transform: 'blur',
    expect: 'same_or_unreadable',
    make: (input) => png(sharp(input).blur(2.5)),
  },
  {
    transform: 'heavy_blur',
    expect: 'unreadable',
    only: ['C-002', 'C-004', 'C-005', 'C-007'],
    // Two pipelines: sharp applies a single resize per pipeline.
    make: async (input) =>
      png(
        sharp(await sharp(input).resize({ width: 26 }).png().toBuffer())
          .resize({ width: 800 })
          .blur(3),
      ),
  },
  {
    transform: 'dark_inverted',
    expect: 'same',
    make: (input) => png(sharp(input).negate({ alpha: false })),
  },
  {
    transform: 'jpeg_low_quality',
    expect: 'same_or_unreadable',
    make: async (input) => {
      const meta = await sharp(input).metadata();
      const data = await sharp(input)
        .resize({ width: Math.round(meta.width * 0.55) })
        .jpeg({ quality: 12 })
        .toBuffer();
      return { data, ext: '.jpg' };
    },
  },
  {
    transform: 'photo_of_screen',
    expect: 'same_or_unreadable',
    make: async (input) => {
      const base = await sharp(input)
        .affine(
          [
            [1, 0.04],
            [0.02, 1],
          ],
          { background: '#3a3a3a' },
        )
        .rotate(5, { background: '#3a3a3a' })
        .modulate({ brightness: 0.82, saturation: 0.9 })
        .blur(0.8)
        .png()
        .toBuffer();
      const meta = await sharp(base).metadata();
      const noise = noiseOverlay(meta.width, meta.height, 7);
      const data = await sharp(base)
        .composite([{ input: noise, raw: { width: meta.width, height: meta.height, channels: 4 } }])
        .jpeg({ quality: 70 })
        .toBuffer();
      return { data, ext: '.jpg' };
    },
  },
  {
    transform: 'amount_covered',
    expect: 'unreadable',
    // C-003 also prints «Importe abonado S/ 1,285.00» lower on the screen: not unreadable.
    only: ['C-001', 'C-002', 'C-004', 'C-005', 'C-006', 'C-007', 'C-008'],
    make: async (input, { band }) => {
      if (!band) return null;
      const meta = await sharp(input).metadata();
      const height = Math.max(4, band.bottom - band.top);
      const box = await sharp({
        create: { width: meta.width, height, channels: 3, background: '#d9d9d9' },
      })
        .png()
        .toBuffer();
      return png(sharp(input).composite([{ input: box, top: band.top, left: 0 }]));
    },
  },
  {
    transform: 'cropped_without_amount',
    expect: 'unreadable',
    only: ['C-001', 'C-004', 'C-006', 'C-008'],
    make: async (input, { band }) => {
      if (!band) return null;
      const meta = await sharp(input).metadata();
      const top = Math.min(meta.height - 10, band.bottom);
      return png(
        sharp(input).extract({ left: 0, top, width: meta.width, height: meta.height - top }),
      );
    },
  },
];

const DUPLICATES = ['C-001', 'C-005'];

/** Amount band of an original, in its own pixel coordinates. */
async function amountBand(
  input: Buffer,
  engine: OcrEngine,
): Promise<{ top: number; bottom: number } | null> {
  const prepared = await preprocessForOcr(input);
  const page = await engine.readPage(prepared.png);
  const found = matchLayout(page);
  if (!found) return null;
  const band = found.parser.amountBand(page, found.match);
  const meta = await sharp(input).metadata();
  const scale = meta.width / OCR_WIDTH;
  return { top: Math.round(band.top * scale), bottom: Math.round(band.bottom * scale) };
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const receipts = readAnswers(join(DATASETS, 'answers.csv')).filter(
    (row: AnswerRow) => row.type === 'individual_receipt',
  );
  const engine = await createTesseractEngine();
  const lines: string[] = [];
  try {
    for (const row of receipts) {
      const input = readFileSync(join(DATASETS, row.file));
      const band = await amountBand(input, engine);
      for (const variant of VARIANTS) {
        if (variant.only && !variant.only.includes(row.id)) continue;
        const made = await variant.make(input, { band });
        if (!made) continue;
        const name = `${row.id}-${variant.transform}${made.ext}`;
        writeFileSync(join(OUT_DIR, name), made.data);
        lines.push(
          JSON.stringify({
            id: `G-${row.id.slice(2)}-${variant.transform}`,
            file: `generated/${name}`,
            source_id: row.id,
            transform: variant.transform,
            expect: variant.expect,
          }),
        );
      }
      if (DUPLICATES.includes(row.id)) {
        const name = `${row.id}-duplicate${extname(row.file).toLowerCase()}`;
        copyFileSync(join(DATASETS, row.file), join(OUT_DIR, name));
        lines.push(
          JSON.stringify({
            id: `G-${row.id.slice(2)}-duplicate`,
            file: `generated/${name}`,
            source_id: row.id,
            transform: 'exact_duplicate',
            expect: 'same',
            duplicate_of: row.file,
          }),
        );
      }
    }
  } finally {
    await engine.close();
  }
  writeFileSync(join(OUT_DIR, 'expected.jsonl'), `${lines.join('\n')}\n`);
  console.log(`generated ${lines.length} hard cases in datasets/generated`);
}

await main();
