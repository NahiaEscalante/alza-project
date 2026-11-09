/**
 * WhatsApp message catalog (12.1): the only messages ALZA ever sends. Silence is part of the
 * product (D04) and every message costs, so nothing goes out without one of these ids.
 *
 * - `TEXTS` holds the exact texts of 12.1, one function per catalog id, with the placeholders as
 *   parameters. The catalog test compares them with the spec itself.
 * - The typed builders (`welcomeMessage`, `firstScreenshotMessage`…) add the buttons and format
 *   the values; `sendCatalogMessage` is the single way to hand one to the channel.
 * - This file owns the non-close messages (WA-01…07, WA-13…17, WA-19, WA-20). The close messages
 *   (WA-10…12, WA-18, WA-21, WA-22) live in `messages/close.ts` (Fase 5) and use the same types.
 */
import type { Channel, ReplyButton, SentMessage } from '../channel/types.js';
import type { Direction, LedgerEntry, PaymentMethod, User } from '../db/schema.js';
import { formatAmount } from '../domain/index.js';

/** Every id of section 12.1. */
export const CATALOG_IDS = [
  'WA-01',
  'WA-02',
  'WA-03',
  'WA-04',
  'WA-05',
  'WA-06',
  'WA-07',
  'WA-10',
  'WA-11',
  'WA-12',
  'WA-13',
  'WA-14',
  'WA-15',
  'WA-16',
  'WA-17',
  'WA-18',
  'WA-19',
  'WA-20',
  'WA-21',
  'WA-22',
] as const;
export type CatalogId = (typeof CATALOG_IDS)[number];

/** One catalog message, ready for the channel. */
export type CatalogMessage =
  | { catalogId: CatalogId; kind: 'text'; body: string }
  | { catalogId: CatalogId; kind: 'buttons'; body: string; buttons: readonly ReplyButton[] }
  | { catalogId: CatalogId; kind: 'image'; mediaId: string; caption?: string };

/**
 * Reply buttons. The id comes back in `interactive.button_reply.id`; titles are the spec's
 * (≤ 20 characters, Meta).
 */
export const BUTTONS = {
  consentAccept: { id: 'consent:accept', title: 'Acepto' },
  consentDecline: { id: 'consent:decline', title: 'No, gracias' },
  close20: { id: 'close_time:20:00', title: '8 pm' },
  close21: { id: 'close_time:21:00', title: '9 pm' },
  close22: { id: 'close_time:22:00', title: '10 pm' },
  deleteConfirm: { id: 'delete:confirm', title: 'Sí, borrar todo' },
  deleteCancel: { id: 'delete:cancel', title: 'Cancelar' },
} as const satisfies Record<string, ReplyButton>;

export const CLOSE_TIME_BUTTON_PREFIX = 'close_time:';

/**
 * The texts of 12.1, verbatim. Parameters are the spec's placeholders: `privacyUrl`
 * {enlace_privacidad}, `name` {nombre}, `time` {hora}, `activationUrl` {enlace_activacion},
 * `kind` {tipo}, `method` {medio}, `amount` {monto}, `accessUrl` {enlace_7d}.
 */
