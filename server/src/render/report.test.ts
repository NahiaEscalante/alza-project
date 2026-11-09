import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { computeIndicators, limaInstant } from '../domain/index.js';
import {
  SAMPLE_CLIENTS,
  SAMPLE_NOW,
  sampleReportData,
  sampleReportRows,
} from './__fixtures__/report-sample.js';
import { initials } from './format.js';
import { buildReportData, entryRef, rangeText, reportRange } from './report-model.js';
import { renderReportPdf, renderReportPdfWithText } from './report-pdf.js';
import { isReportPeriod } from './report-texts.js';
import { renderReportXlsx, SHEET_NAMES } from './report-xlsx.js';

const FORBIDDEN = /ganancia|utilidad|calificas|mibanco|recomend/i;

function pageCount(pdf: Buffer): number {
  return pdf.toString('latin1').match(/\/Type \/Page[^s]/g)?.length ?? 0;
}

async function readWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  return workbook;
}

function cellTexts(workbook: ExcelJS.Workbook): string[] {
  const texts: string[] = [];
  for (const sheet of workbook.worksheets) {
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        texts.push(String(cell.value));
      });
    });
  }
  return texts;
}

describe('initials (PR04, RF-RP-04)', () => {
  it('keeps only up to two initials', () => {
    expect(initials('Rosa María Quispe')).toBe('R. M.');
    expect(initials('Rosa Mendoza')).toBe('R. M.');
    expect(initials('Lucía de la Cruz')).toBe('L. C.');
    expect(initials('ángel  ñañez')).toBe('Á. Ñ.');
    expect(initials('Fernando Sar*')).toBe('F. S.');
    expect(initials('Marta Q.')).toBe('M. Q.');
    expect(initials('Pedro')).toBe('P.');
    expect(initials('*** 123')).toBeNull();
    expect(initials('')).toBeNull();
    expect(initials(null)).toBeNull();
  });
});

describe('report periods', () => {
  it('4 and 12 weeks are whole weeks up to today; «todo» starts at the first record', () => {
    const now = limaInstant('2026-11-12', 15); // Thursday
    expect(reportRange('4_weeks', now, null)).toEqual({ from: '2026-10-19', to: '2026-11-12' });
    expect(reportRange('12_weeks', now, null)).toEqual({ from: '2026-08-24', to: '2026-11-12' });
    expect(reportRange('all', now, '2026-03-02')).toEqual({ from: '2026-03-02', to: '2026-11-12' });
    expect(reportRange('all', now, null)).toEqual({ from: '2026-11-12', to: '2026-11-12' });
    // Before 4:00 it is still the previous business day (D12).
    expect(reportRange('4_weeks', limaInstant('2026-11-16', 3), null).to).toBe('2026-11-15');
    expect(isReportPeriod('12_weeks')).toBe(true);
    expect(isReportPeriod('3_weeks')).toBe(false);
  });

  it('describes the range', () => {
    expect(rangeText('2026-10-19', '2026-11-15')).toBe('del 19 oct al 15 nov de 2026');
    expect(rangeText('2026-11-02', '2026-11-15')).toBe('del 2 al 15 nov de 2026');
    expect(rangeText('2025-12-29', '2026-01-04')).toBe('del 29 dic de 2025 al 4 ene de 2026');
    expect(rangeText('2026-11-15', '2026-11-15')).toBe('el 15 nov de 2026');
  });
});

