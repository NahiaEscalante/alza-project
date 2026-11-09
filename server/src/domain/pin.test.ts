import { describe, expect, it } from 'vitest';
import {
  INITIAL_PIN_ATTEMPTS,
  LOCK_MS,
  PIN_ERROR_MESSAGES,
  type PinAttemptState,
  pinAttemptGate,
  registerPinAttempt,
  resetPinAttempts,
  validateNewPin,
  weakPinReason,
} from './pin.js';
import { lima } from './test-support.js';

const PHONE = '+51987654321';

describe('validateNewPin (14.3)', () => {
  it('accepts a good PIN typed twice', () => {
    expect(validateNewPin('285713', '285713', PHONE)).toEqual({ ok: true });
  });

  it.each([
    ['111111', 'repeated'],
    ['123456', 'sequence'],
    ['654321', 'sequence'],
    ['345678', 'sequence'],
    ['890123', 'sequence'],
    ['121212', 'pattern'],
    ['123123', 'pattern'],
    ['907907', 'pattern'],
  ])('%s is too easy (%s)', (pin, reason) => {
    expect(weakPinReason(pin, PHONE)).toBe(reason);
    expect(validateNewPin(pin, pin, PHONE)).toEqual({
      ok: false,
      error: 'too_easy',
      message: 'Ese PIN es muy fácil de adivinar. Prueba otro sin números seguidos ni repetidos.',
    });
  });

  it('rejects the last 6 digits of her phone', () => {
    expect(weakPinReason('654321', null)).toBe('sequence');
    expect(weakPinReason('987654', '+51 999 987 654')).toBe('sequence');
    expect(weakPinReason('765432', null)).toBe('sequence');
    expect(weakPinReason('284519', '+51 999 284 519')).toBe('phone');
    expect(validateNewPin('284519', '284519', '+51999284519')).toMatchObject({ error: 'too_easy' });
  });

  it('rejects a mismatch and anything that is not 6 digits', () => {
    expect(validateNewPin('285713', '285714', PHONE)).toEqual({
      ok: false,
      error: 'mismatch',
      message: 'Los dos PIN no coinciden.',
    });
    for (const pin of ['28571', '2857134', '28571a', '']) {
      expect(validateNewPin(pin, pin, PHONE)).toEqual({
        ok: false,
        error: 'invalid_format',
        message: PIN_ERROR_MESSAGES.invalid_format,
      });
    }
  });

  it('HU-09: 123456 is rejected with a message that explains why', () => {
    const result = validateNewPin('123456', '123456', PHONE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('números seguidos');
  });
});

describe('PIN attempts (14.3, HU-10, case 30)', () => {
  const t0 = lima('2026-11-10T19:00');
  const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);

  function fail(times: number, state: PinAttemptState = INITIAL_PIN_ATTEMPTS, now = t0) {
    let result = registerPinAttempt(state, false, now);
    for (let i = 1; i < times; i++) result = registerPinAttempt(result.state, false, now);
    return result;
  }

  it('5 consecutive failures lock for 15 minutes and notify in the next close', () => {
    const fourth = fail(4);
    expect(fourth.event).toBe('failure');
    expect(fourth.notifyInNextClose).toBe(false);
    const fifth = fail(5);
    expect(fifth.event).toBe('locked');
    expect(fifth.notifyInNextClose).toBe(true);
    expect(fifth.state.lockedUntil).toEqual(new Date(t0.getTime() + LOCK_MS));
    expect(pinAttemptGate(fifth.state, at(14))).toEqual({
      allowed: false,
      reason: 'locked',
      until: fifth.state.lockedUntil,
    });
    expect(pinAttemptGate(fifth.state, at(15))).toEqual({ allowed: true });
  });

  it('a success resets the consecutive counter but not the accumulated one', () => {
    const three = fail(3).state;
    const ok = registerPinAttempt(three, true, t0);
    expect(ok.event).toBe('success');
    expect(ok.state).toEqual({ failedAttempts: 0, totalFailedAttempts: 3, lockedUntil: null });
    expect(fail(4, ok.state).event).toBe('failure');
  });

  it('10 accumulated failures require a new activation link', () => {
    const locked = fail(5).state;
    const afterLock = fail(4, locked, at(16));
    expect(afterLock.event).toBe('failure');
    const tenth = registerPinAttempt(afterLock.state, false, at(16));
    expect(tenth.event).toBe('needs_activation');
    expect(pinAttemptGate(tenth.state, at(60))).toEqual({
      allowed: false,
      reason: 'needs_activation',
    });
    expect(pinAttemptGate(resetPinAttempts(), at(60))).toEqual({ allowed: true });
  });
});
