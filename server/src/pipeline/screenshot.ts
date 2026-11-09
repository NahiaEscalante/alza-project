/**
 * Screenshots (4.4, RF-EX-01/02, RF-LB-03..06): from a validated reading to ledger entries and
 * doubts. Silent in every branch (D04).
 *
 * Receipt, per operation:
 * 1. Direction (11.2, D36) with her holders (principal + additional, D31). A contradiction or an
 *    unknown direction → pending + `direction` doubt (provisional direction from the holder role).
 * 2. Business day (11.1): the screenshot date; without one (or in the future) the arrival day
 *    and a `date` doubt (D53). Close already sent → `after_close` (PR03).
 * 3. Duplicates (11.4): same operation number → exact duplicate (nothing added); same amount,
 *    direction and counterparty within ±2 min without operation number → pending +
 *    `possible_duplicate`.
 * 4. A self-reported digital entry of the same payment («me yapearon 20 de Rosa») is voided:
 *    the evidence wins (D03).
 * 5. Category (11.3): incoming → sale (or her accepted «personal» rule, PR14); outgoing → her
 *    memory for that counterparty (PR14), else what the screen suggests (HU-03), else
 *    `unclassified`, confirmed, with a low-priority `category` doubt (PR15, D55).
 *
 * Activity list (11.10, D10): rows already recorded are linked (nothing added); the rest become
 * `missing_from_list` doubts for the web. ALZA never records a row by itself.
 *
 * Unreadable (HU-05, case 8): no amount is ever invented; an `unreadable` doubt.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { amountToCents } from '../ai/amount.js';
import type { ScreenshotReading } from '../ai/read-screenshot.js';
import type { ScreenshotLayout, ScreenshotOperation } from '../ai/schemas.js';
import { clarifications, type LedgerEntry, type PaymentMethod } from '../db/schema.js';
import {
  type ActivityListRow,
  businessDayOf,
  type Category,
  type CounterpartyRuleView,
  checkOperationDuplicate,
  type Direction,
  type DirectionResult,
  decideCategory,
  decideDirection,
  findMentionForScreenshot,
  normalizeName,
  normalizeOperationNumber,
  parseYapeHeader,
  reconcileActivityList,
} from '../domain/index.js';
import {
  type ClarificationDetail,
  createClarification,
  createEntry,
  type ListRowDetail,
  voidEntry,
} from '../ledger/index.js';
import type { Tx } from '../ledger/types.js';
import { combineStatuses, commitMessage, PIPELINE_ACTOR, type TerminalStatus } from './commit.js';
import {
  type CloseInfo,
  duplicateCandidates,
  liveEntriesOfDays,
  loadCloses,
  loadCounterpartyRules,
  loadHolders,
} from './context.js';
import { entryAttribution, isUniqueViolation, type MessageWork, parseInstant } from './shared.js';

/** The Yape title for a header code, when the literal title was not kept. */
function yapeTitle(op: ScreenshotOperation): string | null {
  if (parseYapeHeader(op.receipt_header_text) !== null) return op.receipt_header_text;
  if (op.receipt_header === 'yape_received') return '¡Te Yapearon!';
  if (op.receipt_header === 'yape_sent') return '¡Yapeaste!';
  return null;
}

export function directionOf(op: ScreenshotOperation, holders: readonly string[]): DirectionResult {
  return decideDirection({
    header: yapeTitle(op),
    counterpartyName: op.counterparty_name,
    visibleHolderName: op.visible_holder_name,
    holderRole: op.holder_role,
    holders,
  });
}

/** Direction stored on a pending entry while the `direction` doubt is open (never counted). */
function provisionalDirection(op: ScreenshotOperation): Direction {
  if (op.receipt_header === 'yape_sent' || op.holder_role === 'payer') return 'out';
  return 'in';
}

/**
 * The other party as the ledger shows it. On a client's phone (the screen shows a payment to her)
 * the other party is the screen's owner, not her.
 */
function counterpartyOf(op: ScreenshotOperation, direction: DirectionResult): string | null {
  if (
    direction.kind === 'resolved' &&
    (direction.rule === 'yape_sent_to_her' || direction.rule === 'client_paid_her')
  ) {
    return op.visible_holder_name;
  }
  return op.counterparty_name;
}

