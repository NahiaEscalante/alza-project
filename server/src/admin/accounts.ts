/**
 * Team accounts for the internal panel (RF-AD-04, 14.4: «cuentas separadas para cada persona del
 * equipo»). One row per person in `admin_users`; the `email` column holds the login name (an
 * email or a plain username), lowercased. Passwords use the same scrypt hasher as the PIN
 * (`auth/pin-hash.ts`, D56), so only the hash is stored.
 *
 * Accounts are created or reset only from the command line (`npm run create-admin -w server`),
 * never from the panel itself.
 */
import { eq } from 'drizzle-orm';
import type { PinHasher } from '../auth/pin-hash.js';
import type { Db } from '../db/client.js';
import { adminUsers } from '../db/schema.js';

export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._@+-]{2,63}$/;
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 200;

/** Who is acting, as the panel and the audit log see it. */
export interface AdminIdentity {
  id: string;
  username: string;
  name: string;
}

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export type CredentialProblem = 'invalid_username' | 'password_too_short' | 'password_too_long';

export function checkUsername(username: string): CredentialProblem | null {
  return USERNAME_PATTERN.test(username) ? null : 'invalid_username';
}

export function checkPassword(password: string): CredentialProblem | null {
  if (password.length < MIN_PASSWORD_LENGTH) return 'password_too_short';
  if (password.length > MAX_PASSWORD_LENGTH) return 'password_too_long';
  return null;
}

export interface UpsertAdminInput {
  username: string;
  password: string;
  /** Shown in the panel and the audit log. Default: the username. */
  name?: string;
}

/**
 * Creates the account, or resets the password (and reactivates it) when the username exists.
 * Throws on an invalid username or password; never logs either.
 */
export async function upsertAdminUser(
  db: Db,
  input: UpsertAdminInput,
  hasher: PinHasher,
): Promise<{ id: string; created: boolean }> {
  const username = normalizeUsername(input.username);
  const problem = checkUsername(username) ?? checkPassword(input.password);
  if (problem) throw new Error(problem);
  const passwordHash = await hasher.hash(input.password);
  const name = input.name?.trim() || username;

  const [existing] = await db
    .select({ id: adminUsers.id })
    .from(adminUsers)
    .where(eq(adminUsers.email, username));
  if (existing) {
    await db
      .update(adminUsers)
      .set({ passwordHash, active: true, ...(input.name ? { name } : {}) })
      .where(eq(adminUsers.id, existing.id));
    return { id: existing.id, created: false };
  }
  const [row] = await db
    .insert(adminUsers)
    .values({ email: username, name, passwordHash })
    .returning({ id: adminUsers.id });
  if (!row) throw new Error('admin insert returned no row');
  return { id: row.id, created: true };
}

/**
 * Checks a login. An unknown username still runs one hash check, so the answer takes the same
 * time either way (no account enumeration). Inactive accounts never log in.
 */
export function createCredentialVerifier(db: Db, hasher: PinHasher) {
  let dummyHash: Promise<string> | undefined;
  return async function verifyCredentials(
    rawUsername: string,
    password: string,
    now: Date,
  ): Promise<AdminIdentity | null> {
    const username = normalizeUsername(rawUsername);
    const [row] = checkUsername(username)
      ? []
      : await db.select().from(adminUsers).where(eq(adminUsers.email, username));
    if (!row) {
      dummyHash ??= hasher.hash('alza-admin-timing-guard');
      await hasher.verify(password, await dummyHash);
      return null;
    }
    const ok = await hasher.verify(password, row.passwordHash);
    if (!ok || !row.active) return null;
    await db.update(adminUsers).set({ lastLoginAt: now }).where(eq(adminUsers.id, row.id));
    return { id: row.id, username: row.email, name: row.name };
  };
}

/** The account behind a session, if it still exists and is active. */
export async function findActiveAdmin(db: Db, id: string): Promise<AdminIdentity | null> {
  const [row] = await db
    .select({
      id: adminUsers.id,
      username: adminUsers.email,
      name: adminUsers.name,
      active: adminUsers.active,
    })
    .from(adminUsers)
    .where(eq(adminUsers.id, id));
  if (!row?.active) return null;
  return { id: row.id, username: row.username, name: row.name };
}
