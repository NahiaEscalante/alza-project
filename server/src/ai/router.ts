import type { ExtractionFunction } from '../db/schema.js';
import type { Logger } from '../lib/logger.js';
import { CircuitBreaker, type RouteFailureKind } from './circuit-breaker.js';
import { type ProviderClient, type ProviderName, toProviderError } from './providers/types.js';

/** AI layer functions (8.3), same names as `extractions.function`. */
export type AiFunction = ExtractionFunction;

/** One way to serve a function: provider + model + key. Each Gemini key is its own route. */
export interface Route {
  /** Stable id for logs and stats, e.g. `groq:openai/gpt-oss-120b`, `gemini#2:gemini-3.5-flash`. */
  id: string;
  provider: ProviderName;
  model: string;
  client: ProviderClient;
  /** transcribe_audio only: Whisper endpoint or an LLM that accepts audio. */
  transcription?: 'whisper' | 'llm';
}

/** Ordered routes per function: the first available one is tried first. */
export type RouteTable = Partial<Record<AiFunction, Route[]>>;

/** Stored with every extraction (8.3): which model and prompt produced it. */
export interface AiMeta {
  provider: ProviderName;
  model: string;
  promptVersion: string;
  routeId: string;
  latencyMs: number;
  /** Calls made, including failed routes. */
  attempts: number;
}

/**
 * - unavailable: every route failed or is cooling down → retry the job later (RF-IN-05).
 * - invalid_output: the output failed validation twice → clarification or error (8.3).
 * - no_routes: nothing configured for this function (missing keys).
 * - not_implemented: kept for functions not built yet.
 */
export type AiFailureKind = 'unavailable' | 'invalid_output' | 'no_routes' | 'not_implemented';

export type AiResult<T> =
  | { ok: true; value: T; meta: AiMeta }
  | { ok: false; error: AiFailureKind; attempts: number };

/** Returned by an attempt whose output failed validation. `reason` is a code, never content. */
export class InvalidOutput {
  constructor(readonly reason: string) {}
}

export type Attempt<T> = (route: Route, signal: AbortSignal) => Promise<T | InvalidOutput>;

export interface RouteStats {
  routeId: string;
  fn: AiFunction;
  calls: number;
  ok: number;
  failures: Partial<Record<RouteFailureKind, number>>;
  latencyMsTotal: number;
  latencyMsMax: number;
}

export interface AiRouterOptions {
  routes: RouteTable;
  logger?: Logger;
  breaker?: CircuitBreaker;
  /** Validation failures tolerated per call: the first one is retried once (8.3). */
  maxInvalidOutputs?: number;
  /** Wall clock (ms) for the circuit breaker. Latency always uses `performance.now()`. */
  now?: () => number;
  /** Monotonic clock for latency (tests). */
  monotonic?: () => number;
}

/**
 * Runs a call over the ordered routes of a function with automatic failover (D35):
 * 429/5xx/timeouts/invalid output trip the route's circuit breaker and the next route is tried.
 * Logs carry route id, function, latency and outcome only.
 */
export class AiRouter {
  private readonly routes: RouteTable;
  private readonly logger: Logger | undefined;
  private readonly breaker: CircuitBreaker;
  private readonly maxInvalidOutputs: number;
  private readonly now: () => number;
  private readonly monotonic: () => number;
  private readonly statsByKey = new Map<string, RouteStats>();

  constructor(options: AiRouterOptions) {
    this.routes = options.routes;
    this.logger = options.logger;
    this.now = options.now ?? Date.now;
    this.monotonic = options.monotonic ?? (() => performance.now());
    this.breaker = options.breaker ?? new CircuitBreaker(this.now);
    this.maxInvalidOutputs = options.maxInvalidOutputs ?? 2;
  }

  routesFor(fn: AiFunction): Route[] {
    return this.routes[fn] ?? [];
  }

  async run<T>(
    fn: AiFunction,
    promptVersion: string,
    timeoutMs: number,
    attempt: Attempt<T>,
  ): Promise<AiResult<T>> {
    const routes = this.routesFor(fn);
    if (routes.length === 0) return { ok: false, error: 'no_routes', attempts: 0 };

    let attempts = 0;
    let invalid = 0;
    for (const route of routes) {
      if (this.breaker.isOpen(route.id)) continue;
      attempts += 1;
      const started = this.monotonic();
      let outcome: T | InvalidOutput;
      try {
        outcome = await attempt(route, AbortSignal.timeout(timeoutMs));
      } catch (err) {
        const error = toProviderError(err);
        const latencyMs = Math.round(this.monotonic() - started);
        const cooldownMs = this.breaker.recordFailure(route.id, error.kind, error.retryAfterMs);
        this.record(fn, route.id, error.kind, latencyMs);
        this.logger?.warn(
          {
            fn,
            routeId: route.id,
            latencyMs,
            outcome: error.kind,
            status: error.status,
            cooldownMs,
          },
          'ai call failed',
        );
        continue;
      }
      const latencyMs = Math.round(this.monotonic() - started);
      if (outcome instanceof InvalidOutput) {
        invalid += 1;
        const cooldownMs = this.breaker.recordFailure(route.id, 'invalid_output');
        this.record(fn, route.id, 'invalid_output', latencyMs);
        this.logger?.warn(
          {
            fn,
            routeId: route.id,
            latencyMs,
            outcome: 'invalid_output',
            reason: outcome.reason,
            cooldownMs,
          },
          'ai call failed',
        );
        if (invalid >= this.maxInvalidOutputs) {
          return { ok: false, error: 'invalid_output', attempts };
        }
        continue;
      }
      this.breaker.recordSuccess(route.id);
      this.record(fn, route.id, 'ok', latencyMs);
      this.logger?.info({ fn, routeId: route.id, latencyMs, outcome: 'ok' }, 'ai call');
      return {
        ok: true,
        value: outcome,
        meta: {
          provider: route.provider,
          model: route.model,
          promptVersion,
          routeId: route.id,
          latencyMs,
          attempts,
        },
      };
    }
    return { ok: false, error: invalid > 0 ? 'invalid_output' : 'unavailable', attempts };
  }

  /** Usage and latency per function and route (eval report, admin panel later). */
  stats(): RouteStats[] {
    return [...this.statsByKey.values()].map((s) => ({ ...s, failures: { ...s.failures } }));
  }

  private record(
    fn: AiFunction,
    routeId: string,
    outcome: RouteFailureKind | 'ok',
    latencyMs: number,
  ): void {
    const key = `${fn}|${routeId}`;
    const stats = this.statsByKey.get(key) ?? {
      routeId,
      fn,
      calls: 0,
      ok: 0,
      failures: {},
      latencyMsTotal: 0,
      latencyMsMax: 0,
    };
    stats.calls += 1;
    if (outcome === 'ok') stats.ok += 1;
    else stats.failures[outcome] = (stats.failures[outcome] ?? 0) + 1;
    stats.latencyMsTotal += latencyMs;
    stats.latencyMsMax = Math.max(stats.latencyMsMax, latencyMs);
    this.statsByKey.set(key, stats);
  }
}
