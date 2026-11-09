import type { Context } from 'hono';
import {
  type AdminIdentity,
  type AdminSessionStore,
  createAdminSessionStore,
  createCredentialVerifier,
  type JobRunner,
  type TechnicalIssueBroadcaster,
} from '../../../admin/index.js';
import {
  createScryptPinHasher,
  type PinHasher,
  type RateLimitSettings,
} from '../../../auth/index.js';
import { getConfig } from '../../../config.js';
import type { Db } from '../../../db/client.js';
import { createJobRunner } from '../../../jobs/registry.js';
import { createLogger, type Logger } from '../../../lib/logger.js';
import type { InboundQueue } from '../../../pipeline/deps.js';
import type { BlobStorage } from '../../../storage/blob-storage.js';
import { PostgresBlobStorage } from '../../../storage/postgres-blob-storage.js';

export interface AdminRateLimits {
  /** Every `/api/admin/auth/*` request, per client IP. */
  perIp: RateLimitSettings;
  /** Login attempts per username. */
  perUsername: RateLimitSettings;
}

export const DEFAULT_ADMIN_RATE_LIMITS: AdminRateLimits = {
  perIp: { limit: 30, windowMs: 10 * 60_000 },
  perUsername: { limit: 5, windowMs: 15 * 60_000 },
};

export interface AdminRouterOptions {
  db: Db;
  logger?: Logger;
  /** Clock (tests). */
  now?: () => Date;
  /** Default: scrypt with the OWASP parameters (tests pass a cheaper one). */
  passwordHasher?: PinHasher;
  /** Secure cookie; default on in production. */
  secureCookies?: boolean;
  rateLimits?: AdminRateLimits;
  sessions?: AdminSessionStore;
  /** RF-AD-01 retry. Null: «Reintentar» answers 503. */
  queue?: InboundQueue | null;
  /** Demo tools. Default: `createJobRunner` on this database (no pg-boss needed). */
  jobs?: JobRunner | null;
  /** WA-17 (case 24). Null: the button says it is not connected on this server. */
  broadcastTechnicalIssue?: TechnicalIssueBroadcaster | null;
}

export interface AdminEnv {
  Variables: { admin: AdminIdentity; adminToken: string };
}

export interface AdminRouteDeps {
  db: Db;
  logger: Logger;
  now: () => Date;
  secureCookies: boolean;
  rateLimits: AdminRateLimits;
  sessions: AdminSessionStore;
  verifyCredentials: ReturnType<typeof createCredentialVerifier>;
  queue: InboundQueue | null;
  jobs: () => JobRunner;
  broadcastTechnicalIssue: TechnicalIssueBroadcaster | null;
}

export function resolveAdminDeps(options: AdminRouterOptions): AdminRouteDeps {
  const now = options.now ?? (() => new Date());
  const logger = options.logger ?? createLogger({ level: 'silent' });
  let storage: BlobStorage | undefined;
  let runner: JobRunner | undefined = options.jobs ?? undefined;
  return {
    db: options.db,
    logger,
    now,
    secureCookies: options.secureCookies ?? process.env.NODE_ENV === 'production',
    rateLimits: options.rateLimits ?? DEFAULT_ADMIN_RATE_LIMITS,
    sessions: options.sessions ?? createAdminSessionStore(),
    verifyCredentials: createCredentialVerifier(
      options.db,
      options.passwordHasher ?? createScryptPinHasher(),
    ),
    queue: options.queue ?? null,
    // Lazy: the router is built in tests without an encryption key. Only the retention job
    // deletes files, and the panel never runs it.
    jobs: () => {
      runner ??= createJobRunner({
        db: options.db,
        logger,
        now,
        storage: {
          delete: (key) => {
            storage ??= new PostgresBlobStorage(options.db, getConfig().encryptionKey);
            return storage.delete(key);
          },
        },
      });
      return runner;
    },
    broadcastTechnicalIssue: options.broadcastTechnicalIssue ?? null,
  };
}

/** Error bodies: `{ error, message }`, message in Spanish (the team reads it). */
export function adminError(
  c: Context,
  status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 503,
  error: string,
  message: string,
): Response {
  return c.json({ error, message }, status);
}

export const ADMIN_MESSAGES = {
  unauthorized: 'Inicia sesión para usar el panel.',
  invalid_credentials: 'Usuario o contraseña incorrectos.',
  rate_limited: 'Demasiados intentos. Espera unos minutos.',
  not_found: 'No encontramos ese registro.',
  not_failed: 'Ese mensaje ya no está en error definitivo.',
  queue_unavailable: 'La cola de mensajes no está conectada en este servidor.',
  not_in_review: 'Ese canje ya fue revisado.',
  not_open: 'Esa alerta ya fue revisada.',
  future_day: 'Ese día todavía no empieza.',
  job_failed: 'La tarea terminó con errores. Revisa los registros del servidor.',
  confirm_required: 'Confirma la acción para continuar.',
  broadcast_unavailable: 'El aviso WA-17 no está conectado en este servidor.',
} as const;
