import { describe, expect, it } from 'vitest';
import { type AmountRead, amountFromLine } from './amount.js';
import { fitLine, segmentAmountBand } from './glyphs.js';
import { verifyAmount } from './read.js';
import type { OcrLineRead } from './types.js';

function line(text: string, confidence = 95): OcrLineRead {
  return {
    text,
    confidence,
    symbols: [...text].map((c, i) => ({
      text: c,
      confidence,
      bbox: { x0: i * 10, y0: 0, x1: i * 10 + 8, y1: 20 },
    })),
  };
}

describe('amountFromLine', () => {
  it('reads digits after a removed raised sign', () => {
    expect(amountFromLine(line('7.50'), 4, true)).toMatchObject({
      amount: '7.50',
      prefixFound: true,
    });
    expect(amountFromLine(line('1,285.00'), 8, true).amount).toBe('1285.00');
  });

  it('accepts an inline «S/» that segmentation kept', () => {
    expect(amountFromLine(line('S/20.00'), 7, false)).toMatchObject({
      amount: '20.00',
      prefixFound: true,
    });
  });

  it('a lone «/» is a misread digit, never a sign («750.00» → «/50.00»)', () => {
    const read = amountFromLine(line('/50.00'), 6, false);
    expect(read.amount).toBeNull();
    expect(read.failure).toBe('format');
  });

  it('fails when the text has more or fewer characters than glyphs', () => {
    expect(amountFromLine(line('20.0'), 5, true).failure).toBe('glyph_count_mismatch');
    expect(amountFromLine(line('120.00'), 5, true).failure).toBe('glyph_count_mismatch');
  });

  it('rejects ambiguous or malformed amounts', () => {
    expect(amountFromLine(line('1.285'), 5, true).amount).toBeNull();
    expect(amountFromLine(line('12.505'), 6, true).amount).toBeNull();
    expect(amountFromLine(line('S/'), 2, false).failure).toBe('no_digits');
  });
});

const read = (amount: string | null, extra: Partial<AmountRead> = {}): AmountRead => ({
  amount,
  prefixFound: true,
  minDigitConfidence: 90,
  text: amount ?? '',
  ...extra,
});

describe('verifyAmount', () => {
  it('verifies only when every read agrees', () => {
    expect(verifyAmount([read('7.50'), read('7.50'), read('7.50')], [])).toEqual({
      amount: '7.50',
      verified: true,
      issue: null,
    });
    expect(verifyAmount([read('7.50'), read('17.50'), read('7.50')], []).verified).toBe(false);
    expect(verifyAmount([read('7.50'), read(null)], []).issue).toBe('reads_disagree');
  });

  it('requires the currency sign and enough digit confidence', () => {
    expect(verifyAmount([read('20.00', { prefixFound: false })], []).issue).toBe(
      'no_currency_sign',
    );
    expect(verifyAmount([read('20.00', { minDigitConfidence: 30 })], []).issue).toBe(
      'low_confidence',
    );
  });

  it('a printed amount elsewhere confirms or contradicts', () => {
    expect(verifyAmount([read('1285.00'), read(null)], ['1285.00']).verified).toBe(true);
    expect(verifyAmount([read('1285.00')], ['1286.00'])).toMatchObject({
      verified: false,
      issue: 'cross_check_mismatch',
    });
  });

  it('nothing read → not verified', () => {
    expect(verifyAmount([read(null, { failure: 'no_glyphs' })], [])).toEqual({
      amount: null,
      verified: false,
      issue: 'no_glyphs',
    });
  });
});

/** White band with black rectangles as glyphs. */
function band(width: number, height: number, rects: [number, number, number, number][]) {
  const data = new Uint8Array(width * height).fill(255);
  for (const [x0, y0, x1, y1] of rects) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data[y * width + x] = 0;
  }
  return data;
}

describe('segmentAmountBand', () => {
  it('removes a raised small «S/» and keeps the digits', () => {
    // sign: two small raised blobs; digits: three tall blobs on the baseline (y=120)
    const data = band(400, 160, [
      [20, 30, 40, 80],
      [45, 30, 55, 90],
      [80, 20, 110, 120],
      [120, 20, 150, 120],
      [160, 20, 190, 120],
    ]);
    const seg = segmentAmountBand(data, 400, 160);
    expect(seg.failure).toBeUndefined();
    expect(seg.sign).toHaveLength(2);
    expect(seg.body).toHaveLength(3);
    expect(seg.image?.data.length).toBeGreaterThan(0);
  });

  it('keeps an inline sign at the baseline (Bancom, Luqea)', () => {
    const data = band(400, 160, [
      [20, 20, 50, 120],
      [60, 20, 90, 120],
      [100, 20, 130, 120],
    ]);
    const seg = segmentAmountBand(data, 400, 160);
    expect(seg.sign).toHaveLength(0);
    expect(seg.body).toHaveLength(3);
  });

  it('a tilted line (photo of a screen) does not turn its first digit into a sign', () => {
    // digits descend 10 px per glyph: the first one is «higher» but full height
    const data = band(500, 220, [
      [40, 20, 80, 120],
      [100, 30, 140, 130],
      [160, 40, 200, 140],
      [220, 50, 260, 150],
    ]);
    const seg = segmentAmountBand(data, 500, 220);
    expect(seg.failure).toBeUndefined();
    expect(seg.sign).toHaveLength(0);
    expect(seg.body).toHaveLength(4);
  });

  it('drops residue touching the band edges and dividers', () => {
    const data = band(400, 160, [
      [0, 0, 400, 3], // part of the line above
      [390, 10, 393, 150], // card edge
      [80, 20, 110, 120],
      [120, 20, 150, 120],
    ]);
    const seg = segmentAmountBand(data, 400, 160);
    expect(seg.body).toHaveLength(2);
  });

  it('reports an empty band', () => {
    expect(segmentAmountBand(band(100, 50, []), 100, 50).failure).toBe('no_glyphs');
  });

  it('fails on raised glyphs after the digits (superscript cents)', () => {
    const data = band(400, 160, [
      [80, 20, 110, 120],
      [120, 20, 150, 120],
      [160, 20, 175, 60],
      [180, 20, 195, 60],
    ]);
    expect(segmentAmountBand(data, 400, 160).failure).toBe('raised_glyphs');
  });
});

describe('fitLine', () => {
  it('fits a sloped baseline and handles single points', () => {
    expect(
      fitLine([
        [0, 10],
        [10, 20],
      ]),
    ).toEqual({ slope: 1, intercept: 10 });
    expect(fitLine([[5, 7]])).toEqual({ slope: 0, intercept: 7 });
  });
});
