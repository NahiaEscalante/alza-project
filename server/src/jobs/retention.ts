/**
 * Daily 03:00 (8.4, 14.2, PR07, RF-PV-02, D52): retention cleanup.
 *
 * - Original images and audios older than 30 days (`media_files.delete_after`) are deleted from
 *   storage. The `media_files` row stays as «the record that they existed» (PR07): user, SHA-256
 *   (duplicates 11.4 and antifraud 13.4 keep working), type and date. The table has no «deleted»
 *   column, so the row is marked by moving `storage_key` under `deleted/` (a key that never holds
 *   bytes): `isMediaOriginalDeleted()` reads it. Extractions and ledger entries are untouched.
 * - Expired access links (activation and 7-day links) are deleted.
 * - Waitlist signups older than 6 months are deleted (D52).
 *
 * Idempotent: a second run finds nothing to do. Storage first, then the row: if marking fails, the
 * next run deletes nothing more and marks it.
 */
import { and, asc, eq, gt, inArray, like, lt, lte, not } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { accessLinks, type MediaFile, mediaFiles, waitlistSignups } from '../db/schema.js';
import type { BlobStorage } from '../storage/blob-storage.js';
import { userScope } from './active-users.js';
import { monthsBefore } from './calendar.js';
import type { JobScope } from './types.js';

export const DELETED_MEDIA_KEY_PREFIX = 'deleted/';
/** D52: «hasta 6 meses». */
export const WAITLIST_RETENTION_MONTHS = 6;
const MEDIA_BATCH = 200;

export function deletedMediaKey(storageKey: string): string {
  return storageKey.startsWith(DELETED_MEDIA_KEY_PREFIX)
    ? storageKey
    : `${DELETED_MEDIA_KEY_PREFIX}${storageKey}`;
}

/** PR07: the original bytes are gone; only the record and its extracted data remain. */
export function isMediaOriginalDeleted(file: Pick<MediaFile, 'storageKey'>): boolean {
  return file.storageKey.startsWith(DELETED_MEDIA_KEY_PREFIX);
}

export interface RetentionSummary {
  mediaOriginalsDeleted: number;
  accessLinksDeleted: number;
  waitlistSignupsDeleted: number;
}

/** PR07: deletes the bytes of originals past `delete_after` and marks their rows. */
export async function purgeExpiredMedia(
  deps: { db: Db; storage: Pick<BlobStorage, 'delete'> },
  now: Date,
  scope?: JobScope,
): Promise<number> {
  const { db, storage } = deps;
  let purged = 0;
  // Keyset pagination by id: each row is visited once per run, whatever happens to it.
  let afterId: string | null = null;
  for (;;) {
    const batch: { id: string; storageKey: string }[] = await db
      .select({ id: mediaFiles.id, storageKey: mediaFiles.storageKey })
      .from(mediaFiles)
      .where(
        and(
          lte(mediaFiles.deleteAfter, now),
          not(like(mediaFiles.storageKey, `${DELETED_MEDIA_KEY_PREFIX}%`)),
          afterId ? gt(mediaFiles.id, afterId) : undefined,
          userScope(mediaFiles.userId, scope),
        ),
      )
      .orderBy(asc(mediaFiles.id))
      .limit(MEDIA_BATCH);
    for (const file of batch) {
      await storage.delete(file.storageKey);
      const marked = await db
        .update(mediaFiles)
        .set({ storageKey: deletedMediaKey(file.storageKey) })
        .where(and(eq(mediaFiles.id, file.id), eq(mediaFiles.storageKey, file.storageKey)))
        .returning({ id: mediaFiles.id });
      purged += marked.length;
    }
    const last = batch.at(-1);
    if (!last || batch.length < MEDIA_BATCH) return purged;
    afterId = last.id;
  }
}

/** 14.2: «Enlaces de acceso vencidos: se borran a diario». */
export async function deleteExpiredAccessLinks(
  db: Db,
  now: Date,
  scope?: JobScope,
): Promise<number> {
  const deleted = await db
    .delete(accessLinks)
    .where(and(lte(accessLinks.expiresAt, now), userScope(accessLinks.userId, scope)))
    .returning({ id: accessLinks.id });
  return deleted.length;
}

/** D52: signups older than 6 months. With a scope, only `scope.waitlistIds`. */
export async function deleteOldWaitlistSignups(
  db: Db,
  now: Date,
  scope?: JobScope,
): Promise<number> {
  if (scope && !scope.waitlistIds) return 0;
  const cutoff = monthsBefore(now, WAITLIST_RETENTION_MONTHS);
  const deleted = await db
    .delete(waitlistSignups)
    .where(
      and(
        lt(waitlistSignups.createdAt, cutoff),
        scope?.waitlistIds ? inArray(waitlistSignups.id, [...scope.waitlistIds]) : undefined,
      ),
    )
    .returning({ id: waitlistSignups.id });
  return deleted.length;
}

export async function runRetentionCleanup(
  deps: { db: Db; storage: Pick<BlobStorage, 'delete'> },
  now: Date,
  scope?: JobScope,
): Promise<RetentionSummary> {
  return {
    mediaOriginalsDeleted: await purgeExpiredMedia(deps, now, scope),
    accessLinksDeleted: await deleteExpiredAccessLinks(deps.db, now, scope),
    waitlistSignupsDeleted: await deleteOldWaitlistSignups(deps.db, now, scope),
  };
}
