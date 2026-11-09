import { z } from 'zod';
import {
  CATEGORIES,
  CLARIFICATION_TYPES,
  DIRECTIONS,
  INTENTS,
  PAYMENT_METHODS,
  SCOPES,
} from '../db/schema.js';
import { normalizeAmount } from './amount.js';

/**
 * Output contracts of the AI layer (spec 8.3, 10.2, 10.3), field names in English (D32).
 * Every reader (OCR + layout parsers, vision, text models) returns these shapes, validated here.
 *
 * Lenient on purpose where a bad value must become «unknown», never a guess:
 * - an amount that does not normalize becomes null (→ «ilegible», RF-EX-06);
 * - a date that does not parse becomes null (→ day of arrival / «fecha» clarification).
 * Strict everywhere else: a wrong enum or shape fails validation and the call is retried.
 */

// ---------------------------------------------------------------------------
// Closed values (spec → code)
// ---------------------------------------------------------------------------

/**
 * tipo de imagen (RF-EX-01): constancia individual → individual_receipt · lista de movimientos →
 * activity_list · comprobante de proveedor → supplier_invoice · otra financiera → other_financial ·
 * no financiera → non_financial
 */
export const IMAGE_CLASSES = [
  'individual_receipt',
  'activity_list',
  'supplier_invoice',
  'other_financial',
  'non_financial',
] as const;
export type ImageClass = (typeof IMAGE_CLASSES)[number];

/**
 * encabezado (10.2, D36), as a code. The literal title is kept in `receipt_header_text`.
 * «¡Te Yapearon!» → yape_received · «¡Yapeaste!» → yape_sent · Plin sends from a bank app
 * («Envío a contactos», «Transferencia a contactos», «Luqeo exitoso» to Plin) → plin_sent ·
 * bank transfers → bank_transfer_sent / bank_transfer_received.
 */
export const RECEIPT_HEADERS = [
  'yape_received',
  'yape_sent',
  'plin_received',
  'plin_sent',
  'bank_transfer_received',
  'bank_transfer_sent',
  'unknown',
] as const;
export type ReceiptHeader = (typeof RECEIPT_HEADERS)[number];

/** rol_titular: paga → payer · recibe → payee · desconocido → unknown */
export const HOLDER_ROLES = ['payer', 'payee', 'unknown'] as const;
export type HolderRole = (typeof HOLDER_ROLES)[number];

/** Screen designs with a deterministic reader (D33). */
export const SCREENSHOT_LAYOUTS = ['yape', 'bbva', 'bancom', 'luqea'] as const;
export type ScreenshotLayout = (typeof SCREENSHOT_LAYOUTS)[number];

/** «pedir algo» (RF-EX-05, D05, D27): what she asked for when intent = request. */
export const REQUEST_KINDS = [
  'web_link',
  'forgot_pin',
  'delete_data',
  'text_only',
  'with_image',
] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

/** Questions of the close message: the clarifications (11.8) plus the cash check (11.7). */
export const CLOSE_QUESTION_TYPES = [...CLARIFICATION_TYPES, 'cash_check'] as const;
export type CloseQuestionType = (typeof CLOSE_QUESTION_TYPES)[number];

/** Answer to the cash check: cuadra · no cuadra · no sabe. */
export const CASH_CHECK_ANSWERS = ['balanced', 'not_balanced', 'unsure'] as const;
export type CashCheckAnswer = (typeof CASH_CHECK_ANSWERS)[number];

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------

/** Decimal string «12.50» or null. Anything that does not normalize becomes null. */
export const zAmount = z.preprocess(
  (v) => (v == null ? null : normalizeAmount(v)),
  z.string().nullable(),
);

/** Same, but required (close-reply new entries must carry an amount). */
export const zRequiredAmount = z.preprocess(
  (v) => normalizeAmount(v) ?? undefined,
  z.string({ error: 'invalid amount' }),
);

const ISO_LOCAL =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * ISO 8601 with offset, normalized to `YYYY-MM-DDTHH:MM:SS±HH:MM`. A value without offset is read as
 * Lima time (-05:00). Invalid values become null.
 */
