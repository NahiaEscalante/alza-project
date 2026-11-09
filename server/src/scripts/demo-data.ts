/**
 * Demo data (Fase 7/11, 17.6): «Marta · Bodega Sol» with five weeks of history, the last 7 days
 * in detail, today in progress, and points consistent with the domain (13.1): every final day goes
 * through `applyDailyClose`, every Monday through `weeklyBonus`. Lands near the 340 points of 4.2.
 *
 * - Marta's last Tuesday is the 11.6 example: entró S/ 412, salió S/ 180, te quedó S/ 232.
 * - A partial day with «Caja sin revisar», a day without close (a freeze), a list with a payment
 *   she did not send, a possible duplicate and an outgoing payment to classify in Pendientes.
 * - One past redemption with its DEMO-XXXX code.
 *
 * Deterministic (seeded PRNG) and idempotent: re-running deletes the demo user and starts over.
 * Bulk inserts on purpose (hundreds of rows with their historical `created_at`); each entry still
 * gets its `created` event, as the ledger service would write.
 */
import { and, eq } from 'drizzle-orm';
import { demoRedemptionCode, ensureRewardsCatalog } from '../account/index.js';
import { createAccessLink, createActivationLink } from '../auth/index.js';
import type { Db } from '../db/client.js';
import {
  type Category,
  clarifications,
  consents,
  type DailyClose,
  dailyCloses,
  type LedgerEntry,
  ledgerEntries,
  ledgerEntryEvents,
  type NewLedgerEntry,
  pointsEntries,
  redemptions,
  rewards,
  streaks,
  users,
} from '../db/schema.js';
import {
  addDays,
  applyDailyClose,
  businessDayOf,
  businessDayStart,
  type CloseLevel,
  clarificationPriority,
  closeDueAt,
  daysBetween,
  expectedCashChange,
  INITIAL_STREAK,
  type IsoDate,
  isoWeekday,
  limaInstant,
  normalizeName,
  pointsBalance,
  pointsDeadline,
  type StreakState,
  weeklyBonus,
} from '../domain/index.js';
import { inTransaction, type Tx } from '../ledger/types.js';
import { CONSENT_TEXT_VERSION } from '../messages/catalog.js';

export const DEMO_PHONE = '+51999000111';
export const DEMO_HOLDER = 'Marta Quispe Huamán';
export const DEMO_BUSINESS = 'Bodega Sol';
export const DEMO_CLOSE_TIME = '21:00';
/** Days of history before today. */
export const DEMO_HISTORY_DAYS = 34;
/** 4.2: «Tienes 340. Te faltan 60 para tu kit…». */
export const DEMO_TARGET_POINTS = 340;

const CUSTOMERS = [
  'Ana Torres',
  'Rosa M.',
  'Carlos R.',
  'Luis Paredes',
  'Juana Q.',
  'Pedro Salas',
  'Milagros C.',
  'Jorge H.',
  'Sofía V.',
  'Daniel Ramos',
];
const SUPPLIERS = ['Distribuidora Sur', 'Panadería Don Lucho', 'Gloria Distribuidor'];

type DayKind =
  | 'tuesday_example'
  | 'with_list'
  | 'category_doubt'
  | 'partial_unsure'
  | 'no_close'
  | 'normal'
  | 'day_off';

/** Small deterministic PRNG (mulberry32). */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SeedDemoResult {
  userId: string;
  activationUrl: string;
  accessUrl: string;
  balance: number;
  streakDays: number;
  firstDay: IsoDate;
  entries: number;
  pending: number;
}

interface PlannedDay {
  day: IsoDate;
  kind: DayKind;
  level: CloseLevel;
  entries: NewLedgerEntry[];
}

