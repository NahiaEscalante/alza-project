import { randomBytes, randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestDb, hasTestDb, testEncryptionKey } from '../../test/db.js';
import { storageObjects } from '../db/schema.js';
import { BlobIntegrityError } from './crypto.js';
import { PostgresBlobStorage } from './postgres-blob-storage.js';

describe.skipIf(!hasTestDb)('PostgresBlobStorage', () => {
  const { pool, db } = createTestDb();
  const encryptionKey = testEncryptionKey();
  const storage = new PostgresBlobStorage(db, encryptionKey);
  const newKey = () => `media/${randomUUID()}/${randomBytes(8).toString('hex')}`;

  afterAll(() => pool.end());

  it('round-trips binary data with its content type', async () => {
    const key = newKey();
    const data = randomBytes(64 * 1024);
    await storage.put(key, data, { contentType: 'image/jpeg' });

    const blob = await storage.get(key);
    expect(blob?.data.equals(data)).toBe(true);
    expect(blob?.contentType).toBe('image/jpeg');
    expect(blob?.sizeBytes).toBe(data.length);
  });

  it('stores only ciphertext', async () => {
    const key = newKey();
    const data = Buffer.from('Marta Quispe recibió S/ 12,50 de Ana T.');
    await storage.put(key, data);

    const [row] = await db.select().from(storageObjects).where(eq(storageObjects.key, key));
    expect(row?.ciphertext.includes(Buffer.from('Marta'))).toBe(false);
    expect(row?.ciphertext.equals(data)).toBe(false);
  });

  it('overwrites on put and deletes', async () => {
    const key = newKey();
    await storage.put(key, Buffer.from('v1'));
    await storage.put(key, Buffer.from('v2'));
    expect((await storage.get(key))?.data.toString()).toBe('v2');

    expect(await storage.delete(key)).toBe(true);
    expect(await storage.get(key)).toBeNull();
    expect(await storage.delete(key)).toBe(false);
  });

  it('returns null for a missing key', async () => {
    expect(await storage.get(newKey())).toBeNull();
  });

  it('detects bytes tampered in the database', async () => {
    const key = newKey();
    await storage.put(key, Buffer.from('original'));
    await db.execute(
      sql`update storage_objects set ciphertext = set_byte(ciphertext, 0, get_byte(ciphertext, 0) # 255) where key = ${key}`,
    );
    await expect(storage.get(key)).rejects.toThrow(BlobIntegrityError);
  });

  it('detects a row copied under another key', async () => {
    const source = newKey();
    const target = newKey();
    await storage.put(source, Buffer.from('original'));
    await db.execute(
      sql`insert into storage_objects (key, content_type, size_bytes, iv, auth_tag, ciphertext)
          select ${target}, content_type, size_bytes, iv, auth_tag, ciphertext
          from storage_objects where key = ${source}`,
    );
    await expect(storage.get(target)).rejects.toThrow(BlobIntegrityError);
  });

  it('cannot be read with another encryption key', async () => {
    const key = newKey();
    await storage.put(key, Buffer.from('original'));
    const other = new PostgresBlobStorage(db, testEncryptionKey());
    await expect(other.get(key)).rejects.toThrow(BlobIntegrityError);
  });

  it('rejects unsafe keys', async () => {
    await expect(storage.put('../etc/passwd', Buffer.from('x'))).rejects.toThrow(
      'Invalid storage key',
    );
    await expect(storage.get('')).rejects.toThrow('Invalid storage key');
  });
});
