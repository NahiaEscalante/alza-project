import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, hasTestDb } from '../../test/db.js';
import { dailyCloses, users } from '../db/schema.js';
import { addDays, businessDayOf, limaInstant, weekStart } from '../domain/index.js';
import { correctEntry, createEntry, voidEntry, WEB_USER } from '../ledger/index.js';
import type { Actor } from '../ledger/types.js';
import { loadReportData } from './report-data.js';
import { renderReportPdf } from './report-pdf.js';
import { renderReportXlsx } from './report-xlsx.js';

const PIPELINE: Actor = { kind: 'system', channel: 'pipeline' };
const phone = () => `+519${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;

describe.skipIf(!hasTestDb)('loadReportData (HU-14)', () => {
  const { pool, db } = createTestDb();
  const now = new Date();
  const today = businessDayOf(now);
  const day1 = addDays(today, -3);
  const day2 = addDays(today, -2);
  let userId = '';
  let otherId = '';
  let screenshotId = '';

  beforeAll(async () => {
    const [user] = await db
      .insert(users)
      .values({ phoneE164: phone(), businessName: 'Bodega Prueba', onboardingStatus: 'complete' })
      .returning();
    const [other] = await db
      .insert(users)
      .values({ phoneE164: phone(), businessName: 'Otra bodega', onboardingStatus: 'complete' })
      .returning();
    userId = user?.id ?? '';
    otherId = other?.id ?? '';

    const screenshot = await createEntry(
      db,
      {
        userId,
        businessDay: day1,
        amountCents: 1_200,
        direction: 'in',
        paymentMethod: 'yape',
        category: 'sale',
        label: 'screenshot',
        source: 'screenshot',
        counterparty: 'Rosa María Quispe',
        operationAt: limaInstant(day1, 11, 42),
      },
      PIPELINE,
    );
    screenshotId = screenshot.id;
    await createEntry(
      db,
      {
        userId,
        businessDay: day1,
        amountCents: 11_400,
        direction: 'in',
        paymentMethod: 'cash',
        category: 'sale',
        label: 'self_reported',
        source: 'text',
      },
      PIPELINE,
    );
    const removed = await createEntry(
      db,
      {
        userId,
        businessDay: day2,
        amountCents: 3_000,
        direction: 'out',
        paymentMethod: 'cash',
        category: 'household',
        label: 'self_reported',
        source: 'audio',
      },
      PIPELINE,
    );
    await createEntry(
      db,
      {
        userId: otherId,
        businessDay: day1,
        amountCents: 77_700,
        direction: 'in',
        paymentMethod: 'plin',
        category: 'sale',
        label: 'screenshot',
        source: 'screenshot',
        counterparty: 'Cliente de otra',
      },
      PIPELINE,
    );
    // HU-13: S/ 12 with screenshot corrected to S/ 120 from the web.
    await correctEntry(db, {
      userId,
      entryId: screenshot.id,
      patch: { amountCents: 12_000 },
      actor: WEB_USER,
      now,
      reason: 'web_correction',
    });
    await voidEntry(db, { userId, entryId: removed.id, actor: WEB_USER, now, reason: 'web_void' });
    await db.insert(dailyCloses).values({
      userId,
      businessDay: day1,
      status: 'final',
      sentAt: limaInstant(day1, 21),
      repliedAt: limaInstant(day1, 21, 30),
      cashCheck: 'unsure',
      level: 'partial',
      expectedCashChangeCents: 11_400,
    });
  });

  afterAll(() => pool.end());

  it('loads the period with totals, tags, changes and both versions of a correction', async () => {
    const data = await loadReportData(db, userId, '4_weeks', now);
    expect(data.businessName).toBe('Bodega Prueba');
    expect(data.from).toBe(addDays(weekStart(today), -21));
    expect(data.to).toBe(today);
    expect(data.totals.inCents).toBe(12_000 + 11_400);
    expect(data.totals.outCents).toBe(0);
    expect(data.entries).toHaveLength(2);
    expect(data.entries.map((e) => e.counterpartyInitials)).toContain('R. M.');
    expect(JSON.stringify(data)).not.toContain('Rosa');

    const day = data.days.find((d) => d.businessDay === day1);
    expect(day).toMatchObject({ levelText: 'a medias', cashUnreviewed: true });
    expect(day?.tags).toContain('Caja sin revisar');

    expect(data.trace.map((t) => t.statusText).sort()).toEqual([
      'Confirmado',
      'Confirmado',
      'Quitado',
      'Reemplazado',
    ]);
    const correction = data.changes.find((c) => c.kind === 'correction');
    expect(correction).toMatchObject({
      before: 'S/ 12 · Venta',
      after: 'S/ 120 · Venta',
      actorText: 'Tú, en la web',
    });
    expect(data.trace.find((t) => t.replacedByRef)?.history).toContain(
      'Reemplazado (Tú, en la web)',
    );
    expect(data.changes.find((c) => c.kind === 'voided')?.before).toBe('S/ 30 · Para la casa');
    expect(data.trace.some((t) => t.ref.length === 8)).toBe(true);
    expect(screenshotId).not.toBe('');
  });

  it('never includes another user (14.4)', async () => {
    const data = await loadReportData(db, userId, 'all', now);
    expect(data.from).toBe(day1);
    expect(JSON.stringify(data)).not.toContain('Cliente de otra');
    expect(data.totals.inCents).toBe(23_400);
    const other = await loadReportData(db, otherId, 'all', now);
    expect(other.totals.inCents).toBe(77_700);
    expect(other.trace).toHaveLength(1);
  });

  it('feeds the PDF and the Excel', async () => {
    const data = await loadReportData(db, userId, '12_weeks', now);
    const [pdf, xlsx] = await Promise.all([renderReportPdf(data), renderReportXlsx(data)]);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(xlsx.subarray(0, 2).toString()).toBe('PK');
  });
});
