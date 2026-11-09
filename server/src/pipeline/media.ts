/**
 * Her images and audios (RF-IN-04, 11.4, PR07): downloaded right away, stored encrypted under
 * `media/<userId>/<sha256>` with a `media_files` row, deleted after 30 days by the Fase 6 job.
 */
import { and, eq, ne } from 'drizzle-orm';
import type { Channel } from '../channel/types.js';
import type { Db } from '../db/client.js';
import { type InboundMessage, inboundMessages, type MediaFile, mediaFiles } from '../db/schema.js';
import { DAY_MS } from '../domain/index.js';
import type { BlobStorage } from '../storage/blob-storage.js';
import { PipelineError } from './errors.js';

/** PR07: originals are kept 30 days. */
export const MEDIA_RETENTION_MS = 30 * DAY_MS;

export interface StoredMedia {
  file: MediaFile;
  bytes: Buffer;
  /**
   * Case 1: she already sent this exact file (same SHA-256), linked to another message. The
   * message is an exact duplicate: no entry, no doubt.
   */
  duplicateOfEarlierFile: boolean;
}

export function mediaStorageKey(userId: string, sha256: string): string {
  return `media/${userId}/${sha256}`;
}

export async function ensureMedia(
  deps: { db: Db; storage: BlobStorage; channel: Pick<Channel, 'downloadMedia'>; now: () => Date },
  message: InboundMessage,
): Promise<StoredMedia> {
  const { db, storage } = deps;

  // A previous attempt of this job already stored it.
  if (message.mediaFileId) {
    const [file] = await db.select().from(mediaFiles).where(eq(mediaFiles.id, message.mediaFileId));
    if (!file) throw new PipelineError('media_file_missing', { retryable: false });
    const blob = await storage.get(file.storageKey);
    if (!blob) throw new PipelineError('media_blob_missing', { retryable: false });
    return { file, bytes: blob.data, duplicateOfEarlierFile: false };
  }

  if (!message.waMediaId) throw new PipelineError('media_id_missing', { retryable: false });
  const downloaded = await deps.channel.downloadMedia(message.waMediaId);
  if (downloaded.bytes.length === 0) throw new PipelineError('media_empty', { retryable: false });

  const [existing] = await db
    .select()
    .from(mediaFiles)
    .where(and(eq(mediaFiles.userId, message.userId), eq(mediaFiles.sha256, downloaded.sha256)));
  if (existing) {
    // Is it linked to another message already? Then she sent the same file twice.
    const [other] = await db
      .select({ id: inboundMessages.id })
      .from(inboundMessages)
      .where(and(eq(inboundMessages.mediaFileId, existing.id), ne(inboundMessages.id, message.id)))
      .limit(1);
    await db
      .update(inboundMessages)
      .set({ mediaFileId: existing.id })
      .where(eq(inboundMessages.id, message.id));
    if (other) return { file: existing, bytes: downloaded.bytes, duplicateOfEarlierFile: true };
    return { file: existing, bytes: downloaded.bytes, duplicateOfEarlierFile: false };
  }

  const storageKey = mediaStorageKey(message.userId, downloaded.sha256);
  await storage.put(storageKey, downloaded.bytes, { contentType: downloaded.mimeType });
  const file = await db.transaction(async (tx) => {
    await tx
      .insert(mediaFiles)
      .values({
        userId: message.userId,
        sha256: downloaded.sha256,
        mimeType: downloaded.mimeType,
        storageKey,
        deleteAfter: new Date(deps.now().getTime() + MEDIA_RETENTION_MS),
      })
      .onConflictDoNothing({ target: [mediaFiles.userId, mediaFiles.sha256] });
    const [row] = await tx
      .select()
      .from(mediaFiles)
      .where(and(eq(mediaFiles.userId, message.userId), eq(mediaFiles.sha256, downloaded.sha256)));
    if (!row) throw new Error('media file insert returned no row');
    await tx
      .update(inboundMessages)
      .set({ mediaFileId: row.id })
      .where(eq(inboundMessages.id, message.id));
    return row;
  });
  return { file, bytes: downloaded.bytes, duplicateOfEarlierFile: false };
}
