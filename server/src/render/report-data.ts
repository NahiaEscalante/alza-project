/**
 * Loads one user's report (5.10, HU-14). Read-only: every query is filtered by `userId` (14.4) and
 * the figures come from the domain (11.6) through `buildReportData`, never from SQL.
 */
import { and, between, eq, min } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { dailyCloses, ledgerEntries, ledgerEntryEvents, users } from '../db/schema.js';
import type { IsoDate } from '../domain/index.js';
import { buildReportData, type ReportData, reportRange } from './report-model.js';
import type { ReportPeriod } from './report-texts.js';

/** First business day with something recorded (period «todo»). */
async function firstActiveDay(db: Db, userId: string): Promise<IsoDate | null> {
  const [[entry], [close]] = await Promise.all([
    db
      .select({ day: min(ledgerEntries.businessDay) })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.userId, userId)),
    db
      .select({ day: min(dailyCloses.businessDay) })
      .from(dailyCloses)
      .where(eq(dailyCloses.userId, userId)),
  ]);
  const days = [entry?.day, close?.day].filter((day): day is string => Boolean(day)).sort();
  return days[0] ?? null;
}

export async function loadReportData(
  db: Db,
  userId: string,
  period: ReportPeriod,
  now: Date,
): Promise<ReportData> {
  const [user] = await db
    .select({ businessName: users.businessName })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) throw new Error('User not found');

  const { from, to } = reportRange(
    period,
    now,
    period === 'all' ? await firstActiveDay(db, userId) : null,
  );
  const inPeriod = and(
    eq(ledgerEntries.userId, userId),
    between(ledgerEntries.businessDay, from, to),
  );
  const [entries, events, closes] = await Promise.all([
    db.select().from(ledgerEntries).where(inPeriod),
    db
      .select({ event: ledgerEntryEvents })
      .from(ledgerEntryEvents)
      .innerJoin(ledgerEntries, eq(ledgerEntries.id, ledgerEntryEvents.ledgerEntryId))
      .where(inPeriod),
    db
      .select()
      .from(dailyCloses)
      .where(and(eq(dailyCloses.userId, userId), between(dailyCloses.businessDay, from, to))),
  ]);

  return buildReportData({
    period,
    from,
    to,
    now,
    businessName: user.businessName,
    entries,
    events: events.map((row) => row.event),
    closes,
  });
}
