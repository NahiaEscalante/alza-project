/** Formatting and Spanish labels for the panel. Times are always shown in Lima. */

const DATE_TIME = new Intl.DateTimeFormat('es-PE', {
  timeZone: 'America/Lima',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const DAY = new Intl.DateTimeFormat('es-PE', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

/** «8 nov 21:50» (Lima). */
export function dateTime(iso: string): string {
  return DATE_TIME.format(new Date(iso)).replace(/[.,]/g, '').replace(/-/g, ' ');
}

/** `YYYY-MM-DD` business day (no time zone shift): «lun 5 oct». */
export function day(isoDate: string): string {
  return DAY.format(new Date(`${isoDate}T00:00:00Z`)).replace(/[.,]/g, '');
}

export function percent(rate: number | null): string {
  if (rate === null) return '—';
  const value = String(Math.round(rate * 1000) / 10).replace('.', ',');
  return `${value} %`;
}

/** «2 500», grouped like the user's web. */
export function points(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Decimal comma, like amounts in the spec (RNF-11): «0,36». */
export function decimal(value: number | null, digits = 1): string {
  if (value === null) return '—';
  const factor = 10 ** digits;
  return String(Math.round(value * factor) / factor).replace('.', ',');
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

/** Values of a stored detail: instants in Lima time, uuids shortened. */
export function detailValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => detailValue(v)).join(', ');
  if (typeof value === 'string') {
    if (ISO_INSTANT.test(value) && !Number.isNaN(Date.parse(value))) return dateTime(value);
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(value)) return value.slice(0, 8);
    return value.length > 24 ? `${value.slice(0, 12)}…` : value;
  }
  return String(value);
}

export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : '—';
}

export const MESSAGE_TYPE_LABEL: Record<string, string> = {
  image: 'Imagen',
  audio: 'Audio',
  text: 'Texto',
  interactive: 'Botón',
};

export const ALERT_TYPE_LABEL: Record<string, string> = {
  duplicate_account_holder: 'Titular repetido',
  shared_screenshot: 'Misma captura en otra cuenta',
  activity_spike: 'Salto de actividad',
  instant_close_replies: 'Respuestas instantáneas al cierre',
  pin_lockout: 'PIN bloqueado (5 intentos)',
};

export const ALERT_STATUS_LABEL: Record<string, string> = {
  open: 'Abierta',
  reviewed: 'Revisada',
  dismissed: 'Descartada',
};

export const REDEMPTION_STATUS_LABEL: Record<string, string> = {
  delivered: 'Aprobado',
  in_review: 'En revisión',
  rejected: 'Rechazado',
};

export const ACTION_LABEL: Record<string, string> = {
  'auth.login': 'Inició sesión',
  'auth.logout': 'Cerró sesión',
  'inbound_message.retry': 'Reintentó un mensaje',
  'inbound_message.retry_all': 'Reintentó todos los mensajes',
  'redemption.approve': 'Aprobó un canje',
  'redemption.reject': 'Rechazó un canje',
  'alert.review': 'Revisó una alerta',
  'job.close_finalize': 'Finalizó cierres',
  'job.antifraud_scan': 'Corrió el antifraude',
  'broadcast.technical_issue': 'Envió el aviso WA-17',
};

/** Labels for the alert detail keys the antifraud and PIN code write (ids and counts). */
export const DETAIL_LABEL: Record<string, string> = {
  conflictingUserIds: 'Otras cuentas',
  holderKey: 'Clave del titular',
  sha256: 'SHA-256',
  mediaFileId: 'Archivo',
  firstUserId: 'Primera cuenta',
  week: 'Semana',
  currentWeekCount: 'Registros esa semana',
  weeklyAverage: 'Promedio semanal',
  baselineWeeks: 'Semanas de base',
  fromDay: 'Desde',
  toDay: 'Hasta',
  closes: 'Cierres',
  slowestReplyMs: 'Respuesta más lenta (ms)',
  closeNotice: 'Aviso en el cierre (D28)',
  lockedUntil: 'Bloqueado hasta',
  at: 'Fecha',
  reviewedAt: 'Revisada',
  reviewedBy: 'Revisada por',
};
