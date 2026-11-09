/**
 * Questions and tap options for Pendientes (RF-WP-04), from the suggested texts of 11.8 adapted to
 * the web (the doubt may be from another day). Amounts with `formatSoles`, times in Lima.
 */
import type { Clarification, InboundMessageType, LedgerEntry } from '../db/schema.js';
import { formatSoles } from '../domain/index.js';
import { dayLabel, formatTime12, METHOD_TEXT } from './labels.js';
import type { ClarificationResolution, ResolutionAction } from './service.js';
import type { ClarificationDetail, Direction, PaymentMethod } from './types.js';

export interface PendingOption {
  label: string;
  /** Body for `POST /api/pending/:id/resolve`; with `input`, the UI adds that field. */
  resolution: Partial<ClarificationResolution> & { action: ResolutionAction };
  /** `amount` → add `amountCents`; `day` → add `businessDay` (YYYY-MM-DD, not in the future). */
  input?: 'amount' | 'day';
}

export interface ClarificationText {
  question: string;
  options: PendingOption[];
  hint?: string;
}

/** «Yapes», «Plin», «transferencias»… for «Mandaste dos {…} de S/ 20». */
const METHOD_PLURAL: Record<PaymentMethod, string> = {
  yape: 'Yapes',
  plin: 'Plin',
  bank_transfer: 'transferencias',
  cash: 'pagos en efectivo',
  unknown: 'pagos',
};

/** «El Yape», «El Plin», «La transferencia», «El pago». */
function theMethod(method: PaymentMethod): string {
  if (method === 'bank_transfer') return 'La transferencia';
  if (method === 'yape' || method === 'plin') return `El ${METHOD_TEXT[method]}`;
  return 'El pago';
}

function aMethod(method: PaymentMethod): string {
  if (method === 'bank_transfer') return 'una transferencia';
  if (method === 'yape' || method === 'plin') return `un ${METHOD_TEXT[method]}`;
  return 'un pago';
}

/** Ends a sentence without doubling the period of «p. m.». */
const sentence = (text: string) => (text.endsWith('.') ? text : `${text}.`);
const at = (instant: Date | null) => (instant ? ` a las ${formatTime12(instant)}` : '');
const ofThe = (instant: Date | null) => (instant ? ` de las ${formatTime12(instant)}` : '');
const fromWho = (name: string | null, direction: Direction) =>
  name ? (direction === 'in' ? ` de ${name}` : ` a ${name}`) : '';

const OUT_CATEGORY_OPTIONS = (action: 'set_category' | 'add_from_list'): PendingOption[] => [
  { label: 'Mercadería', resolution: { action, category: 'inventory' } },
  { label: 'Gasto del negocio', resolution: { action, category: 'expense' } },
  { label: 'Para la casa', resolution: { action, category: 'household' } },
];

function quoteOf(
  detail: ClarificationDetail,
  message: { type: InboundMessageType; text: string | null } | null,
): string | null {
  const raw = detail.quote ?? (message?.type === 'text' ? message.text : null);
  if (!raw) return null;
  const clean = raw.replace(/\s+/g, ' ').trim();
  return clean.length > 80 ? `${clean.slice(0, 79)}…` : clean;
}

