import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../paths.js';
import { createTesseractEngine, type OcrEngine } from './engine.js';
import { readWithOcr } from './read.js';

/**
 * Real local OCR (tesseract.js + bundled Spanish model, no network) on the 8 dataset screenshots:
 * every amount is read and verified without the vision model.
 */
const CASES: [string, string, string][] = [
  ['yape-imgs/WhatsApp Image 2026-11-08 at 12.39.44 PM.jpeg', 'yape', '2.00'],
  ['yape-imgs/WhatsApp Image 2026-11-08 at 12.40.24 PM.jpeg', 'yape', '7.50'],
  ['plin-imgs/PHOTO-2024-01-27-17-02-37.jpg', 'bbva', '1285.00'],
  ['plin-imgs/PHOTO-2025-08-01-19-55-35.jpg', 'bbva', '750.00'],
  ['plin-imgs/PHOTO-2025-11-28-11-41-17.jpg', 'bbva', '20.00'],
  ['bancon-imgs/PHOTO-2025-11-28-10-32-15.jpg', 'bancom', '20.00'],
  ['bancon-imgs/PHOTO-2026-05-30-11-15-38.jpg', 'bancom', '30.00'],
  ['luqea-imgs/PHOTO-2025-09-15-07-33-46.jpg', 'luqea', '20.00'],
];

describe('readWithOcr on the dataset screenshots', () => {
  let engine: OcrEngine;
  beforeAll(async () => {
    engine = await createTesseractEngine();
  }, 60_000);
  afterAll(async () => {
    await engine?.close();
  });

  it.each(CASES)('%s → %s %s', { timeout: 30_000 }, async (file, layout, amount) => {
    const reading = await readWithOcr(readFileSync(join(REPO_ROOT, 'datasets', file)), engine);
    expect(reading.layout).toBe(layout);
    expect(reading.amountVerified).toBe(true);
    expect(reading.operation?.amount).toBe(amount);
    expect(reading.operation?.occurred_at).not.toBeNull();
  });
});
