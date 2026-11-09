/**
 * Summary image of the close (8.6, D26, RF-CI-12): template → SVG (Satori) → PNG (resvg). No AI,
 * no browser, no network: fonts come from disk and text is turned into paths, so the same data
 * gives the same pixels. Target: < 150 KB and < 1 s per image (RNF-12, 8.6).
 *
 * The caller (Fase 5) uploads the PNG to WhatsApp and does not keep it (8.6, privacy). If this
 * throws, the close goes out as text only (RF-CI-10).
 */
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import sharp from 'sharp';
import { COLORS } from './brand.js';
import { FONT_FAMILY, type FontWeight, fontData } from './fonts.js';
import { IMAGE_SCALE, IMAGE_WIDTH, summaryTemplate } from './summary-template.js';
import type { SummaryImageData } from './summary-types.js';

type SatoriNode = Parameters<typeof satori>[0];
type SatoriFonts = Parameters<typeof satori>[1]['fonts'];

export const MAX_IMAGE_BYTES = 150 * 1024;

const WEIGHTS: FontWeight[] = [400, 600, 700, 800];
let fonts: SatoriFonts | null = null;

function satoriFonts(): SatoriFonts {
  fonts ??= WEIGHTS.map((weight) => ({
    name: FONT_FAMILY,
    data: fontData(weight),
    weight,
    style: 'normal' as const,
  }));
  return fonts;
}

function assertCents(data: SummaryImageData): void {
  const values = [...Object.values(data.summary), data.points.balance];
  if (data.week) values.push(data.week.inCents, data.week.outCents, data.week.leftCents);
  for (const value of values) {
    if (value !== undefined && !Number.isSafeInteger(value)) {
      throw new RangeError('Summary image amounts must be integer cents');
    }
  }
}

/** The SVG (text as paths), 360 logical px wide. */
export async function renderSummarySvg(data: SummaryImageData): Promise<string> {
  assertCents(data);
  return satori(summaryTemplate(data) as unknown as SatoriNode, {
    width: IMAGE_WIDTH,
    fonts: satoriFonts(),
  });
}

/**
 * PNG of the summary image, 720 px wide. resvg's PNG is re-encoded with a 256-color palette: the
 * template is flat colors and anti-aliased text, so it looks the same at about a quarter of the
 * size (normal day ≈ 40 KB, Sunday ≈ 60 KB), well under 150 KB.
 */
export async function renderSummaryImage(data: SummaryImageData): Promise<Buffer> {
  const svg = await renderSummarySvg(data);
  const raw = new Resvg(svg, {
    fitTo: { mode: 'zoom', value: IMAGE_SCALE },
    background: COLORS.bg,
    font: { loadSystemFonts: false },
  })
    .render()
    .asPng();
  return sharp(raw)
    .png({ palette: true, colors: 256, dither: 1, compressionLevel: 9, effort: 7 })
    .toBuffer();
}
