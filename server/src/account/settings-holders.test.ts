import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestDb, hasTestDb } from '../../test/db.js';
import { HOLDER_CONFLICT_ALERT } from '../antifraud/rules.js';
import { alerts } from '../db/schema.js';
import { limaInstant } from '../domain/index.js';
import { createActiveUser, uniqueHolder } from '../jobs/test-support.js';
import { updateSettings } from './settings.js';

describe.skipIf(!hasTestDb)('additional holders and antifraud (D31, 13.4, case 22)', () => {
  const { pool, db } = createTestDb();
  afterAll(async () => {
    await pool.end();
  });

  const holderAlerts = (userId: string) =>
    db
      .select()
      .from(alerts)
      .where(and(eq(alerts.userId, userId), eq(alerts.type, HOLDER_CONFLICT_ALERT)));

  it('saves a holder another account has, and raises one alert for the panel', async () => {
    const consentAt = limaInstant('2026-11-02', 9);
    const taken = uniqueHolder();
    const owner = await createActiveUser(db, { consentAt, holder: taken });
    const userId = await createActiveUser(db, { consentAt });
    const now = limaInstant('2026-11-10', 20);

    const view = await updateSettings(db, userId, { additionalHolders: [taken] }, { now });
    expect(view.additionalHolders.map((holder) => holder.name)).toEqual([taken]);
    const [alert] = await holderAlerts(userId);
    expect(alert).toMatchObject({ status: 'open', createdAt: now });
    expect(alert?.detail).toMatchObject({ conflictingUserIds: [owner] });

    // Saving again (holder kept) or adding a fresh one does not raise more alerts.
    await updateSettings(db, userId, { additionalHolders: [taken, uniqueHolder()] }, { now });
    expect(await holderAlerts(userId)).toHaveLength(1);
    expect(await holderAlerts(owner)).toHaveLength(0);
  });
});