/** HU-03: «la contraparte lo indica» — a distributor or supplier sells merchandise. */
const SUPPLIER_NAME = /\b(distribuidora?s?|distribuciones|mayoristas?|proveedor(es|a)?)\b/;

export function suggestedCategory(
  op: ScreenshotOperation,
  counterparty: string | null,
  direction: Direction,
): Category | null {
  if (op.suggested_category) return op.suggested_category;
  if (direction === 'out' && SUPPLIER_NAME.test(normalizeName(counterparty))) return 'inventory';
  return null;
}

export async function applyScreenshot(
  work: MessageWork,
  reading: ScreenshotReading,
): Promise<TerminalStatus> {
  const { extraction } = reading;
  switch (extraction.content_type) {
    case 'individual_receipt':
      return applyReceipt(work, reading);
    case 'activity_list':
      return applyActivityList(work, reading);
    default:
      // non_financial, other_financial: ignored (case 14). supplier_invoice: no rule in the
      // spec for invoices yet (decision: kept as evidence in `extractions`, nothing recorded).
      return commitMessage(work.deps.db, work.message.id, async () => 'non_financial');
  }
}

/**
 * The payment method a screenshot shows even when its amount cannot be read: the reader's, else
 * its header («¡Te Yapearon!» is Yape), else a design that only one app uses (Yape). Kept in the
 * doubt so that the amount she gives later stays a Yape/Plin entry, not «sin detalle» (D66).
 */
export function knownMethodOf(
  op: ScreenshotOperation | null,
  layout: ScreenshotLayout | null,
): PaymentMethod | null {
  if (op && op.payment_method !== 'unknown') return op.payment_method;
  const header = op?.receipt_header ?? 'unknown';
  if (header.startsWith('yape_')) return 'yape';
  if (header.startsWith('plin_')) return 'plin';
  if (header.startsWith('bank_transfer_')) return 'bank_transfer';
  if (parseYapeHeader(op?.receipt_header_text) !== null || layout === 'yape') return 'yape';
  return null;
}

async function applyUnreadable(
  work: MessageWork,
  op: ScreenshotOperation | null,
  holders: readonly string[],
  layout: ScreenshotLayout | null,
): Promise<TerminalStatus> {
  const { deps, message, user } = work;
  const operationAt = parseInstant(op?.occurred_at);
  const closes = await loadCloses(
    deps.db,
    user.id,
    message.receivedAt,
    operationAt ? [businessDayOf(operationAt)] : [],
  );
  const attribution = entryAttribution(message.receivedAt, operationAt, closes);
  const direction = op ? directionOf(op, holders) : null;
  const paymentMethod = knownMethodOf(op, layout);
  const detail: ClarificationDetail = {
    at: (attribution.futureDateIgnored
      ? message.receivedAt
      : (operationAt ?? message.receivedAt)
    ).toISOString(),
    ...(direction?.kind === 'resolved' ? { direction: direction.direction } : {}),
    ...(paymentMethod ? { paymentMethod } : {}),
  };
  return commitMessage(deps.db, message.id, async (tx) => {
    await createClarification(tx, {
      userId: user.id,
      businessDay: attribution.businessDay,
      type: 'unreadable',
      inboundMessageId: message.id,
      detail,
    });
    return 'unreadable';
  });
}

interface ReceiptPlan {
  op: ScreenshotOperation;
  amountCents: number;
  direction: DirectionResult;
  counterparty: string | null;
  operationNumber: string | null;
  operationAt: Date | null;
}

