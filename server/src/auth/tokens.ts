import { createHash, randomBytes } from 'node:crypto';

/** 256 random bits (14.3 asks for ≥ 128), base64url: 43 characters. */
export const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Random token for links and the remembered-device cookie. Only its hash is stored. */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** SHA-256 hex. Tokens are random and long, so a fast hash is enough (no salt needed). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Rejects junk before touching the database. */
export function isWellFormedToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}