function dayKinds(today: IsoDate): Map<IsoDate, DayKind> {
  const kinds = new Map<IsoDate, DayKind>();
  const recent = Array.from({ length: 7 }, (_, i) => addDays(today, -(i + 1)));
  const tuesday = recent.find((day) => isoWeekday(day) === 2) as IsoDate;
  kinds.set(tuesday, 'tuesday_example');
  const wanted: [DayKind, number][] = [
    ['with_list', 1],
    ['category_doubt', 2],
    ['partial_unsure', 3],
    ['no_close', 6],
  ];
  for (const [kind, preferred] of wanted) {
    for (let i = 0; i < 7; i++) {
      const day = addDays(today, -(((preferred - 1 + i) % 7) + 1));
      if (!kinds.has(day)) {
        kinds.set(day, kind);
        break;
      }
    }
  }
  return kinds;
}

export async function seedDemo(
  db: Db,
  options: { now: Date; baseUrl: string },
): Promise<SeedDemoResult> {
  const { now, baseUrl } = options;
  const today = businessDayOf(now);
  const firstDay = addDays(today, -DEMO_HISTORY_DAYS);
  const random = prng(20261110);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;
  const between = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const usedOperations = new Set<string>();
  const operationNumber = () => {
    let op: string;
    do op = String(between(10_000_000, 99_999_999));
    while (usedOperations.has(op));
    usedOperations.add(op);
    return op;
  };

  await ensureRewardsCatalog(db);

  return inTransaction(db, async (tx) => {
    await tx.delete(users).where(eq(users.phoneE164, DEMO_PHONE));
    const [user] = await tx
      .insert(users)
      .values({
        phoneE164: DEMO_PHONE,
        businessName: DEMO_BUSINESS,
        accountHolderName: DEMO_HOLDER,
        accountHolderNormalized: normalizeName(DEMO_HOLDER),
        closeTime: DEMO_CLOSE_TIME,
        summaryImage: true,
        onboardingStatus: 'complete',
        lastMessageAt: new Date(now.getTime() - 20 * 60_000),
        createdAt: new Date(businessDayStart(firstDay).getTime() + 4 * 3_600_000),
      })
      .returning();
    if (!user) throw new Error('no user');
    const userId = user.id;
    await tx.insert(consents).values({
      userId,
      textVersion: CONSENT_TEXT_VERSION,
      accepted: true,
      createdAt: user.createdAt,
    });

    // ---- Entries, day by day -------------------------------------------------------------
    const kinds = dayKinds(today);
    const base = (day: IsoDate, hour: number, minute: number) => {
      const operationAt = limaInstant(day, hour, minute);
      return {
        userId,
        businessDay: day,
        operationAt,
        createdAt: new Date(operationAt.getTime() + between(20, 90) * 1000),
        status: 'confirmed' as const,
        createdBy: 'system' as const,
      };
    };
    const digitalSale = (day: IsoDate, hour: number, minute: number, cents: number) =>
      ({
        ...base(day, hour, minute),
        amountCents: cents,
        direction: 'in',
        paymentMethod: random() < 0.75 ? 'yape' : 'plin',
        category: 'sale',
        counterparty: pick(CUSTOMERS),
        operationNumber: operationNumber(),
        label: 'screenshot',
        source: 'screenshot',
      }) satisfies NewLedgerEntry;
    const cashSale = (day: IsoDate, hour: number, minute: number, cents: number) =>
      ({
        ...base(day, hour, minute),
        amountCents: cents,
        direction: 'in',
        paymentMethod: 'cash',
        category: 'sale',
        label: 'self_reported',
        source: random() < 0.6 ? 'audio' : 'text',
      }) satisfies NewLedgerEntry;
    const payment = (
      day: IsoDate,
      hour: number,
      minute: number,
      cents: number,
      category: Category,
      method: 'yape' | 'cash',
      counterparty: string | null,
    ) =>
      ({
        ...base(day, hour, minute),
        amountCents: cents,
        direction: 'out',
        paymentMethod: method,
        category,
        counterparty,
        operationNumber: method === 'yape' ? operationNumber() : null,
        label: method === 'yape' ? 'screenshot' : 'self_reported',
        source: method === 'yape' ? 'screenshot' : 'text',
      }) satisfies NewLedgerEntry;

    const normalDay = (day: IsoDate): NewLedgerEntry[] => {
      const list: NewLedgerEntry[] = [];
      const digital = between(7, 12);
      for (let i = 0; i < digital; i++) {
        list.push(
          digitalSale(day, between(8, 20), between(0, 59), between(3, 90) * 50 /* S/1.50–45 */),
        );
      }
      const cash = between(2, 4);
      for (let i = 0; i < cash; i++) {
        list.push(cashSale(day, between(9, 20), between(0, 59), between(10, 60) * 100));
      }
      if (random() < 0.4) {
        list.push(
          payment(
            day,
            between(10, 15),
            between(0, 59),
            between(8, 20) * 1000,
            'inventory',
            'yape',
            pick(SUPPLIERS),
          ),
        );
      }
      if (random() < 0.3) {
        list.push(
          payment(day, 19, between(0, 59), between(2, 4) * 1000, 'household', 'cash', null),
        );
      }
      return list;
    };

    const planned: PlannedDay[] = [];
    let partialEvery = 0;
    for (let day = firstDay; day < today; day = addDays(day, 1)) {
      let kind = kinds.get(day) ?? 'normal';
      // Older history: a Sunday off every other week, and a partial close now and then.
      const daysAgo = daysBetween(day, today);
      if (kind === 'normal' && daysAgo > 7 && isoWeekday(day) === 7) {
        if (Math.floor(daysAgo / 14) % 2 === 0) kind = 'day_off';
      }
      let entries: NewLedgerEntry[] = [];
      let level: CloseLevel = 'complete';
      switch (kind) {
        case 'tuesday_example':
          // 11.6: Yape y Plin S/298, efectivo S/114, mercadería S/150 (Yape), casa S/30.
          entries = [
            ...[1_250, 2_000, 2_000, 4_550, 3_500, 1_200, 6_800, 2_400, 2_500, 3_600].map(
              (cents, i) => digitalSale(day, 8 + i, 15 + i * 3, cents),
            ),
            cashSale(day, 9, 5, 500),
            cashSale(day, 11, 40, 350),
            cashSale(day, 14, 5, 2_550),
            cashSale(day, 18, 30, 8_000),
            payment(day, 14, 0, 15_000, 'inventory', 'yape', 'Distribuidora Sur'),
            payment(day, 19, 45, 3_000, 'household', 'cash', null),
          ];
          break;
        case 'day_off':
          level = 'no_close';
          break;
        case 'no_close':
          entries = normalDay(day);
          level = 'no_close';
          break;
        case 'partial_unsure':
          entries = normalDay(day);
          level = 'partial';
          break;
        default:
          entries = normalDay(day);
          partialEvery += 1;
          if (kind === 'normal' && partialEvery % 6 === 0) level = 'partial';
      }
      planned.push({ day, kind, level, entries });
    }

    // Today, in progress: what she sent until now.
    const todayEntries = normalDay(today).filter(
      (entry) => (entry.operationAt as Date).getTime() <= now.getTime() - 10 * 60_000,
    );

    const allPlanned = [...planned.flatMap((p) => p.entries), ...todayEntries];
    const inserted: LedgerEntry[] = [];
    for (let i = 0; i < allPlanned.length; i += 200) {
      inserted.push(
        ...(await tx
          .insert(ledgerEntries)
          .values(
            allPlanned.slice(i, i + 200).map((entry) => ({
              ...entry,
              counterpartyNormalized: entry.counterparty ? normalizeName(entry.counterparty) : null,
            })),
          )
          .returning()),
      );
    }
    for (let i = 0; i < inserted.length; i += 200) {
      await tx.insert(ledgerEntryEvents).values(
        inserted.slice(i, i + 200).map((entry) => ({
          ledgerEntryId: entry.id,
          event: 'created' as const,
          actor: 'system:seed',
          detail: { source: entry.source, reason: 'demo' },
          createdAt: entry.createdAt,
        })),
      );
    }
    const byDay = (day: IsoDate) => inserted.filter((entry) => entry.businessDay === day);

    // ---- Doubts for Pendientes -------------------------------------------------------------
    const kindDay = (kind: DayKind) => planned.find((p) => p.kind === kind)?.day as IsoDate;
    let pending = 0;

    // Possible duplicate on the partial day: two Yapes of S/20 from Rosa M. at 3:10 p. m.
    const partialDay = kindDay('partial_unsure');
    const [dup] = await tx
      .insert(ledgerEntries)
      .values({
        ...base(partialDay, 15, 10),
        amountCents: 2_000,
        direction: 'in',
        paymentMethod: 'yape',
        category: 'sale',
        counterparty: 'Rosa M.',
        counterpartyNormalized: normalizeName('Rosa M.'),
        label: 'screenshot',
        source: 'screenshot',
        status: 'pending',
      })
      .returning();
    await tx.insert(ledgerEntries).values({
      ...base(partialDay, 15, 9),
      amountCents: 2_000,
      direction: 'in',
      paymentMethod: 'yape',
      category: 'sale',
      counterparty: 'Rosa M.',
      counterpartyNormalized: normalizeName('Rosa M.'),
      label: 'screenshot',
      source: 'screenshot',
    });
    await insertDoubt(tx, userId, partialDay, 'possible_duplicate', {
      ledgerEntryId: dup?.id ?? null,
      messageNumber: 1,
      createdAt: limaInstant(partialDay, 15, 11),
    });
    pending += 1;

    // An outgoing payment to classify (PR15), recorded as «por clasificar».
    const categoryDay = kindDay('category_doubt');
    const [unclassified] = await tx
      .insert(ledgerEntries)
      .values({
        ...base(categoryDay, 16, 30),
        amountCents: 6_000,
        direction: 'out',
        paymentMethod: 'yape',
        category: 'unclassified',
        counterparty: 'Distribuidora Sur',
        counterpartyNormalized: normalizeName('Distribuidora Sur'),
        operationNumber: operationNumber(),
        label: 'screenshot',
        source: 'screenshot',
        afterClose: true,
      })
      .returning();
    await insertDoubt(tx, userId, categoryDay, 'category', {
      ledgerEntryId: unclassified?.id ?? null,
      createdAt: limaInstant(categoryDay, 21, 40),
    });
    pending += 1;

    // A row of her activity list that she never sent (D10: never added by ALZA).
    const listDay = kindDay('with_list');
    await insertDoubt(tx, userId, listDay, 'missing_from_list', {
      detail: {
        row: {
          amountCents: 1_500,
          direction: 'in',
          paymentMethod: 'yape',
          counterparty: 'Ana T.',
          operationNumber: operationNumber(),
          operationAt: limaInstant(listDay, 16, 20).toISOString(),
        },
      },
      createdAt: limaInstant(listDay, 20, 50),
    });
    pending += 1;

    // ---- Closes, points and streak (13.1) --------------------------------------------------
    let streak: StreakState = { ...INITIAL_STREAK };
    const points: { type: string; points: number; createdAt: Date; referenceId: string | null }[] =
      [];
    const levelsByDay = new Map<IsoDate, CloseLevel>();
    for (const plan of planned) {
      const deadline = pointsDeadline(plan.day);
      const isFinal = deadline.getTime() <= now.getTime();
      const entries = byDay(plan.day);
      let close: DailyClose | undefined;
      if (entries.length > 0) {
        const sentAt = closeDueAt(plan.day, DEMO_CLOSE_TIME);
        const replied = plan.level !== 'no_close';
        [close] = await tx
          .insert(dailyCloses)
          .values({
            userId,
            businessDay: plan.day,
            status: isFinal ? 'final' : replied ? 'replied' : 'sent',
            sentAt,
            repliedAt: replied ? new Date(sentAt.getTime() + between(2, 9) * 60_000) : null,
            finalAt: isFinal ? deadline : null,
            expectedCashChangeCents: expectedCashChange(entries),
            cashCheck: replied
              ? plan.level === 'partial' && plan.kind === 'partial_unsure'
                ? 'unsure'
                : 'balanced'
              : isFinal
                ? 'no_answer'
                : null,
            level: replied || isFinal ? plan.level : null,
            createdAt: businessDayStart(plan.day),
          })
          .returning();
      }
      if (!isFinal) continue;
      levelsByDay.set(plan.day, plan.level);
      const result = applyDailyClose(streak, plan.day, plan.level);
      streak = result.state;
      for (const award of result.awards) {
        points.push({ ...award, createdAt: deadline, referenceId: close?.id ?? null });
      }
    }
    // Monday 12:00: weekly bonus for the previous full week.
    for (let monday = addDays(firstDay, 7); monday <= today; monday = addDays(monday, 1)) {
      if (isoWeekday(monday) !== 1) continue;
      const at = limaInstant(monday, 12, 0);
      if (at.getTime() > now.getTime()) continue;
      const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i - 7));
      if (week[0] && week[0] < firstDay) continue;
      const bonus = weeklyBonus(week.map((day) => levelsByDay.get(day) ?? 'no_close'));
      if (bonus) points.push({ ...bonus, createdAt: at, referenceId: null });
    }

    // Past redemptions with their codes, chosen so the balance lands near 4.2's 340 points.
    const earned = pointsBalance(points);
    const regular = await tx
      .select()
      .from(rewards)
      .where(and(eq(rewards.isExample, true), eq(rewards.isBig, false), eq(rewards.active, true)));
    const options: (typeof regular)[] = [[], ...regular.map((r) => [r])];
    for (const a of regular) for (const b of regular) if (a.id < b.id) options.push([a, b]);
    const cost = (list: typeof regular) => list.reduce((sum, r) => sum + r.costPoints, 0);
    const chosen = options
      .filter((list) => earned - cost(list) >= 0)
      .sort(
        (a, b) =>
          Math.abs(earned - cost(a) - DEMO_TARGET_POINTS) -
            Math.abs(earned - cost(b) - DEMO_TARGET_POINTS) || a.length - b.length,
      )[0];
    for (const [i, reward] of (chosen ?? []).entries()) {
      const at = limaInstant(addDays(today, -10 - 7 * i), 20, 15);
      const [redemption] = await tx
        .insert(redemptions)
        .values({
          userId,
          rewardId: reward.id,
          points: reward.costPoints,
          status: 'delivered',
          code: demoRedemptionCode(),
          createdAt: at,
        })
        .returning();
      points.push({
        type: 'redemption',
        points: -reward.costPoints,
        createdAt: at,
        referenceId: redemption?.id ?? null,
      });
    }
    if (points.length > 0) {
      await tx.insert(pointsEntries).values(
        points.map((entry) => ({
          userId,
          type: entry.type as (typeof pointsEntries.$inferInsert)['type'],
          points: entry.points,
          referenceId: entry.referenceId,
          createdAt: entry.createdAt,
        })),
      );
    }
    await tx.insert(streaks).values({
      userId,
      days: streak.days,
      isoWeek: streak.isoWeek ?? '',
      freezesUsed: streak.freezesUsed,
      firstStreakAwarded: streak.firstStreakAwarded,
    });

    const activation = await createActivationLink(tx, userId, { baseUrl, now });
    const access = await createAccessLink(tx, userId, { baseUrl, now });
    return {
      userId,
      activationUrl: activation.url,
      accessUrl: access.url,
      balance: pointsBalance(points),
      streakDays: streak.days,
      firstDay,
      entries: inserted.length + 3,
      pending,
    };
  });
}

async function insertDoubt(
  tx: Tx,
  userId: string,
  businessDay: IsoDate,
  type: 'possible_duplicate' | 'category' | 'missing_from_list',
  values: {
    ledgerEntryId?: string | null;
    messageNumber?: number;
    detail?: unknown;
    createdAt: Date;
  },
): Promise<void> {
  await tx.insert(clarifications).values({
    userId,
    businessDay,
    type,
    ledgerEntryId: values.ledgerEntryId ?? null,
    priority: clarificationPriority(type),
    status: 'in_web',
    messageNumber: values.messageNumber ?? null,
    detail: values.detail ?? null,
    createdAt: values.createdAt,
  });
}
