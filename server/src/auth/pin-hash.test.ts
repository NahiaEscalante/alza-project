import { describe, expect, it } from 'vitest';
import { createScryptPinHasher, DEFAULT_SCRYPT_PARAMS } from './pin-hash.js';
import { generateToken, hashToken, isWellFormedToken } from './tokens.js';

describe('PIN hashing (RNF-08)', () => {
  const hasher = createScryptPinHasher({ log2N: 10, r: 8, p: 1 });

  it('verifies the right PIN only, with a fresh salt each time', async () => {
    const a = await hasher.hash('284719');
    const b = await hasher.hash('284719');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^scrypt\$ln=10,r=8,p=1\$/);
    expect(await hasher.verify('284719', a)).toBe(true);
    expect(await hasher.verify('284710', a)).toBe(false);
    expect(await hasher.verify('284719', 'not-a-hash')).toBe(false);
  });

  it('reads the parameters from the stored hash', async () => {
    const stronger = createScryptPinHasher({ log2N: 11, r: 8, p: 1 });
    expect(await hasher.verify('395172', await stronger.hash('395172'))).toBe(true);
  });

  it('defaults to the OWASP scrypt minimum', () => {
    expect(DEFAULT_SCRYPT_PARAMS).toEqual({ log2N: 17, r: 8, p: 1 });
  });
});

describe('tokens (14.3)', () => {
  it('are 256 random bits, base64url, hashed with SHA-256', () => {
    const token = generateToken();
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(isWellFormedToken(token)).toBe(true);
    expect(isWellFormedToken('short')).toBe(false);
    expect(isWellFormedToken(42)).toBe(false);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(generateToken()).not.toBe(token);
  });
});
