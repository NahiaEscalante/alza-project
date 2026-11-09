/**
 * Spanish texts of the report (5.10, Anexo A, PR12). Never «ganancia» or «utilidad», and no
 * product recommendations (PR05: they live only in the download screen).
 */
import type {
  CashCheckResult,
  LedgerEntryEvent,
  LedgerEntrySource,
  LedgerEntryStatus,
} from '../db/schema.js';

export const REPORT_PERIODS = ['4_weeks', '12_weeks', 'all'] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export function isReportPeriod(value: unknown): value is ReportPeriod {
  return typeof value === 'string' && (REPORT_PERIODS as readonly string[]).includes(value);
}

export const PERIOD_TEXT: Record<ReportPeriod, string> = {
  '4_weeks': 'Últimas 4 semanas',
  '12_weeks': 'Últimas 12 semanas',
  all: 'Todo tu historial',
};

export const SOURCE_TEXT: Record<LedgerEntrySource, string> = {
  screenshot: 'Captura',
  activity_list: 'Lista de movimientos',
  text: 'Mensaje de texto',
  audio: 'Audio',
  close_reply: 'Respuesta al cierre',
  web: 'Web',
  chat: 'Chat de la web',
};

export const STATUS_TEXT: Record<LedgerEntryStatus, string> = {
  confirmed: 'Confirmado',
  pending: 'Por confirmar',
  duplicate: 'Repetido (no suma)',
  voided: 'Quitado',
  superseded: 'Reemplazado',
};

export const EVENT_TEXT: Record<LedgerEntryEvent, string> = {
  created: 'Anotado',
  confirmed: 'Confirmado',
  voided: 'Quitado',
  superseded: 'Reemplazado',
  resolved: 'Duda resuelta',
};

export const CASH_CHECK_TEXT: Record<CashCheckResult, string> = {
  balanced: 'Cuadra',
  adjusted: 'Cuadra con ajustes',
  unsure: 'No sabe',
  no_answer: 'Sin respuesta',
};

export const CHANGE_TEXT = {
  correction: 'Corrección',
  voided: 'Quitado',
  afterClose: 'Agregado después del cierre',
  pastDay: 'Agregado en un día pasado',
  unitemized: 'Diferencia sin detalle',
} as const;
export type ChangeKind = keyof typeof CHANGE_TEXT;

/** `ledger_entry_events.actor` is `kind:channel` or `admin:<id>` (ledger/types.ts). */
export function actorText(actor: string | null | undefined): string {
  if (!actor) return 'ALZA';
  const [kind, channel] = actor.split(':');
  if (kind === 'admin') return 'Equipo de ALZA';
  if (kind === 'user') {
    if (channel === 'whatsapp') return 'Tú, por WhatsApp';
    if (channel === 'chat') return 'Tú, en el chat';
    return 'Tú, en la web';
  }
  return 'ALZA';
}

/** Known reasons only; internal codes are never printed. */
export function reasonText(reason: unknown): string | null {
  if (typeof reason !== 'string' || reason === '') return null;
  if (reason.startsWith('clarification:')) return 'Al responder una duda';
  const known: Record<string, string> = {
    web_correction: 'Lo corregiste en la web',
    web_void: 'Lo quitaste en la web',
    added_past_day: 'Lo agregaste en la web',
    chat_correction: 'Lo corregiste en el chat',
    chat_void: 'Lo quitaste en el chat',
  };
  return known[reason] ?? null;
}

/** Glossary, with the words of Anexo A (and 11.3 for «sin detalle»). */
export const GLOSSARY: readonly [string, string][] = [
  ['Entró', 'Lo que te pagaron por ventas, por Yape, Plin o en efectivo.'],
  ['Salió', 'Lo que pagaste: mercadería, gastos del negocio y plata para la casa.'],
  ['Te quedó', 'Entró menos salió.'],
  ['Con captura', 'Lo sabemos por tu captura de Yape o Plin.'],
  ['Lo contaste tú', 'Lo sabemos porque nos lo dijiste o lo cambiaste tú.'],
  ['Sin detalle', 'Diferencia entre un total que dijiste y lo anotado.'],
  ['Caja sin revisar', 'No confirmaste si tu efectivo cuadra.'],
  ['Por confirmar', 'Tenemos una duda; todavía no lo sumamos.'],
];

export const REPORT_NOTES = [
  'Los clientes y proveedores aparecen solo con sus iniciales.',
  'ALZA no estima ventas: solo registra lo que mandaste o contaste.',
  'Nada se borra: una corrección crea un registro nuevo y el anterior queda reemplazado.',
] as const;
