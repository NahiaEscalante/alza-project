import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { formatSoles, MAX_AMOUNT_CENTS } from '../domain/index.js';
import {
  EXTREME_SUMMARY,
  SUMMARY_VARIANTS,
  type SummaryVariant,
  ZERO_SUMMARY,
} from './__fixtures__/summary-variants.js';
import { collectText } from './element.js';
import { estimateTextWidth, fitFontSize } from './fonts.js';
import { MAX_IMAGE_BYTES, renderSummaryImage, renderSummarySvg } from './summary-image.js';
import {
  comparisonText,
  IMAGE_SCALE,
  IMAGE_WIDTH,
  milestoneFill,
  nextRewardText,
  summaryTemplate,
} from './summary-template.js';
import type { SummaryImageData } from './summary-types.js';

/**
 * Visual comparison (8.6 «Pruebas»): each variant against its committed reference PNG. To accept
 * a new design: `UPDATE_RENDER_FIXTURES=1 npx vitest run src/render/summary-image.test.ts`.
 */
const FIXTURES = resolve(import.meta.dirname, '__fixtures__');
const UPDATE = process.env.UPDATE_RENDER_FIXTURES === '1';
/**
 * Pixels allowed to differ by more than `CHANNEL_TOLERANCE` in a channel: 0.01 % (about 90 px).
 * Rendering is deterministic on one machine (0 px); the margin absorbs anti-aliasing and palette
 * noise across platforms, while a single changed digit (about 225 px) still fails.
 */
const MAX_DIFF_RATIO = 0.0001;
const CHANNEL_TOLERANCE = 48;

async function rgba(png: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

async function diffRatio(actual: Buffer, expected: Buffer): Promise<number> {
  const a = await rgba(actual);
  const b = await rgba(expected);
  if (a.width !== b.width || a.height !== b.height) return 1;
  let different = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    for (let c = 0; c < 4; c++) {
      if (Math.abs((a.data[i + c] as number) - (b.data[i + c] as number)) > CHANNEL_TOLERANCE) {
        different++;
        break;
      }
    }
  }
  return different / (a.width * a.height);
}

const allTexts = (data: SummaryImageData) => collectText(summaryTemplate(data)).join('\n');

