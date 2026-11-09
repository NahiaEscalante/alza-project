/**
 * Captures OCR output of the 8 dataset screenshots as test fixtures, so parser tests run without
 * tesseract: `src/ocr/__fixtures__/screenshots.json`. Re-run after changing preprocessing or the
 * OCR engine settings.
 *
 *   npx tsx src/scripts/eval-capture-fixtures.ts
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createTesseractEngine } from '../ocr/engine.js';
import { readWithOcr } from '../ocr/read.js';
import { REPO_ROOT, SERVER_ROOT } from '../paths.js';
import { readAnswers } from './eval-lib.js';

const DATASETS = resolve(REPO_ROOT, 'datasets');
const OUT = join(SERVER_ROOT, 'src', 'ocr', '__fixtures__');

async function main(): Promise<void> {
  const receipts = readAnswers(join(DATASETS, 'answers.csv')).filter(
    (r) => r.type === 'individual_receipt',
  );
  const engine = await createTesseractEngine();
  const fixtures: Record<string, unknown> = {};
  try {
    for (const row of receipts) {
      const reading = await readWithOcr(readFileSync(join(DATASETS, row.file)), engine);
      fixtures[row.id] = {
        file: row.file,
        page: reading.page,
        amountLines: reading.amountLines,
        amountGlyphCount: reading.amountGlyphCount,
        signRemoved: reading.amountSignRemoved,
      };
    }
  } finally {
    await engine.close();
  }
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, 'screenshots.json');
  writeFileSync(file, `${JSON.stringify(fixtures)}\n`);
  execFileSync('npx', ['biome', 'format', '--write', file], { cwd: REPO_ROOT, stdio: 'ignore' });
  console.log(`captured ${Object.keys(fixtures).length} fixtures`);
}

await main();
