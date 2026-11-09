/**
 * Texts for ledger values (11.3, PR12, Anexo A), mirrored from `server/src/ledger/labels.ts` for
 * the screens that build them locally (forms, «antes y después», history). Never «ganancia».
 */
import type { Category, Direction, EntrySource, Label, PaymentMethod } from './types';

export const LABEL_TEXT: Record<Label, string> = {
  screenshot: 'Con captura',
  self_reported: 'Lo contaste tú',
  unitemized: 'Lo contaste tú (sin detalle)',
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

/** What each type means, for «Cambiar tipo» and «Agregar algo que faltó». */
export const CATEGORY_HELP: Record<Category, string> = {
  sale: 'Suma en lo que entró.',
  other_income: 'No es una venta, por ejemplo un préstamo. No suma en ventas.',
  inventory: 'Lo que compraste para vender. Suma en lo que salió.',
  expense: 'Luz, alquiler, bolsas y otros gastos. Suma en lo que salió.',
  household: 'Plata para tu casa o tu familia. Suma en lo que salió.',
  unclassified: 'Todavía no sabemos qué fue. Suma en lo que salió.',
  internal: 'Pasaste plata entre tus cuentas o cambiaste Yape por efectivo. No suma.',
  personal: 'No es del negocio, por ejemplo plata de tu familia. No suma.',
};

/** Types she can choose for each direction (no «por clasificar»: that one is ALZA's). */
export const CATEGORY_CHOICES: Record<Direction, Category[]> = {
  in: ['sale', 'other_income', 'personal', 'internal'],
  out: ['inventory', 'expense', 'household', 'personal', 'internal'],
};

/** «Se anotó por captura». */
export const SOURCE_TEXT: Record<EntrySource, string> = {
  screenshot: 'por tu captura',
  activity_list: 'por tu lista de movimientos',
  text: 'por tu mensaje',
  audio: 'por tu audio',
  close_reply: 'en tu respuesta al cierre',
  web: 'desde la web',
  chat: 'desde el chat',
};
