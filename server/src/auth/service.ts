/**
 * Web access flows (14.3, 10.4, HU-09, HU-10). The rules (PIN validation, lockouts, 10-minute
 * PIN) are the domain's; this file stores their results.
 *
 * - activate: checks the activation link (1 h, unused). It is consumed when the PIN is created.
 * - createPin: with an activation link (first time, «olvidé mi PIN»), or from a session with a
 *   fresh PIN (change). Resets the attempt counters and remembers the device for 30 days.
 * - enter: 7-day link. Remembered device of the same user → in; otherwise `pin_required`.
 * - verifyPin: logs a new device in (with the 7-day link) or refreshes the 10-minute PIN.
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { pins, users } from '../db/schema.js';
import {
  isPinFresh,
  MAX_CONSECUTIVE_FAILURES,
  MAX_TOTAL_FAILURES,
  PIN_LENGTH,
  PIN_SESSION_MS,
  type PinValidationError,
  pinAttemptGate,
  registerPinAttempt,
  resetPinAttempts,
  validateNewPin,
} from '../domain/index.js';
import { inTransaction } from '../ledger/types.js';
import {
  markPinVerified,
  type RememberedDevice,
  rememberDevice,
  revokeAllDevices,
  type Session,
} from './devices.js';
import { consumeActivationLink, findLink } from './links.js';
import type { PinHasher } from './pin-hash.js';
import { recordPinLockoutNotice } from './security-notices.js';

export interface AuthServiceDeps {
  db: Db;
  pinHasher: PinHasher;
}

type LinkError = 'link_invalid' | 'link_expired' | 'link_used';
const linkError = (reason: 'invalid' | 'expired' | 'used'): LinkError => `link_${reason}`;

export function isPinFormat(pin: unknown): pin is string {
  return typeof pin === 'string' && pin.length === PIN_LENGTH && /^\d+$/.test(pin);
}

// ---------------------------------------------------------------------------

export type ActivateResult =
  | { ok: true; userId: string; expiresAt: Date; hasPin: boolean }
  | { ok: false; error: LinkError };

export async function checkActivationLink(
  db: Db,
  token: unknown,
  now: Date,
): Promise<ActivateResult> {
  const found = await findLink(db, token, 'activation', now);
  if (!found.ok) return { ok: false, error: linkError(found.reason) };
  const [pin] = await db
    .select({ userId: pins.userId })
    .from(pins)
    .where(eq(pins.userId, found.user.id));
  return { ok: true, userId: found.user.id, expiresAt: found.link.expiresAt, hasPin: !!pin };
}

// ---------------------------------------------------------------------------

export type CreatePinResult =
  | { ok: true; userId: string; device: RememberedDevice | null }
  | { ok: false; error: PinValidationError }
  | { ok: false; error: LinkError | 'activation_required' };

export async function createPin(
  deps: AuthServiceDeps,
  input: {
    activationToken: string | null;
    session: Session | null;
    pin: string;
    confirmation: string;
    now: Date;
  },
): Promise<CreatePinResult> {
  const { db, pinHasher } = deps;
  const { now } = input;

  let userId: string;
  let phoneE164: string;
  let linkId: string | null = null;
  if (input.activationToken) {
    const found = await findLink(db, input.activationToken, 'activation', now);
    if (!found.ok) return { ok: false, error: linkError(found.reason) };
    userId = found.user.id;
    phoneE164 = found.user.phoneE164;
    linkId = found.link.id;
  } else if (input.session && isPinFresh(input.session.pinVerifiedAt, now)) {
    userId = input.session.userId;
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) return { ok: false, error: 'activation_required' };
    phoneE164 = user.phoneE164;
  } else {
    return { ok: false, error: 'activation_required' };
  }

  const validation = validateNewPin(input.pin, input.confirmation, phoneE164);
  if (!validation.ok) return { ok: false, error: validation.error };
  const pinHash = await pinHasher.hash(input.pin);

  return inTransaction(db, async (tx) => {
    if (linkId && !(await consumeActivationLink(tx, linkId, now))) {
      return { ok: false, error: 'link_used' } as const;
    }
    const counters = resetPinAttempts();
    await tx
      .insert(pins)
      .values({ userId, pinHash, ...counters, updatedAt: now })
      .onConflictDoUpdate({ target: pins.userId, set: { pinHash, ...counters, updatedAt: now } });

    if (input.session && input.session.userId === userId) {
      await markPinVerified(tx, input.session.deviceId, now);
      return { ok: true, userId, device: null } as const;
    }
    return { ok: true, userId, device: await rememberDevice(tx, userId, now) } as const;
  });
}

// ---------------------------------------------------------------------------

export type EnterResult =
  | { status: 'ok'; userId: string }
  | { status: 'pin_required'; userId: string; linkExpiresAt: Date }
  | { status: 'activation_required'; reason: 'no_pin' | 'too_many_attempts' }
  | { status: LinkError };

export async function enterWithAccessLink(
  db: Db,
  input: { token: unknown; session: Session | null; now: Date },
): Promise<EnterResult> {
  const found = await findLink(db, input.token, 'access', input.now);
  if (!found.ok) return { status: linkError(found.reason) };
  const userId = found.user.id;
  if (input.session?.userId === userId) return { status: 'ok', userId };

  const [pin] = await db.select().from(pins).where(eq(pins.userId, userId));
  if (!pin) return { status: 'activation_required', reason: 'no_pin' };
  if (pin.totalFailedAttempts >= MAX_TOTAL_FAILURES) {
    return { status: 'activation_required', reason: 'too_many_attempts' };
  }
  return { status: 'pin_required', userId, linkExpiresAt: found.link.expiresAt };
}

// ---------------------------------------------------------------------------

export type VerifyPinResult =
  | {
      ok: true;
      userId: string;
      /** New remembered device (login with the 7-day link); null when a session was refreshed. */
      device: RememberedDevice | null;
      pinValidUntil: Date;
    }
  | { ok: false; error: 'wrong_pin'; attemptsLeft: number }
  | { ok: false; error: 'locked'; until: Date; justLocked: boolean }
  | { ok: false; error: 'activation_required'; reason: 'no_pin' | 'too_many_attempts' };