async function applyReceipt(
  work: MessageWork,
  reading: ScreenshotReading,
): Promise<TerminalStatus> {
  const { deps, message, user } = work;
  const holders = await loadHolders(deps.db, user);
  const { extraction } = reading;
  const plans: ReceiptPlan[] = [];
  for (const op of extraction.operations) {
    const amountCents = op.amount === null ? null : amountToCents(op.amount);
    if (amountCents === null) return applyUnreadable(work, op, holders, reading.layout);
    const direction = directionOf(op, holders);
    plans.push({
      op,
      amountCents,
      direction,
      counterparty: counterpartyOf(op, direction),
      operationNumber: normalizeOperationNumber(op.operation_number),
      operationAt: parseInstant(op.occurred_at),
    });
  }
  if (!extraction.legible || plans.length === 0) {
    return applyUnreadable(work, extraction.operations[0] ?? null, holders, reading.layout);
  }

  const rules = await loadCounterpartyRules(deps.db, user.id);
  const closes = await loadCloses(
    deps.db,
    user.id,
    message.receivedAt,
    plans.flatMap((plan) => (plan.operationAt ? [businessDayOf(plan.operationAt)] : [])),
  );
  const now = deps.now();

  return commitMessage(deps.db, message.id, async (tx) => {
    const seen = await duplicateCandidates(
      tx,
      user.id,
      plans.flatMap((plan) => (plan.operationNumber ? [plan.operationNumber] : [])),
      plans.flatMap((plan) => (plan.operationAt ? [plan.operationAt] : [])),
    );
    const statuses: TerminalStatus[] = [];
    for (const plan of plans) {
      statuses.push(await recordReceiptOperation(tx, work, plan, { rules, closes, seen, now }));
    }
    return combineStatuses(statuses);
  });
}

async function recordReceiptOperation(
  tx: Tx,
  work: MessageWork,
  plan: ReceiptPlan,
  context: {
    rules: readonly CounterpartyRuleView[];
    closes: readonly CloseInfo[];
    seen: LedgerEntry[];
    now: Date;
  },
): Promise<TerminalStatus> {
  const { message, user } = work;
  const attribution = entryAttribution(message.receivedAt, plan.operationAt, context.closes);
  const businessDay = attribution.businessDay;
  const dateDoubt = plan.operationAt === null || attribution.futureDateIgnored;
  const operationAt = attribution.futureDateIgnored ? null : plan.operationAt;
  const directionDoubt = plan.direction.kind === 'clarification';
  const direction =
    plan.direction.kind === 'resolved' ? plan.direction.direction : provisionalDirection(plan.op);
  const paymentMethod = plan.op.payment_method;
  const counterpartyNormalized = normalizeName(plan.counterparty) || null;

  const duplicate = checkOperationDuplicate(
    {
      amountCents: plan.amountCents,
      direction,
      paymentMethod,
      counterpartyNormalized,
      operationNumber: plan.operationNumber,
      operationAt,
    },
    context.seen,
  );
  if (duplicate.kind === 'exact_duplicate') return 'duplicate';
  const possibleDuplicate = duplicate.kind === 'possible_duplicate';

  // D03: what she said by text is replaced by the screenshot of the same payment.
  const mention =
    directionDoubt || possibleDuplicate
      ? null
      : findMentionForScreenshot(
          {
            amountCents: plan.amountCents,
            direction,
            paymentMethod,
            counterpartyName: plan.counterparty,
            businessDay,
            operationAt,
          },
          await liveEntriesOfDays(tx, user.id, [businessDay]),
        );

  const category = directionDoubt
    ? {
        category: direction === 'in' ? ('sale' as const) : ('unclassified' as const),
        needsCategoryDoubt: false,
      }
    : decideCategory({
        direction,
        counterpartyNormalized,
        stated: null,
        suggested: suggestedCategory(plan.op, plan.counterparty, direction),
        rules: context.rules,
      });
  const pending = directionDoubt || possibleDuplicate || dateDoubt;

  let entry: LedgerEntry;
  try {
    entry = await createEntry(
      tx,
      {
        userId: user.id,
        businessDay,
        amountCents: plan.amountCents,
        direction,
        paymentMethod,
        category: category.category,
        label: 'screenshot',
        status: pending ? 'pending' : 'confirmed',
        source: 'screenshot',
        inboundMessageId: message.id,
        counterparty: plan.counterparty,
        operationNumber: plan.operationNumber,
        operationAt,
        afterClose: attribution.afterClose,
      },
      PIPELINE_ACTOR,
      'whatsapp_screenshot',
    );
  } catch (err) {
    // The same operation number arrived in parallel: the unique index keeps one (11.4).
    if (isUniqueViolation(err)) return 'duplicate';
    throw err;
  }
  context.seen.push(entry);

  if (mention) {
    await voidEntry(tx, {
      userId: user.id,
      entryId: mention.id,
      actor: PIPELINE_ACTOR,
      now: context.now,
      reason: 'replaced_by_screenshot',
    });
  }

  const doubt = (type: 'possible_duplicate' | 'direction' | 'date' | 'category', detail = {}) =>
    createClarification(tx, {
      userId: user.id,
      businessDay,
      type,
      ledgerEntryId: entry.id,
      inboundMessageId: message.id,
      detail,
    });
  if (possibleDuplicate) await doubt('possible_duplicate');
  if (directionDoubt) await doubt('direction');
  if (dateDoubt) await doubt('date', { at: message.receivedAt.toISOString() });
  if (!directionDoubt && category.needsCategoryDoubt) await doubt('category');
  return pending ? 'pending' : 'recorded';
}

