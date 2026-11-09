/**
 * Builders for the Fase 6 database tests. Unique data per test (the test database is shared), and
 * every run is scoped to the test's own users.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  consents,
  type DailyClose,
  dailyCloses,
  pointsEntries,
  streaks,
  users,
} from '../db/schema.js';
import {
  closeDueAt,
  type IsoDate,
  MINUTE_MS,
  normalizeName,
  pointsDeadline,
} from '../domain/index.js';

export function uniquePhone(): string {
  return `+519${String(randomBytes(4).readUInt32BE()).padStart(10, '0').slice(-8)}`;
}

export function uniqueHolder(): string {
  return `Titular Prueba ${randomUUID().slice(0, 8)}`;
}

/** An active user (onboarding complete, consent accepted at `consentAt`). */
export async function createActiveUser(
  db: Db,
  options: { consentAt: Date; holder?: string; onboarding?: 'complete' | 'close_time' } = {
    consentAt: new Date('2026-01-01T12:00:00Z'),
  },
): Promise<string> {
  const holder = options.holder ?? uniqueHolder();
  const [user] = await db
    .insert(users)
    .values({
      phoneE164: uniquePhone(),
      businessName: 'Bodega de prueba',
      accountHolderName: holder,
      accountHolderNormalized: normalizeName(holder),
      closeTime: '21:00',
      onboardingStatus: options.onboarding ?? 'complete',
      createdAt: options.consentAt,
    })
    .returning({ id: users.id });
  if (!user) throw new Error('no user');
  await db
    .insert(consents)
    .values({ userId: user.id, textVersion: 'v1', accepted: true, createdAt: options.consentAt });
  return user.id;
}

/**
 * What happened with the close of a day:
 * - `complete` / `partial`: sent at 21:00, answered 5 minutes later, level stored by the flow;
 * - `sent`: sent, never answered;
 * - `awaiting`: answered, waiting for a clarification, level so far `partial`;
 * - `late`: sent, answered after the deadline with a complete level (case 20, missed run).
 */
export type DayScript = 'complete' | 'partial' | 'sent' | 'awaiting' | 'late';

export async function recordClose(
  db: Db,
  userId: string,
  day: IsoDate,
  script: DayScript,
): Promise<DailyClose> {
  const sentAt = closeDueAt(day, '21:00');
  const replied = new Date(sentAt.getTime() + 5 * MINUTE_MS);
  const scripts: Record<
    DayScript,
    Pick<DailyClose, 'status' | 'repliedAt' | 'level' | 'cashCheck'>
  > = {
    complete: { status: 'replied', repliedAt: replied, level: 'complete', cashCheck: 'balanced' },
    partial: { status: 'replied', repliedAt: replied, level: 'partial', cashCheck: 'unsure' },
    sent: { status: 'sent', repliedAt: null, level: null, cashCheck: null },
    awaiting: {
      status: 'awaiting_clarification',
      repliedAt: replied,
      level: 'partial',
      cashCheck: 'balanced',
    },
    late: {
      status: 'replied',
      repliedAt: new Date(pointsDeadline(day).getTime() + 30 * MINUTE_MS),
      level: 'complete',
      cashCheck: 'balanced',
    },
  };
  const [close] = await db
    .insert(dailyCloses)
    .values({ userId, businessDay: day, sentAt, ...scripts[script] })
    .returning();
  if (!close) throw new Error('no close');
  return close;
}

export async function getClose(
  db: Db,
  userId: string,
  day: IsoDate,
): Promise<DailyClose | undefined> {
  const [close] = await db
    .select()
    .from(dailyCloses)
    .where(and(eq(dailyCloses.userId, userId), eq(dailyCloses.businessDay, day)));
  return close;
}

export async function getPoints(db: Db, userId: string) {
  return db
    .select({
      type: pointsEntries.type,
      points: pointsEntries.points,
      referenceId: pointsEntries.referenceId,
      createdAt: pointsEntries.createdAt,
    })
    .from(pointsEntries)
    .where(eq(pointsEntries.userId, userId))
    .orderBy(pointsEntries.createdAt, pointsEntries.type);
}

export async function getStreak(db: Db, userId: string) {
  const [streak] = await db.select().from(streaks).where(eq(streaks.userId, userId));
  return streak;
}

export const total = (rows: readonly { points: number }[]): number =>
  rows.reduce((sum, row) => sum + row.points, 0);
