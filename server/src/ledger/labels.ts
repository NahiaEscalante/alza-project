/**
 * Texts she sees in the web for ledger values (11.3, PR12, Anexo A). Never «ganancia».
 */
import type {
  Category,
  CloseLevel,
  Direction,
  LedgerLabel,
  PaymentMethod,
  RedemptionStatus,
} from '../db/schema.js';
import { type IsoDate, isoWeekday, limaWallClock } from '../domain/index.js';

/** PR12 / 11.3 visible tags. */
export const LABEL_TEXT: Record<LedgerLabel, string> = {
  screenshot: 'Con captura',
  self_reported: 'Lo contaste tú',
  unitemized: 'Lo contaste tú (sin detalle)',
};
export const PENDING_TAG = 'Por confirmar';
export const CASH_UNREVIEWED_TAG = 'Caja sin revisar';
/** PR03 mark. */
export const AFTER_CLOSE_TAG = 'Agregado después del cierre';

/** Anexo A: «Cierre completo», «Cierre a medias». */
export const LEVEL_TEXT: Record<CloseLevel, string> = {
  complete: 'completo',
  partial: 'a medias',
  no_close: 'sin cierre',
};

export const DIRECTION_TEXT: Record<Direction, string> = { in: 'Entró', out: 'Salió' };

export const METHOD_TEXT: Record<PaymentMethod, string> = {
  yape: 'Yape',
  plin: 'Plin',
  cash: 'Efectivo',
  bank_transfer: 'Transferencia',
  unknown: 'Sin medio',
};

export const CATEGORY_TEXT: Record<Category, string> = {
  sale: 'Venta',
  other_income: 'Otro ingreso',
  inventory: 'Mercadería',
  expense: 'Gasto del negocio',
  household: 'Para la casa',
  unclassified: 'Por clasificar',
  internal: 'Movimiento interno',
  personal: 'Personal (no cuenta)',
};

export const REDEMPTION_STATUS_TEXT: Record<RedemptionStatus, string> = {
  delivered: 'Entregado',
  in_review: 'En revisión',
  rejected: 'Rechazado',
};

const WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

export function weekdayName(day: IsoDate): string {
  return WEEKDAYS[isoWeekday(day) - 1] as string;
}

/** «martes 10». */
export function dayLabel(day: IsoDate): string {
  return `${weekdayName(day)} ${Number(day.slice(8, 10))}`;
}

/** «martes 10 de noviembre». */
export function longDayLabel(day: IsoDate): string {
  return `${dayLabel(day)} de ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
}

const SHORT_MONTHS = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'set',
  'oct',
  'nov',
  'dic',
];

/** «Semana del 9 al 15 nov», «Semana del 28 oct al 3 nov» (12.2). */
export function weekLabel(monday: IsoDate, sunday: IsoDate): string {
  const d1 = Number(monday.slice(8, 10));
  const d2 = Number(sunday.slice(8, 10));
  const m1 = SHORT_MONTHS[Number(monday.slice(5, 7)) - 1];
  const m2 = SHORT_MONTHS[Number(sunday.slice(5, 7)) - 1];
  return m1 === m2 ? `Semana del ${d1} al ${d2} ${m2}` : `Semana del ${d1} ${m1} al ${d2} ${m2}`;
}

/** «14:05», Lima time. */
export function formatTime24(instant: Date): string {
  const { hour, minute } = limaWallClock(instant);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** «3:10 p. m.», «2 p. m.», «12:30 a. m.» (Lima time, as in 11.8). */
export function formatTime12(instant: Date): string {
  const { hour, minute } = limaWallClock(instant);
  const suffix = hour < 12 ? 'a. m.' : 'p. m.';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return minute === 0 ? `${h12} ${suffix}` : `${h12}:${String(minute).padStart(2, '0')} ${suffix}`;
}
