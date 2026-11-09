import {
  cleanHexCode,
  cleanName,
  confidenceOf,
  findLineIndex,
  fold,
  parseDateTime,
} from '../text.js';
import type { OcrLine, OcrPage } from '../types.js';
import { bandBelow, type LayoutFields, type LayoutMatch, type LayoutParser } from './types.js';

const TITLE = /transferencia a contactos|transferencia/;
const OP = /^n\W{0,3}\s*op\b\W*/;

/**
 * Bancom «Transferencia a contactos» ticket, seen from the sender's phone: title, amount, «N° Op»
 * (hex, may wrap to a second line), «Fecha y hora», «Cta. de origen», «Titular» (the sender, i.e.
 * the holder of the screen, may wrap), «Destino» (masked phone) and «Entidad» (Plin).
 */
export const bancomParser: LayoutParser = {
  layout: 'bancom',

  match(page: OcrPage): LayoutMatch | null {
    const hasOrigin = findLineIndex(page, /cta\.? de|origen|bancom/) >= 0;
    const hasHolder = findLineIndex(page, /^titular\b/) >= 0;
    const anchorIndex = findLineIndex(page, TITLE);
    if (!hasOrigin || !hasHolder || anchorIndex < 0) return null;
    return { layout: 'bancom', anchorIndex };
  },

  amountBand(page, match) {
    return bandBelow(page, match.anchorIndex, 7);
  },

  parse(page, match): LayoutFields {
    const anchor = page.lines[match.anchorIndex] as OcrLine;
    const toPlin = findLineIndex(page, /entidad:? plin/) >= 0;

    const opIndex = findLineIndex(page, OP, { from: match.anchorIndex });
    const dateIndex = findLineIndex(page, /^fecha/, { from: match.anchorIndex });
    let operationNumber: string | null = null;
    const opLines: OcrLine[] = [];
    if (opIndex >= 0) {
      const first = page.lines[opIndex] as OcrLine;
      opLines.push(first);
      let code = first.text.replace(/^\S*\s*op\b\W*/i, '');
      const next = page.lines[opIndex + 1];
      if (
        next &&
        (dateIndex < 0 || opIndex + 1 < dateIndex) &&
        /^[0-9a-zA-Z/|]{1,16}$/.test(next.text.trim())
      ) {
        code += next.text.trim();
        opLines.push(next);
      }
      operationNumber = cleanHexCode(code);
    }

    const dateLine = dateIndex >= 0 ? page.lines[dateIndex] : undefined;
    const occurredAt = dateLine ? parseDateTime(dateLine.text) : null;

    const holderIndex = findLineIndex(page, /^titular\b/);
    let holderName: string | null = null;
    const holderLines: OcrLine[] = [];
    if (holderIndex >= 0) {
      const first = page.lines[holderIndex] as OcrLine;
      holderLines.push(first);
      let name = first.text.replace(/^\s*titular\s*:?/i, '');
      const next = page.lines[holderIndex + 1];
      if (next && !/:/.test(next.text) && !/^(destino|entidad)/.test(fold(next.text))) {
        name += ` ${next.text}`;
        holderLines.push(next);
      }
      holderName = cleanName(name);
    }

    return {
      payment_method: toPlin ? 'plin' : 'bank_transfer',
      receipt_header: toPlin ? 'plin_sent' : 'bank_transfer_sent',
      receipt_header_text: anchor.confidence >= 60 ? anchor.text : null,
      holder_role: 'payer',
      counterparty_name: null,
      visible_holder_name: holderName,
      occurred_at: occurredAt,
      operation_number: operationNumber,
      confidence: {
        receipt_header: confidenceOf(anchor),
        holder_role: confidenceOf(anchor),
        visible_holder_name: confidenceOf(...holderLines),
        occurred_at: confidenceOf(dateLine),
        operation_number: confidenceOf(...opLines),
      },
    };
  },
};
