/**
 * «Celular recordado» (14.3, RF-WA-04, RF-WA-09): a random cookie whose hash is stored. A device
 * exists only after a correct PIN on it, so every session was verified with the PIN; it lasts
 * 30 days from the last PIN check. Sensitive actions also need the PIN in the last 10 minutes.
 */
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { trustedDevices, users } from '../db/schema.js';
import { DAY_MS } from '../domain/index.js';
import type { DbOrTx } from '../ledger/types.js';
import { generateToken, hashToken, isWellFormedToken } from './tokens.js';

export const REMEMBER_DEVICE_MS = 30 * DAY_MS;

export interface Session {
  userId: string;
  deviceId: string;
  pinVerifiedAt: Date | null;
  rememberedUntil: Date;
}

export interface RememberedDevice {
  deviceId: string;
  /** Raw cookie value: only goes into Set-Cookie. */
  cookie: string;
  rememberedUntil: Date;
}

/** Creates a remembered device right after a correct PIN (or a new PIN). */
export async function rememberDevice(
  db: DbOrTx,
  userId: string,
  now: Date,
): Promise<RememberedDevice> {
  const cookie = generateToken();
  const rememberedUntil = new Date(now.getTime() + REMEMBER_DEVICE_MS);
  const [row] = await db
    .insert(trustedDevices)
    .values({
      userId,
      cookieHash: hashToken(cookie),
      rememberedUntil,
      pinVerifiedAt: now,
      createdAt: now,
    })
    .returning({ id: trustedDevices.id });
  if (!row) throw new Error('insert returned no row');
  return { deviceId: row.id, cookie, rememberedUntil };
}

/** The session behind a cookie: not revoked, not expired, account not deleted. */
export async function findSession(db: Db, cookie: unknown, now: Date): Promise<Session | null> {
  if (!isWellFormedToken(cookie)) return null;
  const [row] = await db
    .select({
      userId: trustedDevices.userId,
      deviceId: trustedDevices.id,
      pinVerifiedAt: trustedDevices.pinVerifiedAt,
      rememberedUntil: trustedDevices.rememberedUntil,
    })
    .from(trustedDevices)
    .innerJoin(users, eq(users.id, trustedDevices.userId))
    .where(
      and(
        eq(trustedDevices.cookieHash, hashToken(cookie)),
        eq(trustedDevices.revoked, false),
        gt(trustedDevices.rememberedUntil, now),
        isNull(users.deletedAt),
      ),
    );
  return row ?? null;
}

/** A correct PIN on a remembered device: fresh for 10 minutes and remembered 30 more days. */
export async function markPinVerified(db: DbOrTx, deviceId: string, now: Date): Promise<Date> {
  const rememberedUntil = new Date(now.getTime() + REMEMBER_DEVICE_MS);
  await db
    .update(trustedDevices)
    .set({ pinVerifiedAt: now, rememberedUntil })
    .where(eq(trustedDevices.id, deviceId));
  return rememberedUntil;
}

/** «Salir de todos» (RF-WA-09). Returns how many devices were revoked. */
export async function revokeAllDevices(db: DbOrTx, userId: string): Promise<number> {
  const rows = await db
    .update(trustedDevices)
    .set({ revoked: true })
    .where(and(eq(trustedDevices.userId, userId), eq(trustedDevices.revoked, false)))
    .returning({ id: trustedDevices.id });
  return rows.length;
}