export const TEXTS = {
  'WA-01': (p: { privacyUrl: string }) =>
    [
      'Hola, soy ALZA 👋 Te ayudo a llevar las cuentas de tu negocio con tus capturas de Yape y Plin y tus mensajes.',
      'Para eso guardo y analizo lo que me mandas, con ayuda de servicios de inteligencia artificial que pueden estar fuera del Perú. Puedes pedir que borre tus datos cuando quieras.',
      `Detalles: ${p.privacyUrl}. ¿Aceptas?`,
    ].join('\n'),
  'WA-02': () => 'Entendido, no guardaré nada. Si cambias de opinión, escríbeme.',
  'WA-03': () => '¡Gracias! ¿Cómo se llama tu negocio?',
  'WA-04': () => '¿A nombre de quién está tu Yape o Plin? Escríbelo como aparece en la app.',
  'WA-05': () => '¿A qué hora cierras normalmente? A esa hora te mando tu resumen.',
  'WA-06': (p: { name: string; time: string; activationUrl: string }) =>
    [
      `¡Listo, ${p.name}! Así funciona:`,
      '1️⃣ Cada vez que te paguen con Yape o Plin, mándame la captura.',
      '2️⃣ Si vendes en efectivo, escríbeme o mándame un audio, por ejemplo «vendí 5 soles de pan».',
      'Durante el día no te voy a responder para no interrumpirte; verás el doble check azul ✔✔. Si quieres ver cómo vas, entra a la web.',
      `A las ${p.time} te mando tu resumen del día. Llega como imagen; si prefieres solo texto, escribe «sin imagen».`,
      `Crea tu PIN para ver tu negocio en la web (este enlace dura 1 hora): ${p.activationUrl}`,
    ].join('\n'),
  'WA-07': (p: { kind: string; method: string; amount: string }) =>
    `✅ Así lo anoté: ${p.kind} por ${p.method} de S/${p.amount}. Desde ahora, en silencio hasta tu cierre.`,
  'WA-13': (p: { accessUrl: string }) => `Aquí tienes tu enlace (vale 7 días): ${p.accessUrl}`,
  'WA-14': (p: { activationUrl: string }) =>
    `Para crear un PIN nuevo, entra aquí (vale 1 hora): ${p.activationUrl}`,
  'WA-15': () => '¿Seguro? Esto borra tu historial, tus puntos y tu cuenta. No se puede deshacer.',
  'WA-16': () => 'Listo, borré tus datos. Gracias por usar ALZA.',
  'WA-17': () =>
    'Estamos con un problema técnico. Tus mensajes están guardados y los voy a procesar apenas se resuelva.',
  'WA-19': () =>
    'Tus últimas capturas no se leen bien. Tómalas completas desde tu app de Yape o Plin, sin recortar el monto.',
  'WA-20': () =>
    'No puedo ayudarte con esto en tiempo real. Si estás en peligro, llama al 105. Si sufres violencia, la Línea 100 te orienta gratis.',
} as const satisfies Partial<Record<CatalogId, (params: never) => string>>;

const text = (catalogId: CatalogId, body: string): CatalogMessage => ({
  catalogId,
  kind: 'text',
  body,
});

const buttons = (
  catalogId: CatalogId,
  body: string,
  replyButtons: readonly ReplyButton[],
): CatalogMessage => ({ catalogId, kind: 'buttons', body, buttons: replyButtons });

// ---------------------------------------------------------------------------
// Typed builders
// ---------------------------------------------------------------------------

/** WA-01, with «Acepto» / «No, gracias» (RF-ON-01). */
export function welcomeMessage(privacyUrl: string): CatalogMessage {
  return buttons('WA-01', TEXTS['WA-01']({ privacyUrl }), [
    BUTTONS.consentAccept,
    BUTTONS.consentDecline,
  ]);
}

export const declinedMessage = (): CatalogMessage => text('WA-02', TEXTS['WA-02']());
export const businessNameQuestion = (): CatalogMessage => text('WA-03', TEXTS['WA-03']());
export const accountHolderQuestion = (): CatalogMessage => text('WA-04', TEXTS['WA-04']());

export const CLOSE_TIME_OUT_OF_RANGE_TEXT =
  'Puedo mandarte el cierre hasta las 2 a. m. ¿A qué hora cierras normalmente?';

/** WA-05, with «8 pm» / «9 pm» / «10 pm»; she may also write another time up to 2 a. m. */
export function closeTimeQuestion(outOfRange = false): CatalogMessage {
  return buttons('WA-05', outOfRange ? CLOSE_TIME_OUT_OF_RANGE_TEXT : TEXTS['WA-05'](), [
    BUTTONS.close20,
    BUTTONS.close21,
    BUTTONS.close22,
  ]);
}

/** WA-06 (RF-ON-07). `closeTime` is «21:00» (Lima). */
export function habitMessage(input: {
  name: string;
  closeTime: string;
  activationUrl: string;
}): CatalogMessage {
  return text(
    'WA-06',
    TEXTS['WA-06']({
      name: input.name,
      time: formatCloseTimeForHer(input.closeTime),
      activationUrl: input.activationUrl,
    }),
  );
}