// ---------------------------------------------------------------------------
// Activity list (11.10)
// ---------------------------------------------------------------------------

interface ListRow extends ActivityListRow {
  counterparty: string | null;
}

function sameListRow(a: ListRowDetail, b: ListRow): boolean {
  const numberA = normalizeOperationNumber(a.operationNumber);
  if (numberA !== null && b.operationNumber !== null) {
    return numberA === b.operationNumber && a.paymentMethod === b.paymentMethod;
  }
  return (
    a.amountCents === b.amountCents &&
    a.direction === b.direction &&
    (normalizeName(a.counterparty) || null) === b.counterpartyNormalized &&
    (a.operationAt ?? null) === (b.operationAt?.toISOString() ?? null)
  );
}

async function applyActivityList(
  work: MessageWork,
  reading: ScreenshotReading,
): Promise<TerminalStatus> {
  const { deps, message, user } = work;
  const rows: ListRow[] = reading.extraction.operations.flatMap((op) => {
    const amountCents = op.amount === null ? null : amountToCents(op.amount);
    if (amountCents === null) return [];
    return [
      {
        amountCents,
        // Her own activity list: income rows are «payee», outgoing rows «payer».
        direction: op.holder_role === 'payer' ? 'out' : 'in',
        paymentMethod: op.payment_method,
        counterparty: op.counterparty_name,
        counterpartyNormalized: normalizeName(op.counterparty_name) || null,
        operationNumber: normalizeOperationNumber(op.operation_number),
        operationAt: parseInstant(op.occurred_at),
      } satisfies ListRow,
    ];
  });
  if (rows.length === 0) {
    // Nothing readable: no doubt to ask (lists are optional, D10).
    return commitMessage(deps.db, message.id, async () => 'unreadable');
  }
  const dayOf = (row: ListRow) => businessDayOf(row.operationAt ?? message.receivedAt);

  return commitMessage(deps.db, message.id, async (tx) => {
    const byDay = await liveEntriesOfDays(tx, user.id, rows.map(dayOf));
    const byNumber = await duplicateCandidates(
      tx,
      user.id,
      rows.flatMap((row) => (row.operationNumber ? [row.operationNumber] : [])),
      [],
    );
    const entries = [...new Map([...byDay, ...byNumber].map((e) => [e.id, e])).values()];
    const reconciliation = reconcileActivityList(rows, entries);

    const known = await tx
      .select({ detail: clarifications.detail })
      .from(clarifications)
      .where(
        and(
          eq(clarifications.userId, user.id),
          eq(clarifications.type, 'missing_from_list'),
          inArray(clarifications.status, ['open', 'in_web']),
        ),
      );
    const knownRows = known.flatMap((c) => {
      const row = (c.detail as ClarificationDetail | null)?.row;
      return row ? [row] : [];
    });

    let created = 0;
    for (const row of reconciliation.missing) {
      if (knownRows.some((known) => sameListRow(known, row))) continue;
      const detail: ListRowDetail = {
        amountCents: row.amountCents,
        direction: row.direction,
        paymentMethod: row.paymentMethod,
        counterparty: row.counterparty,
        operationNumber: row.operationNumber,
        operationAt: row.operationAt?.toISOString() ?? null,
      };
      await createClarification(tx, {
        userId: user.id,
        businessDay: dayOf(row),
        type: 'missing_from_list',
        inboundMessageId: message.id,
        detail: { row: detail },
      });
      knownRows.push(detail);
      created += 1;
    }
    return created > 0 ? 'pending' : 'recorded';
  });
}
