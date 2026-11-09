import { randomBytes, randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestDb, hasTestDb, testEncryptionKey } from '../../test/db.js';
import { accessLinks, mediaFiles, reports, waitlistSignups } from '../db/schema.js';
import { DAY_MS, limaInstant } from '../domain/index.js';
import { PostgresBlobStorage } from '../storage/postgres-blob-storage.js';
import { deletedMediaKey, isMediaOriginalDeleted, runRetentionCleanup } from './retention.js';
import { createActiveUser, uniquePhone } from './test-support.js';

const NOW = limaInstant('2026-12-15', 3);

describe.skipIf(!hasTestDb)('03:00 retention cleanup (14.2, PR07, D52)', () => {
  const { pool, db } = createTestDb();
  const storage = new PostgresBlobStorage(db, testEncryptionKey());
  afterAll(async () => {
    await pool.end();
  });

  async function storedMedia(userId: string, createdAt: Date) {
    const sha256 = randomBytes(32).toString('hex');
    const storageKey = `media/${userId}/${sha256}`;
    await storage.put(storageKey, Buffer.from('fake image bytes'), { contentType: 'image/jpeg' });
    const [row] = await db
      .insert(mediaFiles)
      .values({
        userId,
        sha256,
        mimeType: 'image/jpeg',
        storageKey,
        deleteAfter: new Date(createdAt.getTime() + 30 * DAY_MS),
        createdAt,
      })
      .returning();
    if (!row) throw new Error('no media');
    return row;
  }

  it('PR07: deletes originals older than 30 days and keeps their record', async () => {
    const userId = await createActiveUser(db, { consentAt: limaInstant('2026-10-01', 9) });
    const old = await storedMedia(userId, new Date(NOW.getTime() - 31 * DAY_MS));
    const recent = await storedMedia(userId, new Date(NOW.getTime() - 29 * DAY_MS));

    const summary = await runRetentionCleanup({ db, storage }, NOW, { userIds: [userId] });
    expect(summary.mediaOriginalsDeleted).toBe(1);

    expect(await storage.get(old.storageKey)).toBeNull();
    expect(await storage.get(recent.storageKey)).not.toBeNull();
    const [kept] = await db.select().from(mediaFiles).where(eq(mediaFiles.id, old.id));
    expect(kept).toMatchObject({
      sha256: old.sha256,
      mimeType: 'image/jpeg',
      storageKey: deletedMediaKey(old.storageKey),
    });
    expect(kept && isMediaOriginalDeleted(kept)).toBe(true);
    expect(isMediaOriginalDeleted(recent)).toBe(false);

    // Idempotent; the recent one goes once its 30 days pass.
    const again = await runRetentionCleanup({ db, storage }, NOW, { userIds: [userId] });
    expect(again.mediaOriginalsDeleted).toBe(0);
    const later = await runRetentionCleanup({ db, storage }, new Date(NOW.getTime() + 2 * DAY_MS), {
      userIds: [userId],
    });
    expect(later.mediaOriginalsDeleted).toBe(1);
  });

  it('deletes expired access links only', async () => {
    const userId = await createActiveUser(db, { consentAt: limaInstant('2026-10-01', 9) });
    const link = (expiresAt: Date) => ({
      userId,
      tokenHash: randomBytes(32).toString('hex'),
      type: 'access' as const,
      expiresAt,
    });
    const rows = await db
      .insert(accessLinks)
      .values([link(new Date(NOW.getTime() - 1)), link(new Date(NOW.getTime() + DAY_MS))])
      .returning({ id: accessLinks.id, expiresAt: accessLinks.expiresAt });

    const summary = await runRetentionCleanup({ db, storage }, NOW, { userIds: [userId] });
    expect(summary.accessLinksDeleted).toBe(1);
    const left = await db
      .select({ id: accessLinks.id })
      .from(accessLinks)
      .where(eq(accessLinks.userId, userId));
    expect(left.map((row) => row.id)).toEqual([rows[1]?.id]);
  });

  it('D52: deletes waitlist signups older than 6 months', async () => {
    const signup = (createdAt: Date) => ({
      phoneE164: uniquePhone(),
      name: `Prueba ${randomUUID().slice(0, 6)}`,
      consentVersion: 'v1',
      createdAt,
    });
    const rows = await db
      .insert(waitlistSignups)
      .values([signup(limaInstant('2026-06-14', 23)), signup(limaInstant('2026-06-15', 4))])
      .returning({ id: waitlistSignups.id });
    const ids = rows.map((row) => row.id);

    // Without its ids in the scope, a scoped run leaves the waitlist alone.
    const scopedOut = await runRetentionCleanup({ db, storage }, NOW, { userIds: [] });
    expect(scopedOut.waitlistSignupsDeleted).toBe(0);

    const summary = await runRetentionCleanup({ db, storage }, NOW, { waitlistIds: ids });
    expect(summary.waitlistSignupsDeleted).toBe(1);
    const left = await db
      .select({ id: waitlistSignups.id })
      .from(waitlistSignups)
      .where(inArray(waitlistSignups.id, ids));
    expect(left.map((row) => row.id)).toEqual([ids[1]]);
  });
  it('deletes the files of reports older than 7 days and keeps the row (unscoped runs only)', async () => {
    const userId = await createActiveUser(db, { consentAt: limaInstant('1999-12-01', 9) });
    const keys = [
      `reports/${userId}/${randomUUID()}.pdf`,
      `reports/${userId}/${randomUUID()}.xlsx`,
    ];
    for (const key of keys) await storage.put(key, Buffer.from('report bytes'));
    // In the year 2000, where no other test has data: an unscoped run touches only this row.
    const [report] = await db
      .insert(reports)
      .values({
        userId,
        period: '4_weeks',
        pdfStorageKey: keys[0],
        xlsxStorageKey: keys[1],
        createdAt: limaInstant('2000-01-01', 10),
      })
      .returning({ id: reports.id });
    const now = limaInstant('2000-01-09', 3);

    expect(
      (await runRetentionCleanup({ db, storage }, now, { userIds: [userId] })).reportsExpired,
    ).toBe(0);
    const summary = await runRetentionCleanup({ db, storage }, now);
    expect(summary.reportsExpired).toBe(1);
    for (const key of keys) expect(await storage.get(key)).toBeNull();
    const [kept] = await db
      .select()
      .from(reports)
      .where(eq(reports.id, report?.id ?? ''));
    expect(kept).toMatchObject({ pdfStorageKey: null, xlsxStorageKey: null });

    expect((await runRetentionCleanup({ db, storage }, now)).reportsExpired).toBe(0);
  });
});
