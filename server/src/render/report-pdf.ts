/**
 * Report PDF (5.10, 4.8): summary and chart first, then the days, the entries with their tags,
 * and the traceability annex. Drawn with pdfkit's vector primitives and the shipped Inter fonts;
 * no AI and no browser. No recommendations inside (PR05) and clients only as initials (PR04).
 */
import PDFDocument from 'pdfkit';
import { formatSoles } from '../domain/index.js';
import { longDayLabel } from '../ledger/labels.js';
import { COLORS, LOGO } from './brand.js';
import { fontPath } from './fonts.js';
import {
  capitalize,
  formatCompactDate,
  formatCompactDateTime,
  formatDateTime,
  formatPoints,
  plural,
} from './format.js';
import { type ReportData, type ReportEntry, rangeText } from './report-model.js';
import { GLOSSARY, REPORT_NOTES } from './report-texts.js';

type Doc = PDFKit.PDFDocument;
type FontName = 'regular' | 'semibold' | 'bold' | 'extrabold';
type Align = 'left' | 'right' | 'center';

const FONT: Record<FontName, string> = {
  regular: 'Inter',
  semibold: 'Inter-SemiBold',
  bold: 'Inter-Bold',
  extrabold: 'Inter-ExtraBold',
};

const MARGIN = 40;
const FOOTER = 34;
const SALES_LIGHT = '#B98CFF';
const UNITEMIZED = COLORS.mint;

/** Drawing context: the document, the cursor and every string drawn (for the tests). */
class Pdf {
  readonly doc: Doc;
  readonly texts: string[] = [];
  y = MARGIN;

  constructor(data: ReportData) {
    this.doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      bufferPages: true,
      info: {
        Title: `Reporte ALZA · ${data.periodText}`,
        Author: 'ALZA',
        Creator: 'ALZA',
        Producer: 'ALZA',
        CreationDate: data.generatedAt,
      },
    });
    this.doc.registerFont(FONT.regular, fontPath(400));
    this.doc.registerFont(FONT.semibold, fontPath(600));
    this.doc.registerFont(FONT.bold, fontPath(700));
    this.doc.registerFont(FONT.extrabold, fontPath(800));
  }

  get width(): number {
    return this.doc.page.width - 2 * MARGIN;
  }

  get bottom(): number {
    return this.doc.page.height - MARGIN - FOOTER;
  }

  /** Starts a new page when `height` does not fit below the cursor. */
  ensure(height: number): void {
    if (this.y + height > this.bottom) this.newPage();
  }

  newPage(): void {
    this.doc.addPage();
    this.y = MARGIN;
  }

  measure(value: string, font: FontName, size: number): number {
    return this.doc.font(FONT[font]).fontSize(size).widthOfString(value);
  }

  /** Cuts `value` with «…» to fit `width`. */
  fit(value: string, font: FontName, size: number, width: number): string {
    if (this.measure(value, font, size) <= width) return value;
    const chars = [...value];
    while (chars.length > 1 && this.measure(`${chars.join('')}…`, font, size) > width) chars.pop();
    return `${chars.join('').trimEnd()}…`;
  }

  /** One line of text at (x, y); never wraps. */
  text(
    value: string,
    x: number,
    y: number,
    options: { font?: FontName; size?: number; color?: string; width?: number; align?: Align } = {},
  ): void {
    const font = options.font ?? 'regular';
    const size = options.size ?? 9;
    const shown = options.width ? this.fit(value, font, size, options.width) : value;
    this.texts.push(shown);
    this.doc
      .font(FONT[font])
      .fontSize(size)
      .fillColor(options.color ?? COLORS.text)
      .text(shown, x, y, {
        lineBreak: false,
        width: options.width,
        align: options.align ?? 'left',
      });
  }

  /** Wrapped paragraph; returns its height. */
  paragraph(
    value: string,
    x: number,
    y: number,
    width: number,
    options: { font?: FontName; size?: number; color?: string } = {},
  ): number {
    const font = options.font ?? 'regular';
    const size = options.size ?? 9;
    this.texts.push(value);
    this.doc
      .font(FONT[font])
      .fontSize(size)
      .fillColor(options.color ?? COLORS.text);
    const height = this.doc.heightOfString(value, { width, lineGap: 2 });
    this.doc.text(value, x, y, { width, lineGap: 2 });
    return height;
  }

  rect(x: number, y: number, w: number, h: number, color: string, radius = 0): void {
    if (radius > 0) this.doc.roundedRect(x, y, w, h, radius).fill(color);
    else this.doc.rect(x, y, w, h).fill(color);
  }

  line(x1: number, y1: number, x2: number, y2: number, color: string, width = 0.75): void {
    this.doc.moveTo(x1, y1).lineTo(x2, y2).lineWidth(width).strokeColor(color).stroke();
  }

  pill(label: string, x: number, y: number, fg: string, bg: string, size = 7.5): number {
    const w = this.measure(label, 'semibold', size) + 10;
    this.rect(x, y, w, size + 6, bg, (size + 6) / 2);
    this.text(label, x + 5, y + 2.6, { font: 'semibold', size, color: fg });
    return w;
  }

  logo(x: number, y: number, size: number): void {
    const doc = this.doc;
    doc
      .save()
      .translate(x, y)
      .scale(size / 26);
    for (const bar of LOGO.bars) doc.path(bar.d).fill(bar.fill);
    doc.restore();
  }

  heading(title: string, subtitle?: string): void {
    this.ensure(subtitle ? 44 : 30);
    this.text(title, MARGIN, this.y, { font: 'bold', size: 14, color: COLORS.navy });
    this.y += 20;
    if (subtitle) {
      this.text(subtitle, MARGIN, this.y, { size: 9, color: COLORS.muted, width: this.width });
      this.y += 16;
    }
    this.y += 4;
  }
}

