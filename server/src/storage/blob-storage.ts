/**
 * Storage for files (screenshots, audios, reports). D45: encrypted in Postgres at first; an
 * S3-compatible implementation can replace it later without touching callers.
 *
 * Key convention: `<kind>/<userId>/<name>`, e.g. `media/<userId>/<sha256>`, `reports/<userId>/<id>.pdf`.
 */
export interface StoredBlob {
  data: Buffer;
  contentType: string | null;
  sizeBytes: number;
}

export interface PutOptions {
  contentType?: string;
}

export interface BlobStorage {
  /** Stores (or replaces) the bytes under `key`. */
  put(key: string, data: Uint8Array, options?: PutOptions): Promise<void>;
  /** Returns null when the key does not exist. Throws BlobIntegrityError if the bytes were altered. */
  get(key: string): Promise<StoredBlob | null>;
  /** Returns true when something was deleted. */
  delete(key: string): Promise<boolean>;
}

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,511}$/;

export function assertValidStorageKey(key: string): void {
  if (!KEY_PATTERN.test(key) || key.includes('..') || key.includes('//')) {
    throw new Error('Invalid storage key');
  }
}
