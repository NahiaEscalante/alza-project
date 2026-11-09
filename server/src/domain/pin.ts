/**
 * PIN rules (14.3, D13, D28, HU-09, HU-10). Hashing lives outside the domain (Argon2id/bcrypt).
 *
 * New PIN: 6 digits, typed twice; rejects all-equal digits, ascending/descending runs (also
 * wrapping: 890123), repeated patterns (121212, 123123) and the last 6 digits of her phone.
 *
 * Attempts: 5 consecutive failures → 15-minute lock (and a line in the next close, D28);
 * 10 accumulated failures → a new activation link is required; a success resets the consecutive
 * counter. The consecutive counter also restarts when a lock starts, so the next lock needs 5 more.
 */

export const PIN_LENGTH = 6;
export const MAX_CONSECUTIVE_FAILURES = 5;
export const MAX_TOTAL_FAILURES = 10;
export const LOCK_MS = 15 * 60_000;

export type PinValidationError = 'invalid_format' | 'mismatch' | 'too_easy';

/** Texts for the «Crea tu PIN» screen (12.2). `invalid_format` is not in the spec (decision). */
export const PIN_ERROR_MESSAGES: Record<PinValidationError, string> = {
  invalid_format: 'Tu PIN debe tener 6 números.',
  mismatch: 'Los dos PIN no coinciden.',
  too_easy: 'Ese PIN es muy fácil de adivinar. Prueba otro sin números seguidos ni repetidos.',
};

export type PinValidation =
  | { ok: true }
  | { ok: false; error: PinValidationError; message: string };

function fail(error: PinValidationError): PinValidation {
  return { ok: false, error, message: PIN_ERROR_MESSAGES[error] };
}

function isRun(pin: string, step: 1 | -1): boolean {
  for (let i = 1; i < pin.length; i++) {
    const expected = (Number(pin[i - 1]) + step + 10) % 10;
    if (Number(pin[i]) !== expected) return false;
  }
  return true;
}

function hasPeriod(pin: string, period: number): boolean {
  for (let i = period; i < pin.length; i++) if (pin[i] !== pin[i - period]) return false;
  return true;
}

/** Reason a well-formed PIN is too easy, or null. */
export function weakPinReason(
  pin: string,
  phoneE164: string | null,
): 'repeated' | 'sequence' | 'pattern' | 'phone' | null {
  if (hasPeriod(pin, 1)) return 'repeated';
  if (isRun(pin, 1) || isRun(pin, -1)) return 'sequence';
  if (hasPeriod(pin, 2) || hasPeriod(pin, 3)) return 'pattern';
  const phoneDigits = (phoneE164 ?? '').replace(/\D/g, '');
  if (phoneDigits.length >= PIN_LENGTH && phoneDigits.slice(-PIN_LENGTH) === pin) return 'phone';
  return null;
}

export function validateNewPin(
  pin: string,
  confirmation: string,
  phoneE164: string | null,
): PinValidation {
  if (!new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin)) return fail('invalid_format');
  if (weakPinReason(pin, phoneE164) !== null) return fail('too_easy');
  if (pin !== confirmation) return fail('mismatch');
  return { ok: true };
}

/** Mirrors the `pins` table counters. */
export interface PinAttemptState {
  failedAttempts: number;
  totalFailedAttempts: number;
  lockedUntil: Date | null;
}

export const INITIAL_PIN_ATTEMPTS: PinAttemptState = {
  failedAttempts: 0,
  totalFailedAttempts: 0,
  lockedUntil: null,
};

export type PinAttemptGate =
  | { allowed: true }
  | { allowed: false; reason: 'locked'; until: Date }
  | { allowed: false; reason: 'needs_activation' };

/** Whether a PIN may be checked now. Checked before comparing the hash. */
export function pinAttemptGate(state: PinAttemptState, now: Date): PinAttemptGate {
  if (state.totalFailedAttempts >= MAX_TOTAL_FAILURES) {
    return { allowed: false, reason: 'needs_activation' };
  }
  if (state.lockedUntil !== null && now.getTime() < state.lockedUntil.getTime()) {
    return { allowed: false, reason: 'locked', until: state.lockedUntil };
  }
  return { allowed: true };
}

export type PinAttemptEvent = 'success' | 'failure' | 'locked' | 'needs_activation';

export interface PinAttemptResult {
  state: PinAttemptState;
  event: PinAttemptEvent;
  /** D28 / case 30: add «Alguien intentó entrar a tu web con un PIN incorrecto…» to the next close. */
  notifyInNextClose: boolean;
}

/** Records the result of an allowed attempt (call `pinAttemptGate` first). */
export function registerPinAttempt(
  state: PinAttemptState,
  success: boolean,
  now: Date,
): PinAttemptResult {
  if (success) {
    return {
      state: { ...state, failedAttempts: 0, lockedUntil: null },
      event: 'success',
      notifyInNextClose: false,
    };
  }
  const failedAttempts = state.failedAttempts + 1;
  const totalFailedAttempts = state.totalFailedAttempts + 1;
  if (totalFailedAttempts >= MAX_TOTAL_FAILURES) {
    return {
      state: { failedAttempts, totalFailedAttempts, lockedUntil: state.lockedUntil },
      event: 'needs_activation',
      notifyInNextClose: failedAttempts >= MAX_CONSECUTIVE_FAILURES,
    };
  }
  if (failedAttempts >= MAX_CONSECUTIVE_FAILURES) {
    return {
      state: {
        failedAttempts: 0,
        totalFailedAttempts,
        lockedUntil: new Date(now.getTime() + LOCK_MS),
      },
      event: 'locked',
      notifyInNextClose: true,
    };
  }
  return {
    state: { failedAttempts, totalFailedAttempts, lockedUntil: state.lockedUntil },
    event: 'failure',
    notifyInNextClose: false,
  };
}

/** After she creates a new PIN through an activation link, every counter starts over. */
export function resetPinAttempts(): PinAttemptState {
  return { ...INITIAL_PIN_ATTEMPTS };
}
