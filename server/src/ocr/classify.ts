import type { ImageClass } from '../ai/schemas.js';
import { pageText } from './text.js';
import type { OcrPage } from './types.js';

export interface KeywordClassification {
  imageClass: ImageClass;
  /** Which rule decided (a code, safe to log). */
  rule: string;
}

const RECEIPT =
  /te yapearon|yapeaste|te plinearon|plineaste|operacion exitosa|constancia|nro\.? de operacion|numero de operacion|n\W{0,2} ?op\b|luqeo exitoso|importe (transferido|enviado)|transferencia a (contactos|terceros)|envio a contactos/;
const LIST = /movimientos|historial|ultimos movimientos|actividad reciente/;
const INVOICE =
  /boleta de venta|factura|nota de venta|guia de remision|\bruc\b|\bigv\b|op\. gravada|total a pagar|comprobante de pago electronico/;
const OTHER_FINANCIAL =
  /saldo disponible|estado de cuenta|cuota|prestamo|tarjeta de credito|linea de credito|cobrar con qr|solicitud de pago/;
const AMOUNT = /s\s?\/\s?\d|\d+[.,]\d{2}\b/g;

/**
 * Keyword classification of the OCR text (RF-EX-01). Returns null when the text does not decide it
 * (little text, mixed signals): the caller then asks a vision model. Non-financial is never decided
 * here, because an unreadable receipt also yields little text.
 */
export function classifyByKeywords(page: OcrPage): KeywordClassification | null {
  const text = pageText(page);
  const amounts = text.match(AMOUNT)?.length ?? 0;
  if (LIST.test(text) && amounts >= 3)
    return { imageClass: 'activity_list', rule: 'list_keywords' };
  if (INVOICE.test(text)) return { imageClass: 'supplier_invoice', rule: 'invoice_keywords' };
  if (RECEIPT.test(text)) return { imageClass: 'individual_receipt', rule: 'receipt_keywords' };
  if (OTHER_FINANCIAL.test(text))
    return { imageClass: 'other_financial', rule: 'financial_keywords' };
  return null;
}