// ---------------------------------------------------------------------------
// Page 1: header, figures, closes, chart, origin
// ---------------------------------------------------------------------------

function header(pdf: Pdf, data: ReportData): void {
  const doc = pdf.doc;
  const width = doc.page.width;
  const height = 132;
  const gradient = doc.linearGradient(0, 0, width, height);
  gradient.stop(0, '#7B3FF2').stop(0.6, '#4B1BB8').stop(1, '#3A1296');
  doc.rect(0, 0, width, height).fill(gradient);

  pdf.rect(MARGIN, 30, 24, 24, COLORS.card, 7);
  pdf.logo(MARGIN + 3, 33, 18);
  pdf.text('ALZA', MARGIN + 32, 34.5, { font: 'extrabold', size: 14, color: COLORS.card });
  pdf.text('Reporte de tu negocio', MARGIN, 36, {
    font: 'semibold',
    size: 9,
    color: COLORS.card,
    width: pdf.width,
    align: 'right',
  });
  pdf.text(data.businessName ?? 'Tu negocio', MARGIN, 68, {
    font: 'extrabold',
    size: 22,
    color: COLORS.card,
    width: pdf.width,
  });
  pdf.text(`${data.periodText} · ${rangeText(data.from, data.to)}`, MARGIN, 98, {
    font: 'semibold',
    size: 10,
    color: '#E4D7FF',
    width: pdf.width * 0.68,
  });
  pdf.text(`Generado el ${formatDateTime(data.generatedAt)}`, MARGIN, 99, {
    size: 8.5,
    color: '#E4D7FF',
    width: pdf.width,
    align: 'right',
  });
  pdf.y = height + 22;
}

function figureCard(
  pdf: Pdf,
  x: number,
  w: number,
  h: number,
  title: string,
  cents: number,
  color: string,
  lines: string[],
  background: string,
): void {
  const y = pdf.y;
  pdf.rect(x, y, w, h, background, 10);
  if (background === COLORS.card) {
    pdf.doc.roundedRect(x, y, w, h, 10).lineWidth(0.75).strokeColor(COLORS.border).stroke();
  }
  pdf.text(title, x + 12, y + 11, { font: 'bold', size: 10, color: COLORS.muted });
  pdf.text(formatSoles(cents), x + 12, y + 26, {
    font: 'extrabold',
    size: 19,
    color,
    width: w - 24,
  });
  lines.forEach((line, i) => {
    pdf.text(line, x + 12, y + 56 + i * 11.5, { size: 8, color: COLORS.muted, width: w - 24 });
  });
}

