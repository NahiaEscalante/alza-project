import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { storageObjects } from '../db/schema.js';
import {
  assertValidStorageKey,
  type BlobStorage,
  type PutOptions,
  type StoredBlob,
} from './blob-storage.js';
import { decryptBlob, encryptBlob } from './crypto.js';

/** BlobStorage on the `storage_objects` table, encrypted with AES-256-GCM (D45). */
export class PostgresBlobStorage implements BlobStorage {
  readonly #db: Db;
  readonly #key: Buffer;

  constructor(db: Db, encryptionKey: Buffer) {
    this.#db = db;
    this.#key = encryptionKey;
  }

  async put(key: string, data: Uint8Array, options: PutOptions = {}): Promise<void> {
    assertValidStorageKey(key);
    const { iv, authTag, ciphertext } = encryptBlob(data, this.#key, key);
    const values = {
      contentType: options.contentType ?? null,
      sizeBytes: data.byteLength,
      iv,
      authTag,
      ciphertext,
    };
    await this.#db
      .insert(storageObjects)
      .values({ key, ...values })
      .onConflictDoUpdate({
        target: storageObjects.key,
        set: { ...values, createdAt: new Date() },
      });
  }

  async get(key: string): Promise<StoredBlob | null> {
    assertValidStorageKey(key);
    const [row] = await this.#db
      .select()
      .from(storageObjects)
      .where(eq(storageObjects.key, key))
      .limit(1);
    if (!row) return null;
    const data = decryptBlob(row, this.#key, key);
    return { data, contentType: row.contentType, sizeBytes: row.sizeBytes };
  }

  async delete(key: string): Promise<boolean> {
    assertValidStorageKey(key);
    const deleted = await this.#db
      .delete(storageObjects)
      .where(eq(storageObjects.key, key))
      .returning({ key: storageObjects.key });
    return deleted.length > 0;
  }
}
