import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BlobIntegrityError, decryptBlob, encryptBlob } from './crypto.js';

const key = randomBytes(32);
const plaintext = Buffer.from('captura de Yape: S/ 12,50');

describe('AES-256-GCM blob encryption', () => {
  it('round-trips', () => {
    const payload = encryptBlob(plaintext, key, 'media/u1/abc');
    expect(payload.ciphertext.equals(plaintext)).toBe(false);
    expect(decryptBlob(payload, key, 'media/u1/abc').equals(plaintext)).toBe(true);
  });

  it('uses a fresh IV each time', () => {
    const a = encryptBlob(plaintext, key, 'k');
    const b = encryptBlob(plaintext, key, 'k');
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it('detects a tampered ciphertext, tag or IV', () => {
    const payload = encryptBlob(plaintext, key, 'k');
    const flip = (buf: Buffer) => {
      const copy = Buffer.from(buf);
      copy[0] = (copy[0] ?? 0) ^ 0xff;
      return copy;
    };
    expect(() =>
      decryptBlob({ ...payload, ciphertext: flip(payload.ciphertext) }, key, 'k'),
    ).toThrow(BlobIntegrityError);
    expect(() => decryptBlob({ ...payload, authTag: flip(payload.authTag) }, key, 'k')).toThrow(
      BlobIntegrityError,
    );
    expect(() => decryptBlob({ ...payload, iv: flip(payload.iv) }, key, 'k')).toThrow(
      BlobIntegrityError,
    );
  });

  it('fails with the wrong key or under another storage key', () => {
    const payload = encryptBlob(plaintext, key, 'media/u1/abc');
    expect(() => decryptBlob(payload, randomBytes(32), 'media/u1/abc')).toThrow(BlobIntegrityError);
    expect(() => decryptBlob(payload, key, 'media/u2/abc')).toThrow(BlobIntegrityError);
  });

  it('rejects keys that are not 32 bytes', () => {
    expect(() => encryptBlob(plaintext, randomBytes(16), 'k')).toThrow();
  });

  it('handles empty input', () => {
    const payload = encryptBlob(new Uint8Array(), key, 'k');
    expect(decryptBlob(payload, key, 'k')).toHaveLength(0);
  });
});