function figures(pdf: Pdf, data: ReportData): void {
  const t = data.totals;
  const gap = 10;
  const w = (pdf.width - 2 * gap) / 3;
  const inLines = [
    `Yape y Plin ${formatSoles(t.digitalSalesCents)}`,
    `Efectivo ${formatSoles(t.cashSalesCents)}`,
  ];
  if (t.unknownMethodSalesCents > 0) {
    inLines.push(`Sin detalle ${formatSoles(t.unknownMethodSalesCents)}`);
  }
  const outLines = [
    `Mercadería ${formatSoles(t.inventoryCents)}`,
    `Gastos ${formatSoles(t.expensesCents)}`,
    `Casa ${formatSoles(t.householdCents)}`,
  ];
  if (t.unclassifiedCents > 0) outLines.push(`Por clasificar ${formatSoles(t.unclassifiedCents)}`);
  const h = 60 + Math.max(inLines.length, outLines.length) * 11.5 + 6;
  figureCard(pdf, MARGIN, w, h, 'Entró', t.inCents, COLORS.ok, inLines, COLORS.card);
  figureCard(pdf, MARGIN + w + gap, w, h, 'Salió', t.outCents, COLORS.text, outLines, COLORS.card);
  figureCard(
    pdf,
    MARGIN + 2 * (w + gap),
    w,
    h,
    'Te quedó',
    t.leftCents,
    COLORS.navy,
    ['Entró menos salió'],
    COLORS.lavSoft,
  );
  pdf.y += h + 10;

  const extras: string[] = [];
  if (t.pendingCents > 0) extras.push(`${formatSoles(t.pendingCents)} por confirmar (no suma)`);
  if (data.excludedCents > 0) {
    extras.push(`${formatSoles(data.excludedCents)} personal o interno (no cuenta)`);
  }
  if (extras.length > 0) {
    pdf.text(`Aparte: ${extras.join(' · ')}`, MARGIN, pdf.y, {
      size: 8.5,
      color: COLORS.muted,
      width: pdf.width,
    });
    pdf.y += 16;
  }
}

function closes(pdf: Pdf, data: ReportData): void {
  const c = data.counts;
  pdf.y += 4;
  pdf.text('Tus cierres', MARGIN, pdf.y, { font: 'bold', size: 10, color: COLORS.text });
  let x = MARGIN + 66;
  const y = pdf.y - 1.5;
  x += pdf.pill(plural(c.complete, 'completo', 'completos'), x, y, COLORS.ok, COLORS.okSoft, 8) + 6;
  x += pdf.pill(`${formatPoints(c.partial)} a medias`, x, y, '#8A3B06', COLORS.warnSoft, 8) + 6;
  x += pdf.pill(`${formatPoints(c.noClose)} sin cierre`, x, y, COLORS.muted, '#EEF2F8', 8) + 6;
  pdf.pill(
    `${plural(c.cashUnreviewed, 'día', 'días')} con caja sin revisar`,
    x,
    y,
    COLORS.muted,
    '#EEF2F8',
    8,
  );
  pdf.y += 24;
}

/** A round gridline step ≥ `value` (S/ 600, S/ 1 500, S/ 4 000…). */
function niceStep(value: number): number {
  if (value <= 0) return 100;
  const exponent = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (step * exponent >= value) return step * exponent;
  }
  return 10 * exponent;
}

function legend(pdf: Pdf, items: [string, string][], x: number, y: number): void {
  let cx = x;
  for (const [label, color] of items) {
    pdf.rect(cx, y + 1.5, 8, 8, color, 2);
    pdf.text(label, cx + 12, y + 1, { size: 8, color: COLORS.muted });
    cx += 12 + pdf.measure(label, 'regular', 8) + 14;
  }
}

