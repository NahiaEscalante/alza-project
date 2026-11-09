import sharp from 'sharp';
import type { Band } from './types.js';

/** Working width: screenshots arrive at 600–1300 px; text OCRs best at this size. */
export const OCR_WIDTH = 1400;
/** Very tall images (long lists) are capped so OCR time stays bounded. */
const MAX_HEIGHT = 6000;

export interface PreparedImage {
  /** Grayscale PNG, dark text on white everywhere. */
  png: Buffer;
  width: number;
  height: number;
}

/**
 * Prepares a screenshot for tesseract:
 * 1. EXIF rotation, alpha flattened on white, resized to OCR_WIDTH, grayscale.
 * 2. Background estimate: the image shrunk 8× and median-filtered (≈120 px window), so text strokes,
 *    even big amount digits, do not change it.
 * 3. Flat-field: each pixel divided by its background. Where the background is dark (Yape purple,
 *    BBVA green, Bancom navy, dark mode) the pixel is inverted first. Result: dark text on white.
 */
export async function preprocessForOcr(image: Buffer): Promise<PreparedImage> {
  const meta = await sharp(image).rotate().metadata();
  const sourceWidth = meta.autoOrient?.width ?? meta.width ?? OCR_WIDTH;
  const sourceHeight = meta.autoOrient?.height ?? meta.height ?? OCR_WIDTH;
  const scaledHeight = Math.round((sourceHeight * OCR_WIDTH) / sourceWidth);
  const resize = scaledHeight > MAX_HEIGHT ? { height: MAX_HEIGHT } : { width: OCR_WIDTH };

  const gray = await sharp(image)
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize(resize)
    .grayscale()
    .extractChannel(0)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = gray.info;

  const small = await sharp(gray.data, { raw: gray.info })
    .resize({ width: Math.max(16, Math.round(width / 8)) })
    .median(15)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const background = await sharp(small.data, { raw: small.info })
    .resize({ width, height, kernel: 'linear', fit: 'fill' })
    .extractChannel(0)
    .raw()
    .toBuffer();

  const out = Buffer.alloc(gray.data.length);
  for (let i = 0; i < gray.data.length; i++) {
    const pixel = gray.data[i] as number;
    const bg = background[i] as number;
    const dark = bg < 128;
    const value = dark ? 255 - pixel : pixel;
    const base = Math.max(1, dark ? 255 - bg : bg);
    out[i] = Math.min(255, Math.round((value / base) * 255));
  }
  const png = await sharp(out, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();
  return { png, width, height };
}

/**
 * Crops a horizontal band (full width) with white padding, optionally rescaled.
 * Used to re-read the amount line on its own.
 */
export async function cropBand(prepared: PreparedImage, band: Band, scale = 1): Promise<Buffer> {
  const top = Math.max(0, Math.floor(band.top));
  const bottom = Math.min(prepared.height, Math.ceil(band.bottom));
  const height = Math.max(1, bottom - top);
  let pipeline = sharp(prepared.png).extract({ left: 0, top, width: prepared.width, height });
  if (scale !== 1) {
    pipeline = sharp(await pipeline.png().toBuffer()).resize({
      width: Math.max(1, Math.round(prepared.width * scale)),
    });
  }
  return pipeline
    .extend({ top: 24, bottom: 24, left: 24, right: 24, background: '#ffffff' })
    .png()
    .toBuffer();
}

/** Raw grayscale pixels of a horizontal band (full width). */
export async function bandPixels(
  prepared: PreparedImage,
  band: Band,
): Promise<{ data: Buffer; width: number; height: number }> {
  const top = Math.max(0, Math.floor(band.top));
  const bottom = Math.min(prepared.height, Math.ceil(band.bottom));
  const height = Math.max(1, bottom - top);
  const data = await sharp(prepared.png)
    .extract({ left: 0, top, width: prepared.width, height })
    .extractChannel(0)
    .raw()
    .toBuffer();
  return { data, width: prepared.width, height };
}

/** Grayscale pixels → PNG, rescaled by `scale`, with a white margin. */
export async function grayToPng(
  image: { data: Buffer; width: number; height: number },
  scale = 1,
): Promise<Buffer> {
  let pipeline = sharp(image.data, {
    raw: { width: image.width, height: image.height, channels: 1 },
  });
  if (scale !== 1) {
    pipeline = pipeline.resize({ width: Math.max(8, Math.round(image.width * scale)) });
  }
  return pipeline
    .extend({ top: 16, bottom: 16, left: 16, right: 16, background: '#ffffff' })
    .png()
    .toBuffer();
}
