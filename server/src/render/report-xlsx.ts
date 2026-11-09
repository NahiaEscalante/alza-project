/**
 * Report Excel (5.10, insumos 12): every detail, in 4 sheets: Movimientos, Cierres, Ajustes and
 * Trazabilidad. Amounts are numbers in soles (so they can be added up), shown as «S/ 1 234,50»;
 * the ledger keeps cents. Clients only as initials (PR04); no recommendations (PR05).
 */
import ExcelJS from 'exceljs';
import type { IsoDate } from '../domain/index.js';
import { COLORS } from './brand.js';
import { capitalize } from './format.js';
import { type ReportData, rangeText } from './report-model.js';

export const SHEET_NAMES = ['Movimientos', 'Cierres', 'Ajustes', 'Trazabilidad'] as const;

const MONEY = '"S/" #,##0.00;-"S/" #,##0.00';
const DATE = 'dd/mm/yyyy';
const DATE_TIME = 'dd/mm/yyyy hh:mm';

interface ColumnSpec {
  header: string;
  key: string;
  width: number;
  numFmt?: string;
}

const argb = (hex: string) => `FF${hex.replace('#', '').toUpperCase()}`;

/** A business day as an Excel date (no time zone shift: it is a calendar day). */
function excelDay(day: IsoDate): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** A Lima wall-clock instant as an Excel date-time (Excel has no time zones). */
function excelLima(instant: Date | null): Date | null {
  if (!instant) return null;
  return new Date(instant.getTime() - 5 * 60 * 60 * 1000);
}

const soles = (cents: number | null) => (cents === null ? null : cents / 100);

function addSheet(
  workbook: ExcelJS.Workbook,
  name: (typeof SHEET_NAMES)[number],
  columns: ColumnSpec[],
  rows: Record<string, unknown>[],
  note: string,
): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet(name, {
    views: [{ state: 'frozen', ySplit: 1 }],
    properties: { defaultRowHeight: 18 },
  });
  sheet.columns = columns.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width,
    style: column.numFmt ? { numFmt: column.numFmt } : {},
  }));
  const header = sheet.getRow(1);
  header.height = 22;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: argb(COLORS.card) } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(COLORS.navy) } };
    cell.alignment = { vertical: 'middle' };
  });
  for (const row of rows) sheet.addRow(row);
  if (rows.length > 0) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: rows.length + 1, column: columns.length },
    };
  }
  // Same note under the table on every sheet: what the reader is looking at.
  const noteRow = sheet.addRow([]);
  noteRow.getCell(1).value = note;
  noteRow.getCell(1).font = { italic: true, color: { argb: argb(COLORS.gray) } };
  return sheet;
}

