import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** AES-256-GCM with a random 96-bit IV per object and the storage key as associated data. */
const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export interface EncryptedPayload {
  iv: Buffer;
  authTag: Buffer;
  ciphertext: Buffer;
}

/** Thrown when a blob cannot be authenticated: wrong key, tampered bytes or moved to another key. */
export class BlobIntegrityError extends Error {
  constructor() {
    super('Blob failed authentication (tampered, wrong key or wrong storage key)');
    this.name = 'BlobIntegrityError';
  }
}

function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) throw new Error(`Encryption key must be ${KEY_BYTES} bytes`);
}

/** Binds the ciphertext to its storage key: copying a row under another key fails to decrypt. */
function associatedData(storageKey: string): Buffer {
  return Buffer.from(`alza-blob:v1:${storageKey}`, 'utf8');
}

export function encryptBlob(
  plaintext: Uint8Array,
  key: Buffer,
  storageKey: string,
): EncryptedPayload {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
  cipher.setAAD(associatedData(storageKey));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, authTag: cipher.getAuthTag(), ciphertext };
}

export function decryptBlob(payload: EncryptedPayload, key: Buffer, storageKey: string): Buffer {
  assertKey(key);
  if (payload.iv.length !== IV_BYTES || payload.authTag.length !== AUTH_TAG_BYTES) {
    throw new BlobIntegrityError();
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, key, payload.iv, {
      authTagLength: AUTH_TAG_BYTES,
    });
    decipher.setAAD(associatedData(storageKey));
    decipher.setAuthTag(payload.authTag);
    return Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]);
  } catch {
    throw new BlobIntegrityError();
  }
}
