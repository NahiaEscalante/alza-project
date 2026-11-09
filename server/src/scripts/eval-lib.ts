/**
 * Pure helpers of the AI eval (17.2): dataset parsing, comparisons and metrics. No network.
 */
import { readFileSync } from 'node:fs';
import { normalizeAmount } from '../ai/amount.js';
import { confidentTextAmount } from '../ai/post-checks.js';
import type {
  CloseQuestion,
  CloseReplyInterpretation,
  ScreenshotExtraction,
  TextInterpretation,
  TextOperation,
} from '../ai/schemas.js';

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/** RFC 4180 CSV (quoted fields, doubled quotes, commas and newlines inside quotes). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  const [header, ...body] = rows;
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

export function readJsonl<T>(path: string): T[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as T);
}

export interface AnswerRow {
  id: string;
  file: string;
  type: string;
  amount: string | null;
  direction: 'in' | 'out' | null;
  payment_method: string;
  occurred_at: string | null;
  counterparty: string;
  operation_number: string | null;
  scope: string;
  receipt_header: string;
  holder_role: string;
  visible_holder_name: string;
  notes: string;
}

export function readAnswers(path: string): AnswerRow[] {
  return parseCsv(readFileSync(path, 'utf8')).map((r) => ({
    id: r.id ?? '',
    file: r.file ?? '',
    type: r.type ?? '',
    amount: r.amount ? normalizeAmount(r.amount) : null,
    direction: r.direction === 'in' || r.direction === 'out' ? r.direction : null,
    payment_method: r.payment_method ?? '',
    occurred_at: r.occurred_at || null,
    counterparty: r.counterparty ?? '',
    operation_number: r.operation_number || null,
    scope: r.scope ?? '',
    receipt_header: r.receipt_header ?? '',
    holder_role: r.holder_role ?? '',
    visible_holder_name: r.visible_holder_name ?? '',
    notes: r.notes ?? '',
  }));
}

// ---------------------------------------------------------------------------
// Screenshots
// ---------------------------------------------------------------------------

export type Expectation = 'same' | 'unreadable' | 'same_or_unreadable';

/** Direction from the screen holder's point of view: Yape header first (D36), then the role. */
export function screenDirection(extraction: ScreenshotExtraction): 'in' | 'out' | null {
  const op = extraction.operations[0];
  if (!op) return null;
  if (op.receipt_header === 'yape_received') return 'in';
  if (op.receipt_header === 'yape_sent') return 'out';
  if (op.holder_role === 'payee') return 'in';
  if (op.holder_role === 'payer') return 'out';
  return null;
}

export interface ImageScore {
  amountRead: string | null;
  amountOk: boolean;
  /** An amount was registered (legible) and it is wrong, or the image should have been unreadable. */
  invented: boolean;
  unreadableDetected: boolean;
  directionOk: boolean | null;
  dateOk: boolean | null;
  operationNumberOk: boolean | null;
}

export function scoreImage(
  extraction: ScreenshotExtraction,
  expect: Expectation,
  answer: AnswerRow,
): ImageScore {
  const op = extraction.operations[0];
  const amountRead = extraction.legible && op ? op.amount : null;
  const amountOk = amountRead !== null && amountRead === answer.amount;
  const invented = amountRead !== null && (expect === 'unreadable' || amountRead !== answer.amount);
  const readable = amountRead !== null;
  return {
    amountRead,
    amountOk,
    invented,
    unreadableDetected: amountRead === null,
    directionOk:
      readable && answer.direction ? screenDirection(extraction) === answer.direction : null,
    dateOk:
      readable && answer.occurred_at ? (op?.occurred_at ?? null) === answer.occurred_at : null,
    operationNumberOk:
      readable && answer.operation_number
        ? op?.operation_number === answer.operation_number
          ? true
          : op?.operation_number === null
            ? null
            : false
        : null,
  };
}

// ---------------------------------------------------------------------------
// Texts and audios
// ---------------------------------------------------------------------------

type OneOrMany<T> = T | T[];

export interface ExpectedTextOperation {
  amount: string | null;
  amount_requires_doubt?: boolean;
  acceptable_amounts?: string[];
  direction: OneOrMany<'in' | 'out' | null>;
  payment_method: OneOrMany<string>;
  scope: OneOrMany<string>;
  category?: OneOrMany<string>;
  counterparty?: string;
}

export interface ExpectedText {
  intent: OneOrMany<string>;
  request?: string;
  operations: ExpectedTextOperation[];
  correction?: { amount?: string; void?: boolean; payment_method?: string };
}

const oneOf = <T>(expected: OneOrMany<T> | undefined, actual: T): boolean =>
  expected === undefined ||
  (Array.isArray(expected) ? expected.includes(actual) : expected === actual);

/** The operation would be registered with this amount and no clarification. */
export const silentAmount = confidentTextAmount;

export interface TextScore {
  correct: boolean;
  intentOk: boolean;
  invented: number;
  /** Codes of what did not match (for the report). */
  problems: string[];
}

function scoreOperation(actual: TextOperation, expected: ExpectedTextOperation): string[] {
  const problems: string[] = [];
  const silent = silentAmount(actual);
  if (expected.amount_requires_doubt) {
    if (silent !== null) problems.push('amount_should_doubt');
  } else if (expected.amount === null) {
    if (actual.amount !== null) problems.push('amount_should_be_null');
  } else if (silent !== expected.amount) {
    problems.push(actual.amount === expected.amount ? 'amount_low_confidence' : 'amount');
  }
  if (!oneOf(expected.direction, actual.direction)) problems.push('direction');
  if (!oneOf(expected.payment_method, actual.payment_method)) problems.push('payment_method');
  if (!oneOf(expected.scope, actual.scope)) problems.push('scope');
  if (!oneOf(expected.category, actual.suggested_category ?? 'null')) problems.push('category');
  if (
    expected.counterparty &&
    !(actual.counterparty_name ?? '').toLowerCase().includes(expected.counterparty.toLowerCase())
  ) {
    problems.push('counterparty');
  }
  return problems;
}

