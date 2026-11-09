/**
 * PIN hashing (14.3, RNF-08: «Argon2id o bcrypt»). Neither library is installed and Node 24.2 has
 * no built-in Argon2 (it arrives in 24.7), so this uses Node's scrypt, also memory-hard, with the
 * OWASP minimum (N = 2^17, r = 8, p = 1: 128 MiB, ~0.3 s). Parameters travel inside the stored
 * string, so they can be raised later, or replaced by Argon2id, without breaking old hashes.
 *
 * Format: `scrypt$ln=17,r=8,p=1$<salt base64>$<hash base64>`.
 *
 * Note: a 6-digit PIN has only 10^6 values; the lockouts (5 → 15 min, 10 → new link) are what
 * protect it online. Offline, after a database leak, any KDF only slows the search down.
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

export interface PinHasher {
  hash(pin: string): Promise<string>;
  verify(pin: string, stored: string): Promise<boolean>;
}

export interface ScryptParams {
  /** log2 of N (CPU/memory cost). */
  log2N: number;
  r: number;
  p: number;
}

export const DEFAULT_SCRYPT_PARAMS: ScryptParams = { log2N: 17, r: 8, p: 1 };

const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const FORMAT =
  /^scrypt\$ln=(\d{1,2}),r=(\d{1,2}),p=(\d{1,2})\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/;

function derive(pin: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  const N = 2 ** params.log2N;
  return new Promise((resolve, reject) => {
    scrypt(
      pin,
      salt,
      KEY_LENGTH,
      { N, r: params.r, p: params.p, maxmem: 256 * N * params.r },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

export function createScryptPinHasher(params: ScryptParams = DEFAULT_SCRYPT_PARAMS): PinHasher {
  return {
    async hash(pin) {
      const salt = randomBytes(SALT_LENGTH);
      const key = await derive(pin, salt, params);
      return `scrypt$ln=${params.log2N},r=${params.r},p=${params.p}$${salt.toString('base64')}$${key.toString('base64')}`;
    },
    async verify(pin, stored) {
      const match = FORMAT.exec(stored);
      if (!match) return false;
      const [, ln, r, p, salt, hash] = match;
      const stored32 = Buffer.from(hash as string, 'base64');
      const key = await derive(pin, Buffer.from(salt as string, 'base64'), {
        log2N: Number(ln),
        r: Number(r),
        p: Number(p),
      });
      return key.length === stored32.length && timingSafeEqual(key, stored32);
    },
  };
}
