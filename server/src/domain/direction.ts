/**
 * Payment direction (11.2, D36, RF-LB-03).
 *
 * Yape: the screen never shows the account owner. «¡Te Yapearon!» shows only who paid, «¡Yapeaste!»
 * only who received. The header decides; the name is compared only to catch a client's phone
 * («¡Yapeaste!» to her → in) and contradictions («¡Te Yapearon!» from her own name → doubt).
 *
 * Plin, transfers and Yape without a legible header: the visible account holder and their role.
 */
import { matchesAnyHolder, normalizeName } from './names.js';
import type { Direction } from './types.js';

/** Yape screen headers (encabezado). */
export type YapeHeader = 'yape_received' | 'yape_sent';

/** rol_titular (10.2): paga → payer · recibe → payee · desconocido → unknown */
export type HolderRole = 'payer' | 'payee' | 'unknown';

/** «¡Te Yapearon!» → yape_received; «¡Yapeaste!» → yape_sent; anything else → null. */
export function parseYapeHeader(header: string | null | undefined): YapeHeader | null {
  const text = normalizeName(header);
  if (/\bte yapearon\b/.test(text)) return 'yape_received';
  if (/\byapeaste\b/.test(text)) return 'yape_sent';
  return null;
}

export interface DirectionInput {
  /** encabezado: raw screen title, or null. */
  header: string | null;
  /** nombre_contraparte: in Yape, the only person name the screen shows. */
  counterpartyName: string | null;
  /** nombre_titular_visible: account owner shown (null in Yape). */
  visibleHolderName: string | null;
  holderRole: HolderRole;
  /**
   * Name the screen labels as recipient/destination, when the reader knows it. If omitted, the
   * counterparty is the recipient when the visible holder paid.
   */
  recipientName?: string | null;
  /** Principal holder and up to 2 additional ones (D31). */
  holders: readonly string[];
}

export type DirectionRule =
  | 'yape_sent_to_her'
  | 'yape_received_from_her'
  | 'yape_received'
  | 'yape_sent'
  | 'holder_received'
  | 'holder_paid'
  | 'client_paid_her'
  | 'unknown';

export type DirectionResult =
  | { kind: 'resolved'; direction: Direction; rule: DirectionRule }
  | { kind: 'clarification'; clarificationType: 'direction'; rule: DirectionRule };

function resolved(direction: Direction, rule: DirectionRule): DirectionResult {
  return { kind: 'resolved', direction, rule };
}

function doubt(rule: DirectionRule): DirectionResult {
  return { kind: 'clarification', clarificationType: 'direction', rule };
}

export function decideDirection(input: DirectionInput): DirectionResult {
  const header = parseYapeHeader(input.header);
  if (header !== null) {
    const nameOk = matchesAnyHolder(input.counterpartyName, input.holders);
    if (header === 'yape_sent' && nameOk) return resolved('in', 'yape_sent_to_her');
    if (header === 'yape_received' && nameOk) return doubt('yape_received_from_her');
    if (header === 'yape_received') return resolved('in', 'yape_received');
    return resolved('out', 'yape_sent');
  }

  const holderOk = matchesAnyHolder(input.visibleHolderName, input.holders);
  if (holderOk && input.holderRole === 'payee') return resolved('in', 'holder_received');
  if (holderOk && input.holderRole === 'payer') return resolved('out', 'holder_paid');

  const recipient =
    input.recipientName !== undefined
      ? input.recipientName
      : input.holderRole === 'payer'
        ? input.counterpartyName
        : null;
  if (!holderOk && matchesAnyHolder(recipient, input.holders)) {
    return resolved('in', 'client_paid_her');
  }
  return doubt('unknown');
}