function chart(pdf: Pdf, data: ReportData): void {
  const height = 210;
  pdf.ensure(height + 10);
  const x0 = MARGIN;
  const y0 = pdf.y;
  pdf.rect(x0, y0, pdf.width, height, COLORS.card, 10);
  pdf.doc
    .roundedRect(x0, y0, pdf.width, height, 10)
    .lineWidth(0.75)
    .strokeColor(COLORS.border)
    .stroke();
  const title =
    data.chart.granularity === 'week' ? 'Entró y salió por semana' : 'Entró y salió por mes';
  pdf.text(title, x0 + 14, y0 + 12, { font: 'bold', size: 10.5 });
  legend(
    pdf,
    [
      ['Entró', COLORS.purple],
      ['Salió', SALES_LIGHT],
    ],
    x0 + pdf.width - 130,
    y0 + 13,
  );

  const buckets = data.chart.buckets;
  // Steps of whole soles: S/ 600, S/ 1 200…
  const step = Math.max(
    100,
    niceStep(Math.max(...buckets.flatMap((b) => [b.inCents, b.outCents]), 1) / 4 / 100) * 100,
  );
  const max = step * 4;
  const axisW = 62;
  const left = x0 + 14 + axisW;
  const right = x0 + pdf.width - 14;
  const top = y0 + 40;
  const base = y0 + height - 30;
  const plotH = base - top;

  for (let i = 0; i <= 4; i++) {
    const value = step * i;
    const y = base - (plotH * i) / 4;
    pdf.line(left, y, right, y, i === 0 ? COLORS.track : '#EEF1F6', i === 0 ? 1 : 0.6);
    pdf.text(formatSoles(Math.round(value)), x0 + 10, y - 4.5, {
      size: 7.5,
      color: COLORS.gray,
      width: axisW,
      align: 'right',
    });
  }

  const n = Math.max(1, buckets.length);
  const slot = (right - left) / n;
  const barW = Math.min(30, Math.max(3, (slot - 10) / 2.6));
  const every = n > 14 ? Math.ceil(n / 14) : 1;
  const showValues = n <= 8;
  buckets.forEach((bucket, i) => {
    const cx = left + slot * i + slot / 2;
    const hIn = (bucket.inCents / max) * plotH;
    const hOut = (bucket.outCents / max) * plotH;
    const radius = Math.min(3, barW / 2);
    if (hIn > 0) pdf.rect(cx - barW - 1, base - hIn, barW, hIn, COLORS.purple, radius);
    if (hOut > 0) pdf.rect(cx + 1, base - hOut, barW, hOut, SALES_LIGHT, radius);
    if (showValues) {
      for (const [cents, x, h, color] of [
        [bucket.inCents, cx - barW - 1, hIn, COLORS.purple],
        [bucket.outCents, cx + 1, hOut, COLORS.muted],
      ] as [number, number, number, string][]) {
        if (cents <= 0) continue;
        pdf.text(formatSoles(cents), x - 20, base - h - 10, {
          font: 'semibold',
          size: 6.8,
          color,
          width: barW + 40,
          align: 'center',
        });
      }
    }
    if (i % every === 0) {
      pdf.text(bucket.label, cx - (slot * every) / 2, base + 7, {
        size: 7.5,
        color: COLORS.gray,
        width: slot * every,
        align: 'center',
      });
    }
  });
  pdf.y = y0 + height + 14;
}

function percent(part: number, total: number): string {
  if (total <= 0) return '0 %';
  return `${Math.round((part / total) * 100)} %`;
}

