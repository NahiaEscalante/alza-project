import { afterAll, describe, expect, it } from 'vitest';
import { createTestDb, hasTestDb } from '../../test/db.js';
import { ledgerEntries } from '../db/schema.js';
import { limaInstant, pointsDeadline } from '../domain/index.js';
import { finalizeDueCloses } from '../jobs/finalize-closes.js';
import { createActiveUser, recordClose } from '../jobs/test-support.js';
import { createLogger } from '../lib/logger.js';
import { getWeekView, listDays } from './queries.js';

const MON = '2026-11-09';
const TUE = '2026-11-10';
const WED = '2026-11-11';

describe.skipIf(!hasTestDb)('day views after the 12:00 job (12.2 Movimientos)', () => {
  const { pool, db } = createTestDb();
  afterAll(async () => {
    await pool.end();
  });

  it('a day without anything keeps «Sin movimientos», even with its final no-close row', async () => {
    const userId = await createActiveUser(db, { consentAt: limaInstant('2026-11-02', 9) });
    await db.insert(ledgerEntries).values({
      userId,
      businessDay: MON,
      amountCents: 1_250,
      direction: 'in',
      paymentMethod: 'yape',
      category: 'sale',
      label: 'screenshot',
      status: 'confirmed',
      source: 'screenshot',
      createdBy: 'system',
    });
    await recordClose(db, userId, MON, 'complete');
    await recordClose(db, userId, WED, 'sent');
    // Tuesday had nothing: the job writes a final `no_close` row for it (a freeze).
    const now = pointsDeadline(WED);
    await finalizeDueCloses({ db, logger: createLogger({ level: 'silent' }) }, now, {
      userIds: [userId],
    });

    const days = await listDays(db, userId, { from: MON, to: WED }, now);
    const byDay = new Map(days.map((day) => [day.businessDay, day]));
    expect(byDay.get(TUE)).toMatchObject({ hasActivity: false, level: null, levelText: null });
    expect(byDay.get(MON)).toMatchObject({ hasActivity: true, level: 'complete' });
    // A close that was sent and never answered is still «sin cierre».
    expect(byDay.get(WED)).toMatchObject({ hasActivity: true, level: 'no_close' });

    const week = await getWeekView(db, userId, TUE, now);
    expect(week.days.find((day) => day.businessDay === TUE)).toMatchObject({ level: null });
  });
});
