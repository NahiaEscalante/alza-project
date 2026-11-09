import { normalizeAmount } from '../../ai/amount.js';
import { cleanName, confidenceOf, findLineIndex, fold, parseDateTime } from '../text.js';
import type { OcrLine, OcrPage } from '../types.js';
import { bandBelow, type LayoutFields, type LayoutMatch, type LayoutParser } from './types.js';

const ANCHOR = /importe (transferido|enviado)/;
const OPERATION_LABEL = /numero de operaci[o0]n/;

/**
 * BBVA app receipts, always seen from the sender's phone: «Transferencia» (to a BBVA account) or
 * «Envío a contactos» (to Plin). Title, «Operación exitosa», date, «Importe transferido/enviado»,
 * amount, then the two accounts side by side: origin label («Cuenta sueldo») on the left and the
 * recipient's name on the right. The sender's own name is not printed.
 */
export const bbvaParser: LayoutParser = {
  layout: 'bbva',

  match(page: OcrPage): LayoutMatch | null {
    const anchorIndex = findLineIndex(page, ANCHOR);
    if (anchorIndex < 0) return null;
    const hasMarker =
      findLineIndex(page, /operacion exitosa/) >= 0 &&
      findLineIndex(page, /cuenta|bbva|numero de operacion|tipo de operacion/) >= 0;
    return hasMarker ? { layout: 'bbva', anchorIndex } : null;
  },

  amountBand(page, match) {
    return bandBelow(page, match.anchorIndex, 4.5);
  },

  parse(page, match): LayoutFields {
    const titleLine = page.lines[0];
    const titleText = titleLine ? fold(titleLine.text) : '';
    const toPlin =
      findLineIndex(page, /(entidad )?destino:? plin|envio a contactos/) >= 0 ||
      /envio a contactos/.test(titleText);

    let dateLine: OcrLine | undefined;
    let occurredAt: string | null = null;
    for (let i = 0; i < match.anchorIndex; i++) {
      const dt = parseDateTime((page.lines[i] as OcrLine).text);
      if (dt) {
        dateLine = page.lines[i];
        occurredAt = dt;
        break;
      }
    }

    // Accounts row: «Cuenta sueldo | Andres Alejandr...». The recipient is the right column.
    const accountsIndex = findLineIndex(page, /^cuenta\b/, { from: match.anchorIndex });
    const accountsLine = accountsIndex >= 0 ? page.lines[accountsIndex] : undefined;
    const rightColumn = accountsLine?.words
      .filter((w) => w.bbox.x0 >= page.width * 0.49)
      .map((w) => w.text)
      .join(' ');

    const opLabelIndex = findLineIndex(page, OPERATION_LABEL, { from: match.anchorIndex });
    let opLine: OcrLine | undefined;
    let operationNumber: string | null = null;
    if (opLabelIndex >= 0) {
      const label = page.lines[opLabelIndex] as OcrLine;
      const sameLine = /(\d{6,})\s*$/.exec(label.text);
      const next = page.lines[opLabelIndex + 1];
      const nextLine = next && /^\s*(\d{6,})\s*$/.exec(next.text);
      if (sameLine) {
        opLine = label;
        operationNumber = sameLine[1] as string;
      } else if (nextLine) {
        opLine = next;
        operationNumber = nextLine[1] as string;
      }
    }

    return {
      payment_method: toPlin ? 'plin' : 'bank_transfer',
      receipt_header: toPlin ? 'plin_sent' : 'bank_transfer_sent',
      receipt_header_text: titleLine && titleLine.confidence >= 60 ? titleLine.text : null,
      holder_role: 'payer',
      counterparty_name: cleanName(rightColumn),
      visible_holder_name: null,
      occurred_at: occurredAt,
      operation_number: operationNumber,
      confidence: {
        receipt_header: confidenceOf(page.lines[match.anchorIndex]),
        holder_role: confidenceOf(page.lines[match.anchorIndex]),
        counterparty_name: confidenceOf(accountsLine),
        occurred_at: confidenceOf(dateLine),
        operation_number: confidenceOf(opLine),
      },
    };
  },

  crossCheckAmounts(page: OcrPage): string[] {
    const amounts: string[] = [];
    for (const line of page.lines) {
      const m = /importe abonado\s*s\s*\/\s*([\d.,]+)\s*$/.exec(fold(line.text));
      const amount = m ? normalizeAmount(m[1]) : null;
      if (amount && line.confidence >= 80) amounts.push(amount);
    }
    return amounts;
  },
};