function origin(pdf: Pdf, data: ReportData): void {
  const rows = data.origins;
  const height = 40 + rows.length * 30 + 26;
  pdf.ensure(height + 10);
  const x0 = MARGIN;
  const y0 = pdf.y;
  pdf.rect(x0, y0, pdf.width, height, COLORS.card, 10);
  pdf.doc
    .roundedRect(x0, y0, pdf.width, height, 10)
    .lineWidth(0.75)
    .strokeColor(COLORS.border)
    .stroke();
  pdf.text('De dónde salen las cifras', x0 + 14, y0 + 12, { font: 'bold', size: 10.5 });
  legend(
    pdf,
    [
      ['Con captura', COLORS.purple],
      ['Lo contaste tú', SALES_LIGHT],
      ['Sin detalle', UNITEMIZED],
    ],
    x0 + 14,
    y0 + height - 22,
  );
  const barX = x0 + 74;
  const barW = pdf.width - 74 - 150;
  rows.forEach((row, i) => {
    const y = y0 + 38 + i * 30;
    pdf.text(row.figure, x0 + 14, y + 1, { font: 'semibold', size: 9.5 });
    pdf.rect(barX, y, barW, 12, '#EEF1F6', 3);
    let x = barX;
    for (const [cents, color] of [
      [row.screenshotCents, COLORS.purple],
      [row.selfReportedCents, SALES_LIGHT],
      [row.unitemizedCents, UNITEMIZED],
    ] as [number, string][]) {
      if (row.totalCents <= 0 || cents <= 0) continue;
      const w = (cents / row.totalCents) * barW;
      pdf.rect(x, y, w, 12, color, 0);
      x += w;
    }
    pdf.text(
      `${percent(row.screenshotCents, row.totalCents)} con captura`,
      barX + barW + 12,
      y + 1,
      { font: 'semibold', size: 9, color: COLORS.purple, width: 130 },
    );
  });
  pdf.y = y0 + height + 14;
}