describe('report data (5.10)', () => {
  const rows = sampleReportRows();
  const data = buildReportData(rows);

  it('totals follow 11.6: confirmed only, never personal or internal', () => {
    const live = rows.entries.filter((e) => e.status === 'confirmed' || e.status === 'pending');
    expect(data.totals).toEqual(computeIndicators(live));
    expect(data.totals.pendingCents).toBe(4_500);
    expect(data.excludedCents).toBe(5_000);
    expect(data.entries.every((e) => e.status === 'confirmed' || e.status === 'pending')).toBe(
      true,
    );
    const days = data.days.reduce((sum, day) => sum + day.inCents, 0);
    expect(days).toBe(data.totals.inCents);
  });

  it('tags what has a screenshot, what she told and the cash not reviewed (RF-RP-02)', () => {
    const labels = new Set(data.entries.map((e) => e.labelText));
    expect(labels).toEqual(
      new Set(['Con captura', 'Lo contaste tú', 'Lo contaste tú (sin detalle)']),
    );
    expect(data.entries.find((e) => e.status === 'pending')?.tags).toContain('Por confirmar');
    expect(data.entries.find((e) => e.afterClose)?.tags).toContain('Agregado después del cierre');
    expect(data.days.some((day) => day.tags.includes('Caja sin revisar'))).toBe(true);
    expect(data.counts.cashUnreviewed).toBe(data.days.filter((d) => d.cashUnreviewed).length);
  });

  it('never carries a full client name (RF-RP-04)', () => {
    const json = JSON.stringify(data);
    for (const name of SAMPLE_CLIENTS) {
      expect(json).not.toContain(name);
      for (const word of name.split(' ').filter((w) => w.length > 3)) {
        expect(json).not.toContain(word);
      }
    }
    expect(data.entries.some((e) => e.counterpartyInitials === 'R. M.')).toBe(true);
  });

  it('lists every change with its origin (RF-RP-03, HU-11)', () => {
    const kinds = data.changes.map((c) => c.kindText);
    expect(kinds).toEqual(
      expect.arrayContaining([
        'Corrección',
        'Quitado',
        'Agregado después del cierre',
        'Diferencia sin detalle',
        'Agregado en un día pasado',
      ]),
    );
    const correction = data.changes.find((c) => c.kind === 'correction');
    expect(correction).toMatchObject({
      before: 'S/ 12 · Venta',
      after: 'S/ 120 · Venta',
      actorText: 'Tú, en la web',
      reasonText: 'Lo corregiste en la web',
    });

    // Both versions stay in the annex, linked.
    const old = data.trace.find((t) => t.ref === correction?.ref);
    expect(old?.statusText).toBe('Reemplazado');
    const fresh = data.trace.find((t) => t.ref === old?.replacedByRef);
    expect(fresh).toMatchObject({ replacesRef: old?.ref, labelText: 'Lo contaste tú' });
    expect(old?.history).toMatch(/Anotado \(ALZA\) · .* Reemplazado \(Tú, en la web\)/);

    const statuses = new Set(data.trace.map((t) => t.status));
    expect(statuses).toEqual(
      new Set(['confirmed', 'pending', 'superseded', 'voided', 'duplicate']),
    );
    expect(data.trace).toHaveLength(rows.entries.length);
  });

  it('origin of the figures adds up to the totals', () => {
    const [entered, left] = data.origins;
    expect(entered?.totalCents).toBe(data.totals.inCents);
    expect(left?.totalCents).toBe(data.totals.outCents);
    expect(
      (entered?.screenshotCents ?? 0) +
        (entered?.selfReportedCents ?? 0) +
        (entered?.unitemizedCents ?? 0),
    ).toBe(entered?.totalCents);
  });

  it('charts by week, or by month beyond 26 weeks', () => {
    expect(data.chart.granularity).toBe('week');
    expect(data.chart.buckets.map((b) => b.label)).toEqual(['19 oct', '26 oct', '2 nov', '9 nov']);
    const all = buildReportData({ ...rows, period: 'all', from: '2025-11-03' });
    expect(all.chart.granularity).toBe('month');
    expect(all.chart.buckets[0]?.label).toBe('nov 25');
    expect(all.chart.buckets.at(-1)?.label).toBe('nov 26');
  });

  it('refs are short and stable', () => {
    expect(entryRef('3f2a9c1b-0000-4000-8000-00000000a1b2')).toBe('0000A1B2');
    expect(new Set(data.trace.map((t) => t.ref)).size).toBe(data.trace.length);
  });
});

