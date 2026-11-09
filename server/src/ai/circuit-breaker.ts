import type { ProviderErrorKind } from './providers/types.js';

/** Failure kinds a route can record: provider errors plus an output that failed validation. */
export type RouteFailureKind = ProviderErrorKind | 'invalid_output';

export interface BreakerPolicy {
  /** First cooldown for transient errors (5xx, timeout, network, empty); doubles per failure. */
  baseCooldownMs: number;
  maxCooldownMs: number;
  /** 429 without Retry-After. */
  rateLimitCooldownMs: number;
  /** Output that failed JSON/schema validation. */
  invalidOutputCooldownMs: number;
  /** 401/403/404: wrong key or retired model. */
  configCooldownMs: number;
}

export const DEFAULT_BREAKER_POLICY: BreakerPolicy = {
  baseCooldownMs: 15_000,
  maxCooldownMs: 5 * 60_000,
  rateLimitCooldownMs: 60_000,
  invalidOutputCooldownMs: 30_000,
  configCooldownMs: 60 * 60_000,
};

interface RouteState {
  consecutiveFailures: number;
  openUntil: number;
}

/**
 * Per-route circuit breaker (spec 8.3 «cortacircuito»). A tripped route is skipped until its
 * cooldown ends; then the next call tries it again (half-open) and a success closes it.
 * The clock is injected so tests and the eval can drive it.
 */
export class CircuitBreaker {
  private readonly states = new Map<string, RouteState>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly policy: BreakerPolicy = DEFAULT_BREAKER_POLICY,
  ) {}

  isOpen(routeId: string): boolean {
    const state = this.states.get(routeId);
    return state !== undefined && state.openUntil > this.now();
  }

  /** Epoch ms until which the route is skipped (0 when closed). */
  openUntil(routeId: string): number {
    const state = this.states.get(routeId);
    return state && state.openUntil > this.now() ? state.openUntil : 0;
  }

  recordSuccess(routeId: string): void {
    this.states.delete(routeId);
  }

  /** Returns the cooldown applied (0 = the route stays available). */
  recordFailure(routeId: string, kind: RouteFailureKind, retryAfterMs?: number): number {
    const state = this.states.get(routeId) ?? { consecutiveFailures: 0, openUntil: 0 };
    state.consecutiveFailures += 1;
    const cooldown = this.cooldownFor(kind, state.consecutiveFailures, retryAfterMs);
    state.openUntil = cooldown > 0 ? this.now() + cooldown : state.openUntil;
    this.states.set(routeId, state);
    return cooldown;
  }

  private cooldownFor(kind: RouteFailureKind, failures: number, retryAfterMs?: number): number {
    const p = this.policy;
    switch (kind) {
      case 'rate_limit':
        return Math.min(retryAfterMs ?? p.rateLimitCooldownMs, p.configCooldownMs);
      case 'server':
      case 'timeout':
      case 'network':
      case 'empty':
        return Math.min(p.baseCooldownMs * 2 ** (failures - 1), p.maxCooldownMs);
      case 'invalid_output':
        return p.invalidOutputCooldownMs;
      case 'auth':
      case 'not_found':
        return p.configCooldownMs;
      case 'bad_request':
      case 'unsupported':
        return 0;
    }
  }
}
