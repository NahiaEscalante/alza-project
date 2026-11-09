/**
 * Writes the 4 summary image variants (and the extreme ones) to a folder, to look at them:
 *
 *   npx tsx src/render/preview.ts <out-dir>
 *
 * With `--report`, also writes a sample PDF and Excel built from fixture data.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  EXTREME_SUMMARY,
  SUMMARY_VARIANTS,
  ZERO_SUMMARY,
} from './__fixtures__/summary-variants.js';
import { renderSummaryImage } from './summary-image.js';

async function main(): Promise<void> {
  const out = resolve(process.argv[2] ?? 'render-preview');
  mkdirSync(out, { recursive: true });
  const all = { ...SUMMARY_VARIANTS, extreme: EXTREME_SUMMARY, zero: ZERO_SUMMARY };
  for (const [name, data] of Object.entries(all)) {
    const started = performance.now();
    const png = await renderSummaryImage(data);
    const ms = Math.round(performance.now() - started);
    writeFileSync(resolve(out, `summary-${name}.png`), png);
    console.log(`summary-${name}.png  ${(png.length / 1024).toFixed(1)} KB  ${ms} ms`);
  }
  if (process.argv.includes('--report')) {
    const { sampleReportData } = await import('./__fixtures__/report-sample.js');
    const { renderReportPdf } = await import('./report-pdf.js');
    const { renderReportXlsx } = await import('./report-xlsx.js');
    const data = sampleReportData();
    writeFileSync(resolve(out, 'report.pdf'), await renderReportPdf(data));
    writeFileSync(resolve(out, 'report.xlsx'), await renderReportXlsx(data));
    console.log('report.pdf, report.xlsx');
  }
}

await main();
