/**
 * Reads of the close flow: the day's ledger and doubts, the informative lines (RF-CI-11) and the
 * Sunday block (11.11). Totals come from the domain (11.6, 11.7), never from SQL.
 */
import {
  and,
  asc,
  between,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  ne,
  not,
  notInArray,
  type SQL,
  sql,
} from 'drizzle-orm';
import { amountToCents, confidentTextAmount, textInterpretationSchema } from '../../ai/index.js';
import {
  type Clarification,
  clarifications,
  dailyCloses,
  extractions,
  inboundMessages,
  type LedgerEntry,
  ledgerEntries,
  pointsEntries,
  streaks,
} from '../../db/schema.js';
import {
  addDays,
  buildWeeklySummary,
  businessDayEnd,
  businessDayOf,
  businessDayStart,
  compareWeeks,
  computeIndicators,
  type DeclaredTotal,
  type DeclaredTotalMethod,
  digitalShortfall,
  type IsoDate,
  LIVE_STATUSES,
  pendingWeeklySummaryWeek,
  type UnitemizedCashNotice,
  type WeeklyComparison,
  type WeeklySummary,
  weekDays,
} from '../../domain/index.js';
import { type ClarificationDetail, dayLabel, describeClarification } from '../../ledger/index.js';
import type { DbOrTx } from '../../ledger/types.js';
import {
  afterCloseLine,
  digitalShortfallLine,
  TEXT_ONLY_LINE,
  unitemizedCashLine,
} from '../../messages/close.js';
import type { CloseComposition, CloseNoticeKind } from './types.js';

/** Doubts still waiting for her (not yet in a message, or moved to the web). */
const UNRESOLVED_STATUSES = ['open', 'in_message', 'in_web'] as const;
/** Listed in Pendientes (same as `ledger/queries.ts`). */
const PENDING_LIST_STATUSES = ['open', 'in_web'] as const;
/** PR03 line: rows added from the web (or its chat) are not announced; close replies belong to their close. */
const NOT_ANNOUNCED_SOURCES = ['web', 'chat', 'close_reply'] as const;

