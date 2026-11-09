/**
 * What the web shows her for access errors (plain language, Anexo A). PIN creation errors come
 * from the domain (`PIN_ERROR_MESSAGES`, 12.2). HU-09: an expired activation link tells her to
 * write «web» in WhatsApp.
 */
import { formatTime12 } from '../ledger/labels.js';

export const AUTH_MESSAGES = {
  link_expired: 'Este enlace ya venció. Escribe «web» en WhatsApp para recibir uno nuevo.',
  link_used: 'Este enlace ya se usó. Escribe «web» en WhatsApp para recibir uno nuevo.',
  link_invalid: 'Este enlace no es válido. Escribe «web» en WhatsApp para recibir uno nuevo.',
  no_pin:
    'Todavía no tienes un PIN. Escribe «olvidé mi PIN» en WhatsApp y te mando un enlace para crearlo.',
  too_many_attempts:
    'Por seguridad, tu PIN quedó bloqueado. Escribe «olvidé mi PIN» en WhatsApp para crear uno nuevo.',
  unauthorized:
    'Para entrar, abre el enlace de tu último cierre o escribe «web» en WhatsApp para recibir uno.',
  pin_required: 'Para hacer esto, escribe tu PIN.',
  invalid_pin_format: 'Tu PIN tiene 6 números.',
  rate_limited: 'Hiciste muchos intentos. Espera unos minutos y vuelve a probar.',
  logged_out_all: 'Listo, cerraste tu sesión en todos tus celulares.',
} as const;

export function wrongPinMessage(attemptsLeft: number): string {
  return attemptsLeft === 1
    ? 'PIN incorrecto. Te queda 1 intento.'
    : `PIN incorrecto. Te quedan ${attemptsLeft} intentos.`;
}

/** HU-10: «se le explica cuándo puede volver a intentar». */
export function lockedMessage(until: Date, justLocked: boolean): string {
  const when = `Puedes volver a intentar a las ${formatTime12(until)}.`;
  return justLocked
    ? `Escribiste mal tu PIN 5 veces. Por seguridad, espera 15 minutos. ${when}`
    : `Tu PIN está bloqueado por unos minutos. ${when}`;
}