function glossary(pdf: Pdf): void {
  const half = (pdf.width - 34) / 2;
  const rowsPerColumn = Math.ceil(GLOSSARY.length / 2);
  const rowH = 40;
  const height = 36 + rowsPerColumn * rowH;
  pdf.ensure(height);
  const y0 = pdf.y;
  pdf.rect(MARGIN, y0, pdf.width, height, COLORS.bg, 10);
  pdf.text('Cómo leer este reporte', MARGIN + 14, y0 + 12, { font: 'bold', size: 10.5 });
  GLOSSARY.forEach(([term, meaning], i) => {
    const column = Math.floor(i / rowsPerColumn);
    const row = i % rowsPerColumn;
    const x = MARGIN + 14 + column * (half + 6);
    const y = y0 + 34 + row * rowH;
    pdf.text(term, x, y, { font: 'bold', size: 8.5, color: COLORS.navy });
    pdf.paragraph(meaning, x, y + 11, half - 10, { size: 8, color: COLORS.muted });
  });
  pdf.y = y0 + height + 16;
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

interface Column {
  header: string;
  width: number;
  align?: Align;
}

type Cell =
  | string
  | { text: string; color?: string; font?: FontName }
  | { tags: { label: string; fg: string; bg: string }[] };

interface Row {
  cells: Cell[];
  /** A full-width group header («Martes 10 de noviembre · completo»). */
  group?: { title: string; tags: { label: string; fg: string; bg: string }[] };
  muted?: boolean;
}

const ROW_H = 17;

function tableHeader(pdf: Pdf, columns: Column[], widths: number[]): void {
  const y = pdf.y;
  pdf.rect(MARGIN, y, pdf.width, ROW_H, COLORS.navy, 4);
  let x = MARGIN;
  columns.forEach((column, i) => {
    const w = widths[i] as number;
    pdf.text(column.header, x + 5, y + 5, {
      font: 'semibold',
      size: 7.5,
      color: COLORS.card,
      width: w - 10,
      align: column.align ?? 'left',
    });
    x += w;
  });
  pdf.y += ROW_H + 1;
}

function table(pdf: Pdf, columns: Column[], rows: Row[]): void {
  const total = columns.reduce((sum, column) => sum + column.width, 0);
  const widths = columns.map((column) => (column.width / total) * pdf.width);
  pdf.ensure(ROW_H * 3);
  tableHeader(pdf, columns, widths);
  let zebra = false;
  for (const row of rows) {
    if (pdf.y + ROW_H > pdf.bottom) {
      pdf.newPage();
      tableHeader(pdf, columns, widths);
    }
    const y = pdf.y;
    if (row.group) {
      pdf.rect(MARGIN, y + 2, pdf.width, ROW_H, COLORS.lavSoft, 4);
      pdf.text(row.group.title, MARGIN + 6, y + 7, { font: 'bold', size: 8, color: COLORS.navy });
      let tx = MARGIN + 12 + pdf.measure(row.group.title, 'bold', 8);
      for (const tag of row.group.tags)
        tx += pdf.pill(tag.label, tx, y + 5.5, tag.fg, tag.bg, 6.5) + 4;
      pdf.y += ROW_H + 3;
      zebra = false;
      continue;
    }
    if (zebra) pdf.rect(MARGIN, y, pdf.width, ROW_H, '#F7F8FC');
    zebra = !zebra;
    let x = MARGIN;
    row.cells.forEach((cell, i) => {
      const w = widths[i] as number;
      const align = columns[i]?.align ?? 'left';
      if (typeof cell === 'object' && 'tags' in cell) {
        let tx = x + 5;
        for (const tag of cell.tags)
          tx += pdf.pill(tag.label, tx, y + 3.5, tag.fg, tag.bg, 6.5) + 3;
      } else {
        const value = typeof cell === 'string' ? cell : cell.text;
        pdf.text(value, x + 5, y + 5, {
          font: typeof cell === 'string' ? 'regular' : (cell.font ?? 'regular'),
          size: 7.8,
          color: row.muted
            ? COLORS.gray
            : typeof cell === 'string'
              ? COLORS.text
              : (cell.color ?? COLORS.text),
          width: w - 10,
          align,
        });
      }
      x += w;
    });
    pdf.y += ROW_H;
  }
  pdf.y += 12;
}

const TAG_STYLE: Record<string, { fg: string; bg: string }> = {
  'Con captura': { fg: COLORS.purple, bg: COLORS.lavSoft },
  'Lo contaste tú': { fg: COLORS.navy, bg: COLORS.blueSoft },
  'Lo contaste tú (sin detalle)': { fg: '#0F5E57', bg: '#DDF6F3' },
  'Por confirmar': { fg: '#8A3B06', bg: COLORS.warnSoft },
  'Caja sin revisar': { fg: '#8A3B06', bg: COLORS.warnSoft },
  'Agregado después del cierre': { fg: COLORS.muted, bg: '#EEF2F8' },
};

function tag(label: string): { label: string; fg: string; bg: string } {
  const style = TAG_STYLE[label] ?? { fg: COLORS.muted, bg: '#EEF2F8' };
  return {
    label: label === 'Agregado después del cierre' ? 'Después del cierre' : label,
    ...style,
  };
}

function signedAmount(entry: ReportEntry): Cell {
  const value =
    entry.direction === 'in'
      ? `+${formatSoles(entry.amountCents)}`
      : formatSoles(-entry.amountCents);
  return {
    text: value,
    font: 'semibold',
    color: entry.countsInTotals && entry.direction === 'in' ? COLORS.ok : COLORS.text,
  };
}

function daysTable(pdf: Pdf, data: ReportData): void {
  pdf.heading(
    'Tus días',
    'Cada día con su cierre. «Caja sin revisar»: ese día no confirmaste si tu efectivo cuadra.',
  );
  if (data.days.length === 0) {
    pdf.text('No hay días con registros en este periodo.', MARGIN, pdf.y, { color: COLORS.muted });
    pdf.y += 20;
    return;
  }
  table(
    pdf,
    [
      { header: 'Día', width: 74 },
      { header: 'Cierre', width: 62 },
      { header: 'Caja', width: 99 },
      { header: 'Entró', width: 70, align: 'right' },
      { header: 'Salió', width: 70, align: 'right' },
      { header: 'Te quedó', width: 70, align: 'right' },
      { header: 'Por confirmar', width: 70, align: 'right' },
    ],
    data.days.map((day) => ({
      cells: [
        `${capitalize(day.label.slice(0, 3))} ${formatCompactDate(day.businessDay)}`,
        day.levelText ? capitalize(day.levelText) : 'En curso',
        day.cashUnreviewed
          ? { tags: [tag('Caja sin revisar')] }
          : { text: day.cashCheckText ?? '—', color: COLORS.muted },
        { text: formatSoles(day.inCents), color: COLORS.ok },
        formatSoles(day.outCents),
        { text: formatSoles(day.leftCents), font: 'semibold', color: COLORS.navy },
        day.pendingCents > 0
          ? { text: formatSoles(day.pendingCents), color: '#8A3B06' }
          : { text: '—', color: COLORS.gray },
      ],
    })),
  );
}

function entriesTable(pdf: Pdf, data: ReportData): void {
  pdf.heading(
    'Tus movimientos',
    'Clientes y proveedores solo con iniciales. Lo que está por confirmar no suma.',
  );
  if (data.entries.length === 0) {
    pdf.text('No hay movimientos en este periodo.', MARGIN, pdf.y, { color: COLORS.muted });
    pdf.y += 20;
    return;
  }
  const dayInfo = new Map(data.days.map((day) => [day.businessDay, day]));
  const rows: Row[] = [];
  let current = '';
  for (const entry of data.entries) {
    if (entry.businessDay !== current) {
      current = entry.businessDay;
      const day = dayInfo.get(current);
      const tags = day?.cashUnreviewed ? [tag('Caja sin revisar')] : [];
      const level = day?.levelText ? ` · cierre ${day.levelText}` : '';
      rows.push({
        cells: [],
        group: { title: `${capitalize(longDayLabel(current))}${level}`, tags },
      });
    }
    rows.push({
      cells: [
        entry.time ?? '—',
        `${entry.directionText} · ${entry.categoryText}`,
        entry.paymentMethodText,
        entry.counterpartyInitials ?? '—',
        { tags: entry.tags.map(tag) },
        signedAmount(entry),
      ],
      muted: !entry.countsInTotals,
    });
  }
  table(
    pdf,
    [
      { header: 'Hora', width: 36 },
      { header: 'Qué fue', width: 112 },
      { header: 'Medio', width: 56 },
      { header: 'Cliente o proveedor', width: 84 },
      { header: 'Etiquetas', width: 158 },
      { header: 'Monto', width: 69, align: 'right' },
    ],
    rows,
  );
}

// ---------------------------------------------------------------------------
// Annex: traceability (RF-RP-03)
// ---------------------------------------------------------------------------

function annex(pdf: Pdf, data: ReportData): void {
  pdf.newPage();
  pdf.heading(
    'Anexo · De dónde viene cada dato',
    'El origen de cada cifra y todos sus cambios. Nada se borra: lo corregido queda reemplazado.',
  );

  pdf.text('1. Origen de las cifras', MARGIN, pdf.y, { font: 'bold', size: 10 });
  pdf.y += 18;
  table(
    pdf,
    [
      { header: 'Cifra', width: 0.9 },
      { header: 'Con captura', width: 1.5, align: 'right' },
      { header: 'Lo contaste tú', width: 1.5, align: 'right' },
      { header: 'Sin detalle', width: 1.5, align: 'right' },
      { header: 'Total', width: 1.1, align: 'right' },
    ],
    data.origins.map((row) => ({
      cells: [
        { text: row.figure, font: 'semibold' },
        `${formatSoles(row.screenshotCents)} (${formatPoints(row.screenshotCount)})`,
        `${formatSoles(row.selfReportedCents)} (${formatPoints(row.selfReportedCount)})`,
        `${formatSoles(row.unitemizedCents)} (${formatPoints(row.unitemizedCount)})`,
        { text: formatSoles(row.totalCents), font: 'semibold' },
      ],
    })),
  );
  pdf.text('Entre paréntesis, la cantidad de registros.', MARGIN, pdf.y - 6, {
    size: 7.5,
    color: COLORS.gray,
  });
  pdf.y += 12;

  pdf.ensure(60);
  pdf.text('2. Cambios y ajustes', MARGIN, pdf.y, { font: 'bold', size: 10 });
  pdf.y += 18;
  if (data.changes.length === 0) {
    pdf.text('No hubo cambios en este periodo.', MARGIN, pdf.y, { color: COLORS.muted });
    pdf.y += 22;
  } else {
    table(
      pdf,
      [
        { header: 'Cambio', width: 70 },
        { header: 'Día', width: 42 },
        { header: 'Qué pasó', width: 122 },
        { header: 'Antes', width: 78 },
        { header: 'Después', width: 88 },
        { header: 'Quién', width: 64 },
        { header: 'Ref.', width: 51 },
      ],
      data.changes.map((change) => ({
        cells: [
          formatCompactDateTime(change.at),
          formatCompactDate(change.businessDay),
          { text: change.kindText, color: COLORS.navy },
          change.before ?? '—',
          change.after ?? '—',
          change.actorText,
          { text: change.ref, color: COLORS.gray },
        ],
      })),
    );
  }

  const count = (status: string) => data.trace.filter((row) => row.status === status).length;
  pdf.ensure(80);
  pdf.text('3. Registros que no suman', MARGIN, pdf.y, { font: 'bold', size: 10 });
  pdf.y += 16;
  const lines = [
    `${plural(count('superseded'), 'registro reemplazado', 'registros reemplazados')} por una corrección`,
    `${plural(count('voided'), 'registro quitado', 'registros quitados')}`,
    `${plural(count('duplicate'), 'captura repetida', 'capturas repetidas')} (se guardan, pero no suman)`,
    `${plural(count('pending'), 'registro', 'registros')} por confirmar`,
  ];
  for (const line of lines) {
    pdf.text(`·  ${line}`, MARGIN + 4, pdf.y, { size: 9, color: COLORS.text });
    pdf.y += 14;
  }
  pdf.y += 2;
  pdf.y += pdf.paragraph(
    'El historial completo de cada registro (cuándo se anotó, de dónde vino y quién lo cambió) está en el Excel, hoja «Trazabilidad». La referencia (Ref.) es la misma en el PDF y en el Excel.',
    MARGIN,
    pdf.y,
    pdf.width,
    { size: 8.5, color: COLORS.muted },
  );
  pdf.y += 16;

  for (const note of REPORT_NOTES) {
    pdf.ensure(14);
    pdf.text(note, MARGIN, pdf.y, { size: 8, color: COLORS.gray, width: pdf.width });
    pdf.y += 12;
  }
}

function footers(pdf: Pdf, data: ReportData): void {
  const range = pdf.doc.bufferedPageRange();
  const label = `ALZA · ${data.businessName ?? 'Tu negocio'} · ${data.periodText}`;
  for (let i = range.start; i < range.start + range.count; i++) {
    pdf.doc.switchToPage(i);
    const y = pdf.doc.page.height - MARGIN - 12;
    pdf.line(MARGIN, y - 8, MARGIN + pdf.width, y - 8, COLORS.border);
    pdf.text(label, MARGIN, y, { size: 7.5, color: COLORS.gray, width: pdf.width * 0.7 });
    pdf.text(`Página ${i + 1} de ${range.count}`, MARGIN, y, {
      size: 7.5,
      color: COLORS.gray,
      width: pdf.width,
      align: 'right',
    });
  }
}

/** Builds the PDF and returns it with every string drawn (the tests read them). */
export async function renderReportPdfWithText(
  data: ReportData,
): Promise<{ pdf: Buffer; texts: string[] }> {
  const pdf = new Pdf(data);
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    pdf.doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdf.doc.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.doc.on('error', reject);
  });

  header(pdf, data);
  figures(pdf, data);
  closes(pdf, data);
  chart(pdf, data);
  origin(pdf, data);
  pdf.newPage();
  glossary(pdf);
  daysTable(pdf, data);
  entriesTable(pdf, data);
  annex(pdf, data);
  footers(pdf, data);
  pdf.doc.end();
  return { pdf: await done, texts: pdf.texts };
}

/** Report PDF (A4). */
export async function renderReportPdf(data: ReportData): Promise<Buffer> {
  return (await renderReportPdfWithText(data)).pdf;
}