describe('report PDF', () => {
  it('has the summary, the tags, the annex and no names or recommendations', async () => {
    const { pdf, texts } = await renderReportPdfWithText(sampleReportData());
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pageCount(pdf)).toBeGreaterThan(1);
    const all = texts.join('\n');
    for (const expected of [
      'Bodega Sol',
      'Últimas 4 semanas · del 19 oct al 15 nov de 2026',
      'Entró',
      'Salió',
      'Te quedó',
      'Entró y salió por semana',
      'De dónde salen las cifras',
      'Con captura',
      'Lo contaste tú',
      'Caja sin revisar',
      'Por confirmar',
      'Anexo · De dónde viene cada dato',
      'Corrección',
      'R. M.',
    ]) {
      expect(all).toContain(expected);
    }
    expect(all).not.toMatch(FORBIDDEN);
    for (const name of SAMPLE_CLIENTS) expect(all).not.toContain(name);
  });

  it('renders an empty period', async () => {
    const data = buildReportData({
      ...sampleReportRows(),
      entries: [],
      events: [],
      closes: [],
      businessName: null,
    });
    const { pdf, texts } = await renderReportPdfWithText(data);
    expect(pageCount(pdf)).toBeGreaterThan(0);
    expect(texts).toContain('No hay movimientos en este periodo.');
    expect(texts).toContain('Tu negocio');
  });

  it('handles the largest amounts', async () => {
    const rows = sampleReportRows();
    const big = rows.entries.map((entry) => ({ ...entry, amountCents: 9_999_999 }));
    const pdf = await renderReportPdf(buildReportData({ ...rows, entries: big }));
    expect(pageCount(pdf)).toBeGreaterThan(1);
  });
});

describe('report Excel', () => {
  it('has the 4 sheets, initials only and nothing forbidden', async () => {
    const data = sampleReportData();
    const workbook = await readWorkbook(await renderReportXlsx(data));
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([...SHEET_NAMES]);

    const movements = workbook.getWorksheet('Movimientos');
    // Header, one row per entry and the note.
    expect(movements?.rowCount).toBe(data.entries.length + 2);
    expect(movements?.getRow(1).getCell(6).value).toBe('Cliente o proveedor');
    const counterparties = new Set<string>();
    movements?.eachRow((row, i) => {
      if (i > 1 && i <= data.entries.length + 1)
        counterparties.add(String(row.getCell(6).value ?? ''));
    });
    for (const value of counterparties) expect(value).toMatch(/^(|[\p{Lu}]\.( [\p{Lu}]\.)?)$/u);
    expect(movements?.getRow(2).getCell(7).value).toBeTypeOf('number');

    expect(workbook.getWorksheet('Cierres')?.rowCount).toBe(data.days.length + 2);
    expect(workbook.getWorksheet('Ajustes')?.rowCount).toBe(data.changes.length + 2);
    expect(workbook.getWorksheet('Trazabilidad')?.rowCount).toBe(data.trace.length + 2);

    const texts = cellTexts(workbook).join('\n');
    expect(texts).not.toMatch(FORBIDDEN);
    for (const name of SAMPLE_CLIENTS) expect(texts).not.toContain(name);
    expect(texts).toContain('Caja sin revisar');
    expect(texts).toContain('Reemplazado');
  });

  it('keeps Lima wall-clock times', async () => {
    const workbook = await readWorkbook(await renderReportXlsx(sampleReportData()));
    const closes = workbook.getWorksheet('Cierres');
    const sent = closes?.getRow(2).getCell(13).value as Date;
    expect(sent.toISOString()).toBe('2026-10-19T21:00:00.000Z');
    expect(SAMPLE_NOW.toISOString()).toBe('2026-11-16T03:10:00.000Z');
  });
});
