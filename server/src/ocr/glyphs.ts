/**
 * Glyph segmentation of the amount band, on raw grayscale pixels (dark ink on white), without OCR.
 *
 * Why: tesseract's symbol boxes are unreliable, and Yape/BBVA print «S/» as a small raised sign
 * that it reads as a digit («S/ 7.50» → «17.50»). Here connected components give exact glyph boxes:
 * - the amount row is the tallest glyph's row; residue of neighbour lines is dropped;
 * - leading glyphs whose bottom sits clearly above the baseline are the currency sign → removed;
 * - the rest is redrawn alone on white (no card edges, icons or noise) for a clean OCR pass;
 * - the glyph count is kept to check the OCR text length (merged or dropped characters fail).
 */

export interface Glyph {
  x0: number;
  y0: number;
  /** Exclusive. */
  x1: number;
  y1: number;
  area: number;
  /** Connected-component labels that form this glyph. */
  labels: number[];
}

export interface AmountSegmentation {
  /** Glyphs of the amount, left to right, currency sign excluded (an inline «S/» stays). */
  body: Glyph[];
  /** Raised leading glyphs removed as currency sign. */
  sign: Glyph[];
  digitHeight: number;
  baseline: number;
  failure?: 'no_glyphs' | 'raised_glyphs' | 'irregular_row';
  /** Body glyphs redrawn alone: grayscale, black on white. */
  image?: { data: Buffer; width: number; height: number };
}

const INK_THRESHOLD = 140;
/** «S/» is 1 to 2 glyphs (3 if the slash breaks). */
const MAX_SIGN_GLYPHS = 3;

/** Least-squares line y = intercept + slope·x (flat through the point when there is one). */
export function fitLine(points: readonly (readonly [number, number])[]): {
  slope: number;
  intercept: number;
} {
  if (points.length === 0) return { slope: 0, intercept: 0 };
  const n = points.length;
  const mx = points.reduce((a, [x]) => a + x, 0) / n;
  const my = points.reduce((a, [, y]) => a + y, 0) / n;
  const sxx = points.reduce((a, [x]) => a + (x - mx) ** 2, 0);
  if (n < 2 || sxx === 0) return { slope: 0, intercept: my };
  const sxy = points.reduce((a, [x, y]) => a + (x - mx) * (y - my), 0);
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx };
}

/** 8-connected components of ink pixels. Returns the label map and per-label boxes. */
export function connectedComponents(
  gray: Uint8Array,
  width: number,
  height: number,
): { labels: Int32Array; boxes: Glyph[] } {
  const labels = new Int32Array(width * height);
  const boxes: Glyph[] = [];
  const stack: number[] = [];
  let next = 0;
  for (let start = 0; start < gray.length; start++) {
    if (labels[start] !== 0 || (gray[start] as number) >= INK_THRESHOLD) continue;
    next += 1;
    const box: Glyph = { x0: width, y0: height, x1: 0, y1: 0, area: 0, labels: [next] };
    labels[start] = next;
    stack.push(start);
    while (stack.length > 0) {
      const p = stack.pop() as number;
      const x = p % width;
      const y = (p - x) / width;
      box.area += 1;
      if (x < box.x0) box.x0 = x;
      if (y < box.y0) box.y0 = y;
      if (x + 1 > box.x1) box.x1 = x + 1;
      if (y + 1 > box.y1) box.y1 = y + 1;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width || (dx === 0 && dy === 0)) continue;
          const q = ny * width + nx;
          if (labels[q] === 0 && (gray[q] as number) < INK_THRESHOLD) {
            labels[q] = next;
            stack.push(q);
          }
        }
      }
    }
    boxes.push(box);
  }
  return { labels, boxes };
}

const h = (g: Glyph): number => g.y1 - g.y0;
const w = (g: Glyph): number => g.x1 - g.x0;