/** Serializes the close of one user and day (the 5-minute job vs «cierre» vs her reply). */
export async function lockCloseDay(tx: DbOrTx, userId: string, day: IsoDate): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`alza:close:${userId}:${day}`}, 0))`,
  );
}

export function compositionOf(value: unknown): CloseComposition | null {
  if (!value || typeof value !== 'object') return null;
  return value as CloseComposition;
}

export async function liveEntriesOfDay(
  db: DbOrTx,
  userId: string,
  day: IsoDate,
): Promise<LedgerEntry[]> {
  return db
    .select()
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.userId, userId),
        eq(ledgerEntries.businessDay, day),
        inArray(ledgerEntries.status, LIVE_STATUSES),
      ),
    );
}

/** PR16, D39: live entries and unresolved doubts of the day. */
export async function dayActivity(
  db: DbOrTx,
  userId: string,
  day: IsoDate,
): Promise<{ entryCount: number; clarificationCount: number }> {
  // Sequential everywhere in this module: callers pass a transaction (one connection).
  const [entries] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.userId, userId),
        eq(ledgerEntries.businessDay, day),
        inArray(ledgerEntries.status, LIVE_STATUSES),
      ),
    );
  const [doubts] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(clarifications)
    .where(
      and(
        eq(clarifications.userId, userId),
        eq(clarifications.businessDay, day),
        inArray(clarifications.status, UNRESOLVED_STATUSES),
      ),
    );
  return { entryCount: entries?.n ?? 0, clarificationCount: doubts?.n ?? 0 };
}

/** A doubt with what its question needs (`describeClarification`). */
export interface DoubtRow {
  clarification: Clarification;
  entry: LedgerEntry | null;
  message: {
    type: 'image' | 'audio' | 'text' | 'interactive';
    text: string | null;
    receivedAt: Date;
  } | null;
}

export async function doubtsOfDay(
  db: DbOrTx,
  userId: string,
  day: IsoDate,
  statuses?: readonly Clarification['status'][],
): Promise<DoubtRow[]> {
  const rows = await db
    .select({
      clarification: clarifications,
      entry: ledgerEntries,
      message: {
        type: inboundMessages.type,
        text: inboundMessages.text,
        receivedAt: inboundMessages.receivedAt,
      },
    })
    .from(clarifications)
    .leftJoin(
      ledgerEntries,
      and(
        eq(ledgerEntries.id, clarifications.ledgerEntryId),
        eq(ledgerEntries.userId, clarifications.userId),
      ),
    )
    .leftJoin(
      inboundMessages,
      and(
        eq(inboundMessages.id, clarifications.inboundMessageId),
        eq(inboundMessages.userId, clarifications.userId),
      ),
    )
    .where(
      and(
        eq(clarifications.userId, userId),
        eq(clarifications.businessDay, day),
        statuses ? inArray(clarifications.status, [...statuses]) : undefined,
      ),
    )
    .orderBy(asc(clarifications.createdAt));
  return rows.map((row) => ({
    clarification: row.clarification,
    entry: row.entry,
    message: row.message?.type ? row.message : null,
  }));
}

export function doubtQuestion(row: DoubtRow): string {
  return describeClarification(row.clarification, row.entry, row.message).question;
}

/** For the tie-break of 11.8 (same priority → larger amount first). */
export function doubtAmount(row: DoubtRow): number | null {
  const detail = (row.clarification.detail ?? {}) as ClarificationDetail;
  return row.entry?.amountCents ?? detail.declaredTotalCents ?? detail.row?.amountCents ?? null;
}

/** Doubts she sees in Pendientes, other than `exclude` (the candidates of this close). */
export async function pendingCountExcept(
  db: DbOrTx,
  userId: string,
  exclude: readonly string[],
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(clarifications)
    .where(
      and(
        eq(clarifications.userId, userId),
        inArray(clarifications.status, PENDING_LIST_STATUSES),
        exclude.length > 0 ? notInArray(clarifications.id, [...exclude]) : undefined,
      ),
    );
  return row?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Informative lines (RF-CI-11, D27)
// ---------------------------------------------------------------------------

/** The latest close sent for another day (for PR03 and D27). */
export async function previousSentClose(db: DbOrTx, userId: string, day: IsoDate) {
  const [row] = await db
    .select({
      businessDay: dailyCloses.businessDay,
      sentAt: dailyCloses.sentAt,
      composition: dailyCloses.composition,
    })
    .from(dailyCloses)
    .where(
      and(
        eq(dailyCloses.userId, userId),
        ne(dailyCloses.businessDay, day),
        isNotNull(dailyCloses.sentAt),
      ),
    )
    .orderBy(desc(dailyCloses.sentAt))
    .limit(1);
  return row ?? null;
}

interface TotalOp {
  amountCents: number;
  method: DeclaredTotalMethod;
}

/** Declared day totals in one interpretation (same reading as `pipeline/text.ts`). */
function declaredTotalsIn(result: unknown): TotalOp[] {
  const parsed = textInterpretationSchema.safeParse(result);
  if (!parsed.success || parsed.data.intent !== 'record') return [];
  const totals: TotalOp[] = [];
  for (const op of parsed.data.operations) {
    if (op.scope === 'single' || op.direction === 'out') continue;
    const amount = confidentTextAmount(op);
    const amountCents = amount === null ? null : amountToCents(amount);
    if (amountCents === null) continue;
    totals.push({ amountCents, method: op.payment_method === 'cash' ? 'cash' : op.payment_method });
  }
  return totals;
}

/** Latest valid text interpretation of each message (a retried job may have saved several). */
async function interpretationsOf(
  db: DbOrTx,
  messageIds: readonly string[],
): Promise<Map<string, unknown>> {
  if (messageIds.length === 0) return new Map();
  const rows = await db
    .select({
      inboundMessageId: extractions.inboundMessageId,
      result: extractions.result,
    })
    .from(extractions)
    .where(
      and(
        inArray(extractions.inboundMessageId, [...messageIds]),
        eq(extractions.function, 'interpret_text'),
        eq(extractions.isValid, true),
      ),
    )
    .orderBy(asc(extractions.createdAt));
  const byMessage = new Map<string, unknown>();
  for (const row of rows) byMessage.set(row.inboundMessageId, row.result);
  return byMessage;
}

/**
 * Declared totals of the day (PR09, D40), read from `extractions`: texts and audios belong to
 * the day they arrived (11.1).
 */
async function declaredTotalsOfDay(
  db: DbOrTx,
  userId: string,
  day: IsoDate,
): Promise<{ messageId: string; totals: TotalOp[] }[]> {
  const messages = await db
    .select({ id: inboundMessages.id })
    .from(inboundMessages)
    .where(
      and(
        eq(inboundMessages.userId, userId),
        inArray(inboundMessages.type, ['text', 'audio']),
        gte(inboundMessages.receivedAt, businessDayStart(day)),
        lt(inboundMessages.receivedAt, businessDayEnd(day)),
      ),
    );
  const interpretations = await interpretationsOf(
    db,
    messages.map((m) => m.id),
  );
  return [...interpretations].map(([messageId, result]) => ({
    messageId,
    totals: declaredTotalsIn(result),
  }));
}

/** PR09: each unitemized cash difference of the day, with the total she said. */
async function unitemizedCashNotices(
  db: DbOrTx,
  userId: string,
  entries: readonly LedgerEntry[],
  declared: readonly { messageId: string; totals: TotalOp[] }[],
): Promise<UnitemizedCashNotice[]> {
  const unitemized = entries.filter(
    (e) =>
      e.status === 'confirmed' &&
      e.label === 'unitemized' &&
      e.paymentMethod === 'cash' &&
      e.direction === 'in' &&
      e.source !== 'close_reply',
  );
  if (unitemized.length === 0) return [];
  // Resolved «solo efectivo» doubts keep the declared total in their detail.
  const answered = await db
    .select({ ledgerEntryId: clarifications.ledgerEntryId, detail: clarifications.detail })
    .from(clarifications)
    .where(
      and(
        eq(clarifications.userId, userId),
        eq(clarifications.type, 'ambiguous_total'),
        inArray(
          clarifications.ledgerEntryId,
          unitemized.map((e) => e.id),
        ),
      ),
    );
  const notices: UnitemizedCashNotice[] = [];
  for (const entry of unitemized) {
    const fromDoubt = answered.find((row) => row.ledgerEntryId === entry.id);
    let declaredCents =
      (fromDoubt?.detail as ClarificationDetail | null)?.declaredTotalCents ?? null;
    if (declaredCents === null && entry.inboundMessageId) {
      const cash = declared
        .find((d) => d.messageId === entry.inboundMessageId)
        ?.totals.filter((t) => t.method === 'cash');
      // Only when the message said exactly one cash total: never a guess.
      if (cash?.length === 1) declaredCents = cash[0]?.amountCents ?? null;
    }
    if (declaredCents === null || declaredCents <= entry.amountCents) continue;
    notices.push({
      declaredCents,
      addedCents: entry.amountCents,
      recordedCents: declaredCents - entry.amountCents,
    });
  }
  return notices;
}

/** PR03: what she added to closed days since the previous close went out, by day. */
async function afterCloseAdds(
  db: DbOrTx,
  userId: string,
  day: IsoDate,
  since: Date | null,
): Promise<{ businessDay: IsoDate; amountCents: number }[]> {
  // When she sent it (her message), else when it was written.
  const sentAt = sql`coalesce(${inboundMessages.receivedAt}, ${ledgerEntries.createdAt})`;
  const rows = await db
    .select({ businessDay: ledgerEntries.businessDay, amountCents: ledgerEntries.amountCents })
    .from(ledgerEntries)
    .leftJoin(inboundMessages, eq(inboundMessages.id, ledgerEntries.inboundMessageId))
    .where(
      and(
        eq(ledgerEntries.userId, userId),
        eq(ledgerEntries.afterClose, true),
        eq(ledgerEntries.status, 'confirmed'),
        notInArray(ledgerEntries.source, [...NOT_ANNOUNCED_SOURCES]),
        // List rows she marked in Pendientes were added from the web too.
        not(
          and(
            eq(ledgerEntries.source, 'activity_list'),
            eq(ledgerEntries.createdBy, 'user'),
          ) as SQL,
        ),
        ne(ledgerEntries.businessDay, day),
        since ? sql`${sentAt} > ${since.toISOString()}::timestamptz` : undefined,
      ),
    );
  const byDay = new Map<IsoDate, number>();
  for (const row of rows)
    byDay.set(row.businessDay, (byDay.get(row.businessDay) ?? 0) + row.amountCents);
  return [...byDay]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([businessDay, amountCents]) => ({ businessDay, amountCents }));
}

export interface NoticeLines {
  lines: string[];
  kinds: CloseNoticeKind[];
}

/**
 * RF-CI-11 lines in the order of 12.1 (PR09, PR03, D28, D40), then D27. `securityPending` comes
 * from `hasPendingSecurityNotice`.
 */
export async function noticeLines(
  db: DbOrTx,
  input: {
    userId: string;
    day: IsoDate;
    entries: readonly LedgerEntry[];
    securityLine: string | null;
    textOnlyChanged: boolean;
    previousSentAt: Date | null;
  },
): Promise<NoticeLines> {
  const lines: string[] = [];
  const kinds: CloseNoticeKind[] = [];
  const declared = await declaredTotalsOfDay(db, input.userId, input.day);

  for (const notice of await unitemizedCashNotices(db, input.userId, input.entries, declared)) {
    lines.push(unitemizedCashLine(notice));
    if (!kinds.includes('unitemized_cash')) kinds.push('unitemized_cash');
  }
  for (const add of await afterCloseAdds(db, input.userId, input.day, input.previousSentAt)) {
    lines.push(afterCloseLine(add.amountCents, dayLabel(add.businessDay)));
    if (!kinds.includes('after_close')) kinds.push('after_close');
  }
  if (input.securityLine) {
    lines.push(input.securityLine);
    kinds.push('security');
  }
  const digitalTotals: DeclaredTotal[] = declared
    .flatMap((d) => d.totals)
    .filter((t) => t.method !== 'cash' && t.method !== 'unknown');
  const shortfall = digitalShortfall(digitalTotals, input.entries);
  if (shortfall) {
    lines.push(digitalShortfallLine(shortfall.missingCents));
    kinds.push('digital_shortfall');
  }
  if (input.textOnlyChanged) {
    lines.push(TEXT_ONLY_LINE);
    kinds.push('text_only');
  }
  return { lines, kinds };
}

/**
 * D27: the first close after she chose «solo texto» says so. Compared with the preference stored
 * with her previous close (none, or a close from before this was stored: the default, image).
 */
export function textOnlyChanged(
  summaryImage: boolean,
  previous: { composition: unknown } | null,
): boolean {
  if (summaryImage) return false;
  const before = compositionOf(previous?.composition)?.summaryImage ?? true;
  return before;
}

// ---------------------------------------------------------------------------
// Weekly summary (11.11, D11, D38, PR02)
// ---------------------------------------------------------------------------

/** Monday of the last week summarized in any of her closes. */
async function lastSummarizedWeek(db: DbOrTx, userId: string): Promise<IsoDate | null> {
  const rows = await db
    .select({ composition: dailyCloses.composition })
    .from(dailyCloses)
    .where(and(eq(dailyCloses.userId, userId), isNotNull(dailyCloses.composition)));
  let last: IsoDate | null = null;
  for (const row of rows) {
    const week = compositionOf(row.composition)?.weeklySummaryWeek ?? null;
    if (week && (last === null || week > last)) last = week;
  }
  return last;
}

export interface WeekData {
  monday: IsoDate;
  summary: WeeklySummary;
  comparison: WeeklyComparison;
  days: { businessDay: IsoDate; inCents: number }[];
}

async function summaryOf(
  db: DbOrTx,
  userId: string,
  monday: IsoDate,
  sendDay: IsoDate,
  streak: { days: number; freezesUsed: number } | null,
): Promise<{ summary: WeeklySummary; entries: LedgerEntry[] }> {
  const sunday = addDays(monday, 6);
  const entries = await db
    .select()
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.userId, userId),
        between(ledgerEntries.businessDay, monday, sunday),
        inArray(ledgerEntries.status, LIVE_STATUSES),
      ),
    );
  const closes = await db
    .select({ businessDay: dailyCloses.businessDay, level: dailyCloses.level })
    .from(dailyCloses)
    .where(and(eq(dailyCloses.userId, userId), between(dailyCloses.businessDay, monday, sunday)));
  const points = await db
    .select({ points: pointsEntries.points, createdAt: pointsEntries.createdAt })
    .from(pointsEntries)
    .where(
      and(
        eq(pointsEntries.userId, userId),
        gte(pointsEntries.createdAt, businessDayStart(monday)),
        lt(pointsEntries.createdAt, businessDayEnd(sunday)),
      ),
    );
  const summary = buildWeeklySummary({
    week: monday,
    sendDay,
    entries,
    closes,
    pointsEntries: points.map((p) => ({
      points: p.points,
      businessDay: businessDayOf(p.createdAt),
    })),
    streakDays: streak?.days ?? 0,
    freezesUsed: streak?.freezesUsed ?? 0,
  });
  return { summary, entries };
}

/** The Sunday block of this close, or null (D11: on Sunday, or the first close after one without). */
export async function weekForClose(
  db: DbOrTx,
  userId: string,
  closeDay: IsoDate,
  /** Her first business day (sign-up): days before it are not «sin cierre» (as in Fase 6). */
  sinceDay: IsoDate,
): Promise<WeekData | null> {
  const monday = pendingWeeklySummaryWeek({
    closeDay,
    lastSummaryWeekStart: await lastSummarizedWeek(db, userId),
  });
  if (monday === null) return null;
  const [streak] = await db.select().from(streaks).where(eq(streaks.userId, userId));
  const current = await summaryOf(db, userId, monday, closeDay, streak ?? null);
  const previous = await summaryOf(db, userId, addDays(monday, -7), addDays(closeDay, -7), null);
  const days = weekDays(monday).map((businessDay) => ({
    businessDay,
    inCents: computeIndicators(current.entries.filter((e) => e.businessDay === businessDay))
      .inCents,
  }));
  const levels = await db
    .select({ businessDay: dailyCloses.businessDay, level: dailyCloses.level })
    .from(dailyCloses)
    .where(
      and(
        eq(dailyCloses.userId, userId),
        between(dailyCloses.businessDay, monday, addDays(monday, 6)),
      ),
    );
  const levelOf = new Map(levels.map((row) => [row.businessDay, row.level]));
  const noCloseCount = current.summary.countedDays.filter(
    (day) => day >= sinceDay && (levelOf.get(day) ?? 'no_close') === 'no_close',
  ).length;
  return {
    monday,
    summary: { ...current.summary, noCloseCount },
    comparison: compareWeeks(current.summary, previous.summary),
    days,
  };
}
