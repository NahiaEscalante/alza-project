import {
  cleanHexCode,
  cleanName,
  confidenceOf,
  findLineIndex,
  fold,
  isWordLine,
  parseDateTime,
} from '../text.js';
import type { OcrLine, OcrPage } from '../types.js';
import { bandBelow, type LayoutFields, type LayoutMatch, type LayoutParser } from './types.js';

const TITLE = /lu[qg]e[oa] exitos/;

/**
 * Luqea «Luqeo exitoso» ticket, seen from the sender's phone: amount, recipient name in capitals
 * (may wrap), recipient phone, «dd/mm/aa, hh:mm», «Destino: Plin», «N° Operación» on the next line.
 */
export const luqeaParser: LayoutParser = {
  layout: 'luqea',

  match(page: OcrPage): LayoutMatch | null {
    const anchorIndex = findLineIndex(page, TITLE);
    return anchorIndex >= 0 ? { layout: 'luqea', anchorIndex } : null;
  },

  amountBand(page, match) {
    return bandBelow(page, match.anchorIndex, 4.5);
  },

  parse(page, match): LayoutFields {
    const anchor = page.lines[match.anchorIndex] as OcrLine;
    const band = this.amountBand(page, match);
    const destination = page.lines.map((l) => fold(l.text)).find((t) => /^destino/.test(t)) ?? '';
    const toPlin = /plin/.test(destination);

    const nameLines: OcrLine[] = [];
    let dateLine: OcrLine | undefined;
    let occurredAt: string | null = null;
    for (let i = match.anchorIndex + 1; i < page.lines.length; i++) {
      const line = page.lines[i] as OcrLine;
      if (line.bbox.y0 < band.bottom - 4) continue;
      const dt = parseDateTime(line.text);
      if (dt) {
        dateLine = line;
        occurredAt = dt;
        break;
      }
      // Name lines (capitals, may wrap) come before the phone number line.
      if (nameLines.length < 3 && !/\d/.test(line.text) && isWordLine(line)) nameLines.push(line);
    }

    const opLabelIndex = findLineIndex(page, /^n\W{0,3}\s*operaci[o0]n/);
    const opLine = opLabelIndex >= 0 ? page.lines[opLabelIndex + 1] : undefined;
    const operationNumber = opLine
      ? cleanHexCode(opLine.text.replace(/[^0-9a-zA-Z|-]/g, ''))
      : null;

    return {
      payment_method: toPlin ? 'plin' : 'bank_transfer',
      receipt_header: toPlin ? 'plin_sent' : 'bank_transfer_sent',
      receipt_header_text: 'Luqeo exitoso',
      holder_role: 'payer',
      counterparty_name: cleanName(nameLines.map((l) => l.text).join(' ')),
      visible_holder_name: null,
      occurred_at: occurredAt,
      operation_number: operationNumber,
      confidence: {
        receipt_header: confidenceOf(anchor),
        holder_role: confidenceOf(anchor),
        counterparty_name: confidenceOf(...nameLines),
        occurred_at: confidenceOf(dateLine),
        operation_number: confidenceOf(opLine),
      },
    };
  },
};