export function describeClarification(
  c: Pick<Clarification, 'type' | 'businessDay' | 'detail'>,
  entry: Pick<
    LedgerEntry,
    'amountCents' | 'direction' | 'paymentMethod' | 'counterparty' | 'operationAt' | 'createdAt'
  > | null,
  message: { type: InboundMessageType; text: string | null; receivedAt: Date } | null,
): ClarificationText {
  const detail = (c.detail ?? {}) as ClarificationDetail;
  const when = entry?.operationAt ?? (detail.at ? new Date(detail.at) : null);

  switch (c.type) {
    case 'ambiguous_total': {
      const total = detail.declaredTotalCents ?? entry?.amountCents ?? null;
      if (detail.variant === 'cash_below_recorded' && total !== null) {
        return {
          question: `Anotaste ${formatSoles(detail.recordedCents ?? 0)} en efectivo pero dijiste ${formatSoles(total)}. ¿Cuál es correcto?`,
          options: [{ label: 'Está bien lo anotado', resolution: { action: 'dismiss' } }],
          hint: 'Si algo sobra, corrígelo o quítalo en Movimientos.',
        };
      }
      const quote = quoteOf(detail, message);
      const said = quote
        ? `Dijiste «${quote}».`
        : `Dijiste que vendiste ${total === null ? 'un total' : formatSoles(total)}.`;
      return {
        question: `${said} ¿Es todo el día o solo efectivo?`,
        options: [
          { label: 'Solo efectivo', resolution: { action: 'cash_only' } },
          { label: 'Todo el día', resolution: { action: 'whole_day' } },
          { label: 'No lo cuentes', resolution: { action: 'dismiss' } },
        ],
      };
    }
    case 'possible_duplicate': {
      const method = entry?.paymentMethod ?? 'unknown';
      const amount = entry ? ` de ${formatSoles(entry.amountCents)}` : '';
      return {
        question: `${sentence(`Mandaste dos ${METHOD_PLURAL[method]}${amount}${fromWho(entry?.counterparty ?? null, entry?.direction ?? 'in')}${at(when)}`)} ¿Fueron dos pagos?`,
        options: [
          { label: 'Sí, fueron dos', resolution: { action: 'confirm' } },
          { label: 'No, es el mismo', resolution: { action: 'mark_duplicate' } },
        ],
      };
    }
    case 'unreadable': {
      const quote = quoteOf(detail, message);
      const received = detail.at ? new Date(detail.at) : (message?.receivedAt ?? null);
      let question = `Una captura${ofThe(received)} no se lee bien. ¿De cuánto era?`;
      if (message?.type !== 'image' && quote) question = `Dijiste «${quote}». ¿Por cuánto?`;
      else if (message?.type === 'audio') {
        question = `Un audio${ofThe(received)} no se entendió. ¿De cuánto era?`;
      }
      return {
        question,
        options: [
          { label: 'Escribir el monto', resolution: { action: 'set_amount' }, input: 'amount' },
          { label: 'No era un pago', resolution: { action: 'dismiss' } },
        ],
      };
    }
    case 'direction': {
      const method = entry?.paymentMethod ?? 'unknown';
      const amount = entry ? ` de ${formatSoles(entry.amountCents)}` : '';
      return {
        question: `${theMethod(method)}${amount}${ofThe(when)}, ¿te pagaron o pagaste tú?`,
        options: [
          {
            label: 'Me pagaron',
            resolution: { action: 'set_direction', direction: 'in', category: 'sale' },
          },
          {
            label: 'Pagué mercadería',
            resolution: { action: 'set_direction', direction: 'out', category: 'inventory' },
          },
          {
            label: 'Pagué un gasto',
            resolution: { action: 'set_direction', direction: 'out', category: 'expense' },
          },
          {
            label: 'Fue para la casa',
            resolution: { action: 'set_direction', direction: 'out', category: 'household' },
          },
        ],
      };
    }
    case 'date':
      return {
        question: `Esta captura no muestra la fecha. ¿Es del ${dayLabel(c.businessDay)}?`,
        options: [
          { label: 'Sí', resolution: { action: 'confirm' } },
          { label: 'Es de otro día', resolution: { action: 'set_day' }, input: 'day' },
        ],
      };
    case 'category': {
      const amount = entry ? formatSoles(entry.amountCents) : 'un monto';
      const who = entry?.counterparty ? ` a ${entry.counterparty}` : '';
      return {
        question: `Pagaste ${amount}${who}. ¿Fue mercadería o un gasto?`,
        options: OUT_CATEGORY_OPTIONS('set_category'),
      };
    }
    case 'missing_from_list': {
      const row = detail.row;
      if (!row) {
        return {
          question: 'En tu lista hay un movimiento que no me mandaste.',
          options: [{ label: 'No lo cuentes', resolution: { action: 'dismiss' } }],
        };
      }
      const rowAt = row.operationAt ? new Date(row.operationAt) : null;
      const what = `${aMethod(row.paymentMethod)} de ${formatSoles(row.amountCents)}${fromWho(row.counterparty, row.direction)}${at(rowAt)}`;
      if (row.direction === 'in') {
        return {
          question: `En tu lista hay ${what} que no me mandaste. ¿Es una venta?`,
          options: [
            { label: 'Sí, anótala', resolution: { action: 'add_from_list' } },
            { label: 'No lo cuentes', resolution: { action: 'dismiss' } },
          ],
        };
      }
      return {
        question: `En tu lista hay ${what} que no me mandaste. ¿Qué fue?`,
        options: [
          ...OUT_CATEGORY_OPTIONS('add_from_list'),
          { label: 'No lo cuentes', resolution: { action: 'dismiss' } },
        ],
      };
    }
  }
}
