import {
  cleanName,
  confidenceOf,
  findLineIndex,
  fold,
  isWordLine,
  parseDateTime,
} from '../text.js';
import type { OcrLine, OcrPage } from '../types.js';
import { bandBelow, type LayoutFields, type LayoutMatch, type LayoutParser } from './types.js';

const RECEIVED = /te yapearon/;
const SENT = /yapeaste/;
const OPERATION = /nro\.? de operaci[o0]n\s*[:.]?\s*(\d[\d ]{5,})\s*$/;

/**
 * Yape receipt (D36): «¡Te Yapearon!» (she received) or «¡Yapeaste!» (she paid). Below the title:
 * amount, the other party («Fernando Sar*»), date and time, security code, phone, destination and
 * «Nro. de operación». Yape never shows the holder's own name.
 */
export const yapeParser: LayoutParser = {
  layout: 'yape',

  match(page: OcrPage): LayoutMatch | null {
    const anchorIndex = findLineIndex(page, /te yapearon|yapeaste/);
    return anchorIndex >= 0 ? { layout: 'yape', anchorIndex } : null;
  },

  amountBand(page, match) {
    return bandBelow(page, match.anchorIndex, 4.5);
  },

  parse(page, match): LayoutFields {
    const anchor = page.lines[match.anchorIndex] as OcrLine;
    const received = RECEIVED.test(fold(anchor.text));
    const band = this.amountBand(page, match);

    let nameLine: OcrLine | undefined;
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
      if (!nameLine && isWordLine(line)) nameLine = line;
    }

    const opIndex = findLineIndex(page, OPERATION, { from: match.anchorIndex });
    const opLine = opIndex >= 0 ? page.lines[opIndex] : undefined;
    const opMatch = opLine ? OPERATION.exec(fold(opLine.text)) : null;
    const operationNumber = opMatch ? (opMatch[1] as string).replace(/\s+/g, '') : null;

    const holderRoleConfidence = confidenceOf(anchor);
    return {
      payment_method: 'yape',
      receipt_header: received
        ? 'yape_received'
        : SENT.test(fold(anchor.text))
          ? 'yape_sent'
          : 'unknown',
      receipt_header_text: received ? '¡Te Yapearon!' : '¡Yapeaste!',
      holder_role: received ? 'payee' : 'payer',
      counterparty_name: cleanName(nameLine?.text),
      visible_holder_name: null,
      occurred_at: occurredAt,
      operation_number: operationNumber,
      confidence: {
        receipt_header: holderRoleConfidence,
        holder_role: holderRoleConfidence,
        counterparty_name: confidenceOf(nameLine),
        occurred_at: confidenceOf(dateLine),
        operation_number: confidenceOf(opLine),
      },
    };
  },
};