/** Joins components that overlap horizontally (accents, broken strokes) into one glyph. */
function mergeColumns(components: Glyph[]): Glyph[] {
  const sorted = [...components].sort((a, b) => a.x0 - b.x0);
  const out: Glyph[] = [];
  for (const c of sorted) {
    const last = out[out.length - 1];
    if (last) {
      const overlap = Math.min(last.x1, c.x1) - Math.max(last.x0, c.x0);
      if (overlap > 0.5 * Math.min(w(last), w(c))) {
        out[out.length - 1] = {
          x0: Math.min(last.x0, c.x0),
          y0: Math.min(last.y0, c.y0),
          x1: Math.max(last.x1, c.x1),
          y1: Math.max(last.y1, c.y1),
          area: last.area + c.area,
          labels: [...last.labels, ...c.labels],
        };
        continue;
      }
    }
    out.push(c);
  }
  return out;
}

export function segmentAmountBand(
  gray: Uint8Array,
  width: number,
  height: number,
): AmountSegmentation {
  const { labels, boxes } = connectedComponents(gray, width, height);
  const minArea = Math.max(12, Math.round(width * height * 0.00002));
  const components = boxes.filter(
    (b) =>
      b.area >= minArea &&
      b.y0 > 0 &&
      b.y1 < height && // touching the band edge: part of a neighbour line or a frame
      h(b) < 0.9 * height &&
      !(h(b) > 4 * w(b) && w(b) <= 6), // card edges, dividers
  );
  const none: AmountSegmentation = { body: [], sign: [], digitHeight: 0, baseline: 0 };
  if (components.length === 0) return { ...none, failure: 'no_glyphs' };

  // Baseline: a line fitted through the bottoms of the tall glyphs, so a slightly rotated photo
  // of a screen does not make its first digits look raised.
  const digitHeight = Math.max(...components.map(h));
  const tall = components.filter((c) => h(c) >= 0.75 * digitHeight);
  const line = fitLine(tall.map((g) => [(g.x0 + g.x1) / 2, g.y1] as const));
  const baselineAt = (g: Glyph): number => line.intercept + line.slope * ((g.x0 + g.x1) / 2);
  if (tall.some((g) => Math.abs(g.y1 - baselineAt(g)) > 0.25 * digitHeight)) {
    return { ...none, failure: 'irregular_row' };
  }
  // Keep the glyphs of the amount row (drops residue of neighbour lines and icons).
  const inRow = components.filter((c) => {
    const base = baselineAt(c);
    return c.y1 <= base + 0.4 * digitHeight && c.y1 >= base - 1.1 * digitHeight;
  });
  const glyphs = mergeColumns(inRow);
  const baseline = Math.round(line.intercept + line.slope * (width / 2));
  const raised = (g: Glyph): boolean => baselineAt(g) - g.y1 > 0.2 * digitHeight;
  // The sign is small: a raised full-height glyph is a digit of a skewed line, never «S/».
  const isSign = (g: Glyph): boolean => raised(g) && h(g) <= 0.8 * digitHeight;

  let start = 0;
  while (start < glyphs.length && start < MAX_SIGN_GLYPHS && isSign(glyphs[start] as Glyph)) {
    start += 1;
  }
  const sign = glyphs.slice(0, start);
  const body = glyphs.slice(start);
  if (body.length === 0) return { ...none, sign, failure: 'no_glyphs' };
  if (body.some(raised)) return { body, sign, digitHeight, baseline, failure: 'raised_glyphs' };

  // Redraw the body alone, with a margin of half a digit.
  const pad = Math.round(digitHeight * 0.5);
  const x0 = Math.max(0, Math.min(...body.map((g) => g.x0)) - pad);
  const x1 = Math.min(width, Math.max(...body.map((g) => g.x1)) + pad);
  const y0 = Math.max(0, Math.min(...body.map((g) => g.y0)) - pad);
  const y1 = Math.min(height, Math.max(...body.map((g) => g.y1)) + pad);
  const keep = new Set(body.flatMap((g) => g.labels));
  const outWidth = x1 - x0;
  const outHeight = y1 - y0;
  const data = Buffer.alloc(outWidth * outHeight, 255);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const label = labels[y * width + x] as number;
      if (label !== 0 && keep.has(label)) {
        data[(y - y0) * outWidth + (x - x0)] = gray[y * width + x] as number;
      }
    }
  }
  return { body, sign, digitHeight, baseline, image: { data, width: outWidth, height: outHeight } };
}