/** {medio} of WA-07. Cash and unknown are never confirmed (only screenshots are). */
const METHOD_IN_MESSAGE: Partial<Record<PaymentMethod, string>> = {
  yape: 'Yape',
  plin: 'Plin',
  bank_transfer: 'transferencia',
};

/** {tipo} of WA-07 (D41): «venta», «pago»… from the entry's direction and category. */
export function entryKindForHer(entry: Pick<LedgerEntry, 'direction' | 'category'>): string {
  const direction: Direction = entry.direction;
  if (direction === 'out') return 'pago';
  return entry.category === 'sale' ? 'venta' : 'ingreso';
}

/** WA-07 can say this entry's medium. */
export function canConfirmMethod(method: PaymentMethod): boolean {
  return METHOD_IN_MESSAGE[method] !== undefined;
}

/** WA-07 (PR01, D41): «✅ Así lo anoté: venta por Yape de S/12,50…». */
export function firstScreenshotMessage(
  entry: Pick<LedgerEntry, 'direction' | 'category' | 'paymentMethod' | 'amountCents'>,
): CatalogMessage {
  const method = METHOD_IN_MESSAGE[entry.paymentMethod];
  if (!method) throw new RangeError(`WA-07 cannot name the method ${entry.paymentMethod}`);
  return text(
    'WA-07',
    TEXTS['WA-07']({
      kind: entryKindForHer(entry),
      method,
      amount: formatAmount(entry.amountCents),
    }),
  );
}

export const accessLinkMessage = (accessUrl: string): CatalogMessage =>
  text('WA-13', TEXTS['WA-13']({ accessUrl }));
export const activationLinkMessage = (activationUrl: string): CatalogMessage =>
  text('WA-14', TEXTS['WA-14']({ activationUrl }));

/** WA-15, with «Sí, borrar todo» / «Cancelar» (HU-15, case 17). */
export function deleteConfirmationQuestion(): CatalogMessage {
  return buttons('WA-15', TEXTS['WA-15'](), [BUTTONS.deleteConfirm, BUTTONS.deleteCancel]);
}

export const dataDeletedMessage = (): CatalogMessage => text('WA-16', TEXTS['WA-16']());
export const technicalIssueMessage = (): CatalogMessage => text('WA-17', TEXTS['WA-17']());
export const screenshotTipMessage = (): CatalogMessage => text('WA-19', TEXTS['WA-19']());
export const dangerMessage = (): CatalogMessage => text('WA-20', TEXTS['WA-20']());

/** «21:00» → «9 p. m.», «21:30» → «9:30 p. m.», «00:00» → «12 a. m.» (as `formatTime12`). */
export function formatCloseTimeForHer(closeTime: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(closeTime);
  if (!match) throw new RangeError(`Invalid close time: ${closeTime}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const suffix = hour < 12 ? 'a. m.' : 'p. m.';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return minute === 0 ? `${h12} ${suffix}` : `${h12}:${String(minute).padStart(2, '0')} ${suffix}`;
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export interface Recipient {
  userId: string;
  /** E.164. */
  to: string;
  /** Quote one of her messages. */
  replyToWaMessageId?: string;
}

export function recipientOf(user: Pick<User, 'id' | 'phoneE164'>): Recipient {
  return { userId: user.id, to: user.phoneE164 };
}

export type CatalogChannel = Pick<Channel, 'sendText' | 'sendButtons' | 'sendImage'>;

/** The single way to send: the catalog id travels to `outbound_messages.type`. */
export function sendCatalogMessage(
  channel: CatalogChannel,
  recipient: Recipient,
  message: CatalogMessage,
): Promise<SentMessage> {
  const ctx = {
    userId: recipient.userId,
    to: recipient.to,
    catalogId: message.catalogId,
    ...(recipient.replyToWaMessageId ? { replyToWaMessageId: recipient.replyToWaMessageId } : {}),
  };
  switch (message.kind) {
    case 'text':
      return channel.sendText(ctx, { body: message.body });
    case 'buttons':
      return channel.sendButtons(ctx, { body: message.body, buttons: message.buttons });
    case 'image':
      return channel.sendImage(ctx, {
        mediaId: message.mediaId,
        ...(message.caption !== undefined ? { caption: message.caption } : {}),
      });
  }
}
