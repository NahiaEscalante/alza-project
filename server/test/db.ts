import { randomBytes } from 'node:crypto';
import { createDb, createPool, type Db, type Pool } from '../src/db/client.js';

/** Test database (migrated by global-setup). Tests that need it use `describe.skipIf(!hasTestDb)`. */
export const TEST_DATABASE_URL = process.env.DATABASE_URL_TEST ?? '';
export const hasTestDb = TEST_DATABASE_URL !== '';

export function createTestDb(): { pool: Pool; db: Db } {
  const pool = createPool(TEST_DATABASE_URL, { max: 3, applicationName: 'alza-test' });
  return { pool, db: createDb(pool) };
}

export const testEncryptionKey = (): Buffer => randomBytes(32);

/** Postgres error code, also when wrapped by drizzle's DrizzleQueryError (`cause`). */
export function pgErrorCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  const code = e?.code ?? e?.cause?.code;
  return typeof code === 'string' ? code : undefined;
}

/** Runs `fn` and returns the Postgres error code it fails with (throws if it succeeds). */
export async function expectPgError(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
  } catch (err) {
    return pgErrorCode(err);
  }
  throw new Error('Expected a database error');
}
