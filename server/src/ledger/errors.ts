/**
 * Errors of the ledger service. `message` is the Spanish text shown to her (plain language,
 * Anexo A); `code` is what the API returns as `error`.
 */
export const LEDGER_ERROR_MESSAGES = {
  not_found: 'No encontramos ese registro.',
  not_live: 'Este registro ya fue cambiado o quitado.',
  invalid_amount: 'El monto debe ser mayor a S/ 0 y hasta S/ 99 999,99.',
  invalid_category: 'Ese tipo no corresponde a este registro.',
  invalid_day: 'Solo puedes agregar registros en días pasados.',
  no_changes: 'No hay cambios para guardar.',
  already_resolved: 'Esto ya estaba resuelto.',
  invalid_resolution: 'Esa respuesta no corresponde a esta duda.',
} as const;

export type LedgerErrorCode = keyof typeof LEDGER_ERROR_MESSAGES;

export class LedgerError extends Error {
  readonly code: LedgerErrorCode;

  constructor(code: LedgerErrorCode) {
    super(LEDGER_ERROR_MESSAGES[code]);
    this.name = 'LedgerError';
    this.code = code;
  }
}