export function normalizeIsoDateTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = ISO_LOCAL.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s = '00', rawOffset] = m;
  let offset = rawOffset ?? '-05:00';
  if (offset === 'Z') offset = '+00:00';
  else if (!offset.includes(':')) offset = `${offset.slice(0, 3)}:${offset.slice(3)}`;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}${offset}`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  // Reject rollovers such as 2026-02-31.
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  if (Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) return null;
  return iso;
}

export const zDateTime = z.preprocess((v) => normalizeIsoDateTime(v), z.string().nullable());

/** Free text from a reader (names, titles): trimmed, empty → null, capped. */
export const zText = z.preprocess((v) => {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t === '' ? null : t.slice(0, 120);
}, z.string().nullable());

/** Per-field confidence 0..1. Percentages (0..100) are scaled; other junk is dropped. */
export const zConfidence = z.preprocess(
  (v) => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, number> = {};
    for (const [key, raw] of Object.entries(v as Record<string, unknown>)) {
      const n = typeof raw === 'string' ? Number(raw) : raw;
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) continue;
      out[key] = n > 1 ? (n <= 100 ? n / 100 : 1) : n;
    }
    return out;
  },
  z.record(z.string(), z.number().min(0).max(1)),
);

// ---------------------------------------------------------------------------
// Screenshots (10.2)
// ---------------------------------------------------------------------------

export const screenshotOperationSchema = z.object({
  amount: zAmount,
  payment_method: z.enum(PAYMENT_METHODS),
  /** The other party, seen from the account that owns the screen. */
  counterparty_name: zText.default(null),
  /** Name of the account that owns the screen, when shown. Null in Yape (D36). */
  visible_holder_name: zText.default(null),
  receipt_header: z.enum(RECEIPT_HEADERS).default('unknown'),
  /** Literal screen title, e.g. «¡Te Yapearon!». */
  receipt_header_text: zText.default(null),
  holder_role: z.enum(HOLDER_ROLES).default('unknown'),
  occurred_at: zDateTime.default(null),
  operation_number: zText.default(null),
  scope: z.enum(SCOPES).default('single'),
  /** Null = desconocida. */
  suggested_category: z.enum(CATEGORIES).nullable().default(null),
  confidence: zConfidence.default({}),
});
export type ScreenshotOperation = z.infer<typeof screenshotOperationSchema>;

export const screenshotExtractionSchema = z.object({
  content_type: z.enum(IMAGE_CLASSES),
  legible: z.boolean(),
  operations: z.array(screenshotOperationSchema).max(50),
});
export type ScreenshotExtraction = z.infer<typeof screenshotExtractionSchema>;

export const imageClassificationSchema = z.object({
  image_class: z.enum(IMAGE_CLASSES),
  confidence: z.number().min(0).max(1).default(0.5),
});
export type ImageClassification = z.infer<typeof imageClassificationSchema>;

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

export const transcriptionSchema = z.object({
  text: z.string().max(5000),
});
export type Transcription = z.infer<typeof transcriptionSchema> & {
  /** True when the speech model was unsure (low log-probability or likely silence). */
  lowConfidence: boolean;
};

// ---------------------------------------------------------------------------
// Texts and audios (RF-EX-04, RF-EX-05)
// ---------------------------------------------------------------------------

export const textOperationSchema = z.object({
  /** Null when she did not say an amount («vendí pan») → «ilegible» clarification (11.12 #9). */
  amount: zAmount,
  /** Other plausible readings when the amount is ambiguous («tres cincuenta»: 3.50 or 350.00). */
  amount_alternatives: z.array(zAmount).default([]),
  direction: z.enum(DIRECTIONS).nullable(),
  payment_method: z.enum(PAYMENT_METHODS),
  scope: z.enum(SCOPES),
  suggested_category: z.enum(CATEGORIES).nullable().default(null),
  counterparty_name: zText.default(null),
  /** Short concept in her words («pan», «la luz»). */
  description: zText.default(null),
  confidence: zConfidence.default({}),
});
export type TextOperation = z.infer<typeof textOperationSchema>;

export const correctionSchema = z.object({
  /** True for «borra eso», «eso no va»: void the last entry. */
  void: z.boolean().default(false),
  amount: zAmount.default(null),
  payment_method: z.enum(PAYMENT_METHODS).nullable().default(null),
  direction: z.enum(DIRECTIONS).nullable().default(null),
  suggested_category: z.enum(CATEGORIES).nullable().default(null),
});
export type Correction = z.infer<typeof correctionSchema>;

export const textInterpretationSchema = z.object({
  intent: z.enum(INTENTS),
  request: z.enum(REQUEST_KINDS).nullable().default(null),
  operations: z.array(textOperationSchema).max(30).default([]),
  correction: correctionSchema.nullable().default(null),
});
export type TextInterpretation = z.infer<typeof textInterpretationSchema>;

// ---------------------------------------------------------------------------
// Close reply (10.3)
// ---------------------------------------------------------------------------

export const closeAnswerValueSchema = z.object({
  amount: zAmount.optional(),
  scope: z.enum(SCOPES).nullable().optional(),
  payment_method: z.enum(PAYMENT_METHODS).nullable().optional(),
  direction: z.enum(DIRECTIONS).nullable().optional(),
  category: z.enum(CATEGORIES).nullable().optional(),
  /** posible_duplicado: true = it is the same payment sent twice; false = two payments. */
  is_duplicate: z.boolean().nullable().optional(),
  /** fecha: true = the screenshot is from today. */
  is_today: z.boolean().nullable().optional(),
  cash_check: z.enum(CASH_CHECK_ANSWERS).nullable().optional(),
});
export type CloseAnswerValue = z.infer<typeof closeAnswerValueSchema>;

export const closeAnswerSchema = z.object({
  number: z.number().int().min(1).max(20),
  resolved: z.boolean(),
  value: closeAnswerValueSchema.default({}),
});
export type CloseAnswer = z.infer<typeof closeAnswerSchema>;

export const closeNewEntrySchema = z.object({
  amount: zRequiredAmount,
  payment_method: z.enum(PAYMENT_METHODS),
  direction: z.enum(DIRECTIONS),
  category: z.enum(CATEGORIES),
  description: zText.default(null),
});
export type CloseNewEntry = z.infer<typeof closeNewEntrySchema>;

export const closeReplyInterpretationSchema = z.object({
  answers: z.array(closeAnswerSchema).max(20),
  new_entries: z.array(closeNewEntrySchema).max(20).default([]),
  /** Numbers of the questions whose answer could not be understood. */
  not_understood: z.array(z.number().int().min(1).max(20)).default([]),
});
export type CloseReplyInterpretation = z.infer<typeof closeReplyInterpretationSchema>;

/** One numbered question of the close message, as sent to her. */
export interface CloseQuestion {
  number: number;
  type: CloseQuestionType;
  text: string;
}