export async function renderReportXlsx(data: ReportData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ALZA';
  workbook.title = `Reporte ALZA · ${data.periodText}`;
  workbook.created = data.generatedAt;
  workbook.modified = data.generatedAt;
  const period = `${data.businessName ?? 'Tu negocio'} · ${data.periodText}, ${rangeText(data.from, data.to)}.`;

  addSheet(
    workbook,
    'Movimientos',
    [
      { header: 'Día', key: 'day', width: 12, numFmt: DATE },
      { header: 'Hora', key: 'time', width: 8 },
      { header: 'Entró o salió', key: 'direction', width: 13 },
      { header: 'Tipo', key: 'category', width: 20 },
      { header: 'Medio', key: 'method', width: 14 },
      { header: 'Cliente o proveedor', key: 'counterparty', width: 20 },
      { header: 'Monto', key: 'amount', width: 14, numFmt: MONEY },
      { header: 'Etiqueta', key: 'label', width: 28 },
      { header: 'Estado', key: 'status', width: 16 },
      { header: '¿Suma?', key: 'counts', width: 9 },
      { header: 'Agregado después del cierre', key: 'afterClose', width: 14 },
      { header: 'Origen', key: 'source', width: 20 },
      { header: 'Ref.', key: 'ref', width: 11 },
    ],
    data.entries.map((entry) => ({
      day: excelDay(entry.businessDay),
      time: entry.time ?? '',
      direction: entry.directionText,
      category: entry.categoryText,
      method: entry.paymentMethodText,
      counterparty: entry.counterpartyInitials ?? '',
      amount: soles(entry.amountCents),
      label: entry.labelText,
      status: entry.statusText,
      counts: entry.countsInTotals ? 'Sí' : 'No',
      afterClose: entry.afterClose ? 'Sí' : 'No',
      source: entry.sourceText,
      ref: entry.ref,
    })),
    `${period} Clientes y proveedores solo con iniciales. «Por confirmar» no suma hasta resolver la duda.`,
  );

  addSheet(
    workbook,
    'Cierres',
    [
      { header: 'Día', key: 'day', width: 12, numFmt: DATE },
      { header: 'Día de la semana', key: 'weekday', width: 14 },
      { header: 'Cierre', key: 'level', width: 12 },
      { header: 'Caja', key: 'cash', width: 18 },
      { header: 'Caja sin revisar', key: 'unreviewed', width: 14 },
      { header: 'Entró', key: 'in', width: 13, numFmt: MONEY },
      { header: 'Yape y Plin', key: 'digital', width: 13, numFmt: MONEY },
      { header: 'Efectivo', key: 'cashSales', width: 13, numFmt: MONEY },
      { header: 'Salió', key: 'out', width: 13, numFmt: MONEY },
      { header: 'Te quedó', key: 'left', width: 13, numFmt: MONEY },
      { header: 'Por confirmar', key: 'pending', width: 13, numFmt: MONEY },
      { header: 'Cambio esperado en la caja', key: 'expected', width: 16, numFmt: MONEY },
      { header: 'Cierre enviado', key: 'sent', width: 17, numFmt: DATE_TIME },
      { header: 'Respondido', key: 'replied', width: 17, numFmt: DATE_TIME },
      { header: 'Registros', key: 'entries', width: 10 },
    ],
    data.days.map((day) => ({
      day: excelDay(day.businessDay),
      weekday: capitalize(day.label.split(' ')[0] ?? ''),
      level: day.levelText ? capitalize(day.levelText) : 'En curso',
      cash: day.cashCheckText ?? '',
      unreviewed: day.cashUnreviewed ? 'Sí' : 'No',
      in: soles(day.inCents),
      digital: soles(day.digitalSalesCents),
      cashSales: soles(day.cashSalesCents),
      out: soles(day.outCents),
      left: soles(day.leftCents),
      pending: soles(day.pendingCents),
      expected: soles(day.expectedCashChangeCents),
      sent: excelLima(day.sentAt),
      replied: excelLima(day.repliedAt),
      entries: day.entryCount,
    })),
    `${period} Horas de Lima. «Caja sin revisar»: no confirmaste si tu efectivo cuadra.`,
  );

  addSheet(
    workbook,
    'Ajustes',
    [
      { header: 'Fecha del cambio', key: 'at', width: 17, numFmt: DATE_TIME },
      { header: 'Día del movimiento', key: 'day', width: 13, numFmt: DATE },
      { header: 'Qué pasó', key: 'kind', width: 26 },
      { header: 'Antes', key: 'before', width: 28 },
      { header: 'Después', key: 'after', width: 38 },
      { header: 'Quién', key: 'actor', width: 18 },
      { header: 'Motivo', key: 'reason', width: 26 },
      { header: 'Ref.', key: 'ref', width: 11 },
      { header: 'Ref. nueva', key: 'afterRef', width: 11 },
    ],
    data.changes.map((change) => ({
      at: excelLima(change.at),
      day: excelDay(change.businessDay),
      kind: change.kindText,
      before: change.before ?? '',
      after: change.after ?? '',
      actor: change.actorText,
      reason: change.reasonText ?? '',
      ref: change.ref,
      afterRef: change.afterRef ?? '',
    })),
    `${period} Correcciones, registros quitados, agregados después del cierre y diferencias sin detalle.`,
  );

  addSheet(
    workbook,
    'Trazabilidad',
    [
      { header: 'Ref.', key: 'ref', width: 11 },
      { header: 'Día', key: 'day', width: 12, numFmt: DATE },
      { header: 'Monto', key: 'amount', width: 13, numFmt: MONEY },
      { header: 'Entró o salió', key: 'direction', width: 13 },
      { header: 'Medio', key: 'method', width: 14 },
      { header: 'Tipo', key: 'category', width: 20 },
      { header: 'Origen', key: 'source', width: 20 },
      { header: 'Etiqueta', key: 'label', width: 28 },
      { header: 'Estado', key: 'status', width: 18 },
      { header: 'Reemplaza a', key: 'replaces', width: 12 },
      { header: 'Reemplazado por', key: 'replacedBy', width: 14 },
      { header: 'Anotado', key: 'created', width: 17, numFmt: DATE_TIME },
      { header: 'Anotado por', key: 'createdBy', width: 16 },
      { header: 'Historial', key: 'history', width: 80 },
    ],
    data.trace.map((row) => ({
      ref: row.ref,
      day: excelDay(row.businessDay),
      amount: soles(row.amountCents),
      direction: row.directionText,
      method: row.paymentMethodText,
      category: row.categoryText,
      source: row.sourceText,
      label: row.labelText,
      status: row.statusText,
      replaces: row.replacesRef ?? '',
      replacedBy: row.replacedByRef ?? '',
      created: excelLima(row.createdAt),
      createdBy: row.createdByText,
      history: row.history,
    })),
    `${period} Todas las versiones de cada registro, también las reemplazadas y quitadas. Nada se borra.`,
  );

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}