describe('summary image (8.6)', () => {
  beforeAll(async () => {
    // Fonts and the layout engine load once per process.
    await renderSummaryImage(SUMMARY_VARIANTS.normal);
  });

  for (const variant of Object.keys(SUMMARY_VARIANTS) as SummaryVariant[]) {
    it(`${variant}: matches its reference and weighs < 150 KB`, async () => {
      const png = await renderSummaryImage(SUMMARY_VARIANTS[variant]);
      expect(png.length).toBeLessThan(MAX_IMAGE_BYTES);
      const meta = await sharp(png).metadata();
      expect(meta.format).toBe('png');
      expect(meta.width).toBe(IMAGE_WIDTH * IMAGE_SCALE);
      expect(meta.height).toBeGreaterThan(meta.width ?? 0);

      const reference = resolve(FIXTURES, `summary-${variant}.png`);
      if (UPDATE || !existsSync(reference)) {
        if (!UPDATE)
          throw new Error(`Missing reference ${reference}: run with UPDATE_RENDER_FIXTURES=1`);
        mkdirSync(FIXTURES, { recursive: true });
        writeFileSync(reference, png);
      }
      expect(await diffRatio(png, readFileSync(reference))).toBeLessThanOrEqual(MAX_DIFF_RATIO);
    });
  }

  it('renders in < 1 s (8.6)', async () => {
    // Best of 3: the suite runs other files in parallel (OCR), which slows any single run.
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 3; i++) {
      const started = performance.now();
      await renderSummaryImage(SUMMARY_VARIANTS.sunday);
      best = Math.min(best, performance.now() - started);
    }
    expect(best).toBeLessThan(1000);
  });

  it('the comparison catches a single changed digit', async () => {
    const data = SUMMARY_VARIANTS.normal;
    const changed = await renderSummaryImage({
      ...data,
      summary: { ...data.summary, cashSalesCents: 11_500 },
    });
    const reference = readFileSync(resolve(FIXTURES, 'summary-normal.png'));
    expect(await diffRatio(changed, reference)).toBeGreaterThan(MAX_DIFF_RATIO);
  });

  it('is deterministic', async () => {
    const a = await renderSummaryImage(SUMMARY_VARIANTS.sunday);
    const b = await renderSummaryImage(SUMMARY_VARIANTS.sunday);
    expect(a.equals(b)).toBe(true);
  });

  it('fits S/ 99 999,99 in every slot, a negative «te quedó» and a long name', async () => {
    const png = await renderSummaryImage(EXTREME_SUMMARY);
    expect(png.length).toBeLessThan(MAX_IMAGE_BYTES);
    const texts = collectText(summaryTemplate(EXTREME_SUMMARY));
    // entró, 3 splits, salió, 4 splits, week entró and salió.
    expect(texts.filter((value) => value === 'S/ 99 999,99')).toHaveLength(11);
    expect(texts.filter((value) => value === '-S/ 99 999,99')).toHaveLength(2);
    expect(texts).toContain('S/ 99 999,99 por confirmar');
    const name = texts.find((value) => value.startsWith('Bodega y Multiservicios'));
    expect(name?.endsWith('…')).toBe(true);
  });

  it('renders a day with everything at zero', async () => {
    const png = await renderSummaryImage(ZERO_SUMMARY);
    expect(png.length).toBeLessThan(MAX_IMAGE_BYTES);
    expect(allTexts(ZERO_SUMMARY)).toContain('S/ 12 por confirmar');
  });

  it('chooses a font size that fits every amount from S/ 0 to S/ 99 999,99', () => {
    const slots = [
      { width: 176, weight: 800, max: 22 },
      { width: 184, weight: 800, max: 32 },
      { width: 146, weight: 600, max: 15 },
      { width: 176, weight: 700, max: 15 },
    ] as const;
    const amounts = [0, 1, 99, 100, 123_450, 9_999_900, MAX_AMOUNT_CENTS, -MAX_AMOUNT_CENTS];
    for (const slot of slots) {
      for (const cents of amounts) {
        const value = formatSoles(cents);
        const size = fitFontSize(value, slot.width, slot.weight, slot.max);
        expect(size).toBeGreaterThanOrEqual(10);
        expect(estimateTextWidth(value, size, slot.weight)).toBeLessThanOrEqual(slot.width);
      }
    }
  });

  it('never shows «ganancia», emojis, doubts or client names', async () => {
    const svg = await renderSummarySvg(SUMMARY_VARIANTS.pending);
    expect(svg).not.toMatch(/<text/); // text is drawn as paths: no fonts needed to show it
    for (const data of [...Object.values(SUMMARY_VARIANTS), EXTREME_SUMMARY, ZERO_SUMMARY]) {
      const texts = allTexts(data);
      expect(texts.toLowerCase()).not.toContain('ganancia');
      expect(texts.toLowerCase()).not.toContain('utilidad');
      expect(texts).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(texts).not.toContain('¿');
    }
  });

  it('shows the content of each variant', () => {
    const normal = allTexts(SUMMARY_VARIANTS.normal);
    expect(normal).toContain('Martes 10 de noviembre');
    expect(normal).toContain('Bodega Sol');
    expect(normal).toMatch(
      /Entró[\s\S]*Yape y Plin[\s\S]*Efectivo[\s\S]*Salió[\s\S]*Mercadería[\s\S]*Gastos[\s\S]*Casa[\s\S]*Te quedó/,
    );
    expect(normal).toContain('S/ 232');
    expect(normal).not.toContain('por confirmar');
    expect(normal).not.toContain('Tu semana');
    expect(normal).not.toContain('Por clasificar');
    expect(normal).toContain('Te faltan 15 para Útiles escolares');

    const sunday = allTexts(SUMMARY_VARIANTS.sunday);
    expect(sunday).toContain('Tu semana');
    expect(sunday).toContain('Semana del 9 al 15 nov');
    expect(sunday).toContain('5 completos');
    expect(sunday).toContain('Racha de 12 días');
    expect(sunday).toContain('Te quedó S/ 183 más que la semana pasada');

    const noCash = collectText(summaryTemplate(SUMMARY_VARIANTS['no-cash']));
    expect(noCash[noCash.indexOf('Efectivo') + 1]).toBe('S/ 0');

    const pending = allTexts(SUMMARY_VARIANTS.pending);
    expect(pending).toContain('S/ 45 por confirmar');
    expect(pending).toContain('Por clasificar');
  });

  it('points: milestones at even steps and «Te faltan X para…»', () => {
    expect(milestoneFill(0)).toBe(0);
    expect(milestoneFill(50)).toBe(25);
    expect(milestoneFill(75)).toBe(37.5);
    expect(milestoneFill(300)).toBe(87.5);
    expect(milestoneFill(400)).toBe(100);
    expect(milestoneFill(2_000)).toBe(100);
    expect(nextRewardText({ name: 'Electrodoméstico', missingPoints: 1 })).toBe(
      'Te falta 1 para Electrodoméstico',
    );
    expect(nextRewardText({ name: 'Electrodoméstico', missingPoints: 2_100 })).toBe(
      'Te faltan 2 100 para Electrodoméstico',
    );
    expect(nextRewardText(null)).toBeNull();
  });

  it('week comparison follows PR02', () => {
    expect(
      comparisonText({
        comparable: false,
        text: 'Esta semana no comparo porque faltaron cierres completos',
      }),
    ).toBe('Esta semana no comparo porque faltaron cierres completos');
    expect(
      comparisonText({
        comparable: true,
        inDeltaCents: 0,
        outDeltaCents: 0,
        leftDeltaCents: -4_550,
      }),
    ).toBe('Te quedó S/ 45,50 menos que la semana pasada');
  });

  it('rejects amounts that are not integer cents', async () => {
    const bad = {
      ...SUMMARY_VARIANTS.normal,
      summary: { ...SUMMARY_VARIANTS.normal.summary, inCents: 412.5 },
    };
    await expect(renderSummaryImage(bad)).rejects.toThrow(RangeError);
  });
});