function inventedAmount(op: TextOperation, acceptable: (string | null)[]): boolean {
  const silent = silentAmount(op);
  return silent !== null && !acceptable.includes(silent);
}

export function scoreText(actual: TextInterpretation, expected: ExpectedText): TextScore {
  const problems: string[] = [];
  const intentOk = oneOf(expected.intent, actual.intent);
  if (!intentOk) problems.push(`intent:${actual.intent}`);
  if (expected.request !== undefined && actual.request !== expected.request) {
    problems.push(`request:${actual.request}`);
  }
  if (actual.operations.length !== expected.operations.length) {
    problems.push(`operations:${actual.operations.length}/${expected.operations.length}`);
  }
  const acceptable = expected.operations.flatMap((e) => [
    e.amount,
    ...(e.acceptable_amounts ?? []),
  ]);
  let invented = 0;
  const remaining = [...expected.operations];
  for (const op of actual.operations) {
    if (inventedAmount(op, acceptable)) invented += 1;
    const index = remaining.findIndex((e) => scoreOperation(op, e).length === 0);
    if (index >= 0) {
      remaining.splice(index, 1);
    } else if (remaining[0]) {
      problems.push(...scoreOperation(op, remaining[0]).map((p) => `op:${p}`));
      remaining.shift();
    }
  }
  if (expected.correction) {
    const c = actual.correction;
    if (!c) problems.push('correction_missing');
    else {
      if (expected.correction.amount !== undefined && c.amount !== expected.correction.amount) {
        problems.push('correction_amount');
      }
      if (expected.correction.void !== undefined && c.void !== expected.correction.void) {
        problems.push('correction_void');
      }
      if (
        expected.correction.payment_method !== undefined &&
        c.payment_method !== expected.correction.payment_method
      ) {
        problems.push('correction_payment_method');
      }
    }
  }
  return { correct: problems.length === 0, intentOk, invented, problems };
}

// ---------------------------------------------------------------------------
// Close replies
// ---------------------------------------------------------------------------

export interface ExpectedCloseAnswer {
  number: number;
  resolved: boolean;
  value?: Record<string, unknown>;
}

export interface ExpectedNewEntry {
  amount: string;
  direction: 'in' | 'out';
  category: string[];
  payment_method: string;
}

export interface CloseReplyItem {
  id: string;
  case: string;
  questions: CloseQuestion[];
  reply: string;
  expected: { answers: ExpectedCloseAnswer[]; new_entries: ExpectedNewEntry[] };
}

export function scoreCloseReply(
  actual: CloseReplyInterpretation,
  expected: CloseReplyItem['expected'],
  questions: CloseQuestion[],
): TextScore {
  const problems: string[] = [];
  let invented = 0;
  for (const q of questions) {
    const exp = expected.answers.find((a) => a.number === q.number);
    const act = actual.answers.find((a) => a.number === q.number);
    const resolvedValue = act?.resolved === true ? (act.value as Record<string, unknown>) : null;
    if (!exp?.resolved) {
      if (resolvedValue) {
        problems.push(`q${q.number}:should_be_unresolved`);
        if (resolvedValue.amount) invented += 1;
      }
      continue;
    }
    if (!resolvedValue) {
      problems.push(`q${q.number}:unresolved`);
      continue;
    }
    for (const [key, value] of Object.entries(exp.value ?? {})) {
      const got = resolvedValue[key];
      if (got !== value) {
        problems.push(`q${q.number}:${key}`);
        if (key === 'amount' && got) invented += 1;
      }
    }
  }
  const remaining = [...expected.new_entries];
  for (const entry of actual.new_entries) {
    const index = remaining.findIndex(
      (e) =>
        e.amount === entry.amount &&
        e.direction === entry.direction &&
        e.category.includes(entry.category) &&
        e.payment_method === entry.payment_method,
    );
    if (index >= 0) remaining.splice(index, 1);
    else {
      problems.push('new_entry_unexpected');
      if (!expected.new_entries.some((e) => e.amount === entry.amount)) invented += 1;
    }
  }
  if (remaining.length > 0) problems.push(`new_entries_missing:${remaining.length}`);
  return { correct: problems.length === 0, intentOk: true, invented, problems };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface Ratio {
  ok: number;
  total: number;
}

export const ratio = (ok: number, total: number): Ratio => ({ ok, total });

export function pct(r: Ratio): string {
  return r.total === 0 ? 'n/a' : `${((100 * r.ok) / r.total).toFixed(1)} %`;
}

export interface MetricRow {
  measure: string;
  threshold: string;
  value: Ratio;
  /** True when lower is better (invented amounts). */
  lowerIsBetter?: boolean;
  limit: number;
}

export function passes(row: MetricRow): boolean | null {
  if (row.value.total === 0) return null;
  const v = row.value.ok / row.value.total;
  return row.lowerIsBetter ? v <= row.limit : v >= row.limit;
}

export function formatTable(rows: MetricRow[]): string {
  const lines = [
    '| Medida | Umbral | Resultado | n | Pasa |',
    '|---|---|---|---|---|',
    ...rows.map((r) => {
      const ok = passes(r);
      return `| ${r.measure} | ${r.threshold} | ${pct(r.value)} | ${r.value.ok}/${r.value.total} | ${ok === null ? '—' : ok ? 'sí' : 'NO'} |`;
    }),
  ];
  return lines.join('\n');
}