/** Who is typing the PIN: a new device logging in with the 7-day link, or a session. */
export type PinIdentity =
  | { mode: 'login'; userId: string }
  | { mode: 'session'; userId: string; deviceId: string };

/**
 * The pending 7-day link of this browser wins (she is logging in, maybe on a phone remembered for
 * another account); otherwise the session.
 */
export async function resolvePinIdentity(
  db: Db,
  input: { accessToken: string | null; session: Session | null; now: Date },
): Promise<PinIdentity | null> {
  if (input.accessToken) {
    const found = await findLink(db, input.accessToken, 'access', input.now);
    if (found.ok) return { mode: 'login', userId: found.user.id };
  }
  if (input.session) {
    return { mode: 'session', userId: input.session.userId, deviceId: input.session.deviceId };
  }
  return null;
}

/**
 * Checks her PIN (14.3 lockouts). The `pins` row is locked during the check, so parallel guesses
 * are counted one by one.
 */
export async function verifyPin(
  deps: AuthServiceDeps,
  input: { identity: PinIdentity; pin: string; now: Date },
): Promise<VerifyPinResult> {
  const { db, pinHasher } = deps;
  const { now, identity } = input;
  const user = identity.userId;

  return inTransaction(db, async (tx): Promise<VerifyPinResult> => {
    const [row] = await tx.select().from(pins).where(eq(pins.userId, user)).for('update');
    if (!row) return { ok: false, error: 'activation_required', reason: 'no_pin' };

    const state = {
      failedAttempts: row.failedAttempts,
      totalFailedAttempts: row.totalFailedAttempts,
      lockedUntil: row.lockedUntil,
    };
    const gate = pinAttemptGate(state, now);
    if (!gate.allowed) {
      return gate.reason === 'locked'
        ? { ok: false, error: 'locked', until: gate.until, justLocked: false }
        : { ok: false, error: 'activation_required', reason: 'too_many_attempts' };
    }

    const matches = await pinHasher.verify(input.pin, row.pinHash);
    const result = registerPinAttempt(state, matches, now);
    await tx.update(pins).set(result.state).where(eq(pins.userId, user));
    if (result.notifyInNextClose) {
      await recordPinLockoutNotice(tx, user, now, result.state.lockedUntil);
    }

    switch (result.event) {
      case 'failure':
        return {
          ok: false,
          error: 'wrong_pin',
          attemptsLeft: Math.min(
            MAX_CONSECUTIVE_FAILURES - result.state.failedAttempts,
            MAX_TOTAL_FAILURES - result.state.totalFailedAttempts,
          ),
        };
      case 'locked':
        return {
          ok: false,
          error: 'locked',
          until: result.state.lockedUntil as Date,
          justLocked: true,
        };
      case 'needs_activation':
        return { ok: false, error: 'activation_required', reason: 'too_many_attempts' };
      case 'success':
        break;
    }

    const pinValidUntil = new Date(now.getTime() + PIN_SESSION_MS);
    if (identity.mode === 'session') {
      await markPinVerified(tx, identity.deviceId, now);
      return { ok: true, userId: user, device: null, pinValidUntil };
    }
    return { ok: true, userId: user, device: await rememberDevice(tx, user, now), pinValidUntil };
  });
}

/** «Salir de todos» (RF-WA-09). */
export function logoutAllDevices(db: Db, userId: string): Promise<number> {
  return revokeAllDevices(db, userId);
}
