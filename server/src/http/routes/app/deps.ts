import type { MiddlewareHandler } from 'hono';
import {
  type AuthEnv,
  type AuthRateLimits,
  type CookieSettings,
  createAuthMiddleware,
  createScryptPinHasher,
  DEFAULT_AUTH_RATE_LIMITS,
  type PinHasher,
} from '../../../auth/index.js';
import { getConfig } from '../../../config.js';
import type { Db } from '../../../db/client.js';
import type { BlobStorage } from '../../../storage/blob-storage.js';
import { PostgresBlobStorage } from '../../../storage/postgres-blob-storage.js';
import type { ChatRouteOptions } from './chat.js';

export interface WebAppRouterDeps {
  db: Db;
  /** Clock (tests). */
  now?: () => Date;
  /** Default: scrypt with the OWASP parameters (tests pass a cheaper one). */
  pinHasher?: PinHasher;
  /** Secure cookies; default on in production. */
  secureCookies?: boolean;
  rateLimits?: AuthRateLimits;
  /** For account deletion; default: the encrypted Postgres storage (D45). */
  storage?: Pick<BlobStorage, 'delete'>;
  /** Report files (5.10); default: the same encrypted Postgres storage. */
  reportStorage?: BlobStorage;
  /** The chat's AI layer and logger; default: built lazily from the config (tests, scripts). */
  chat?: ChatRouteOptions;
}

export interface RouteDeps {
  db: Db;
  now: () => Date;
  pinHasher: PinHasher;
  cookies: CookieSettings;
  rateLimits: AuthRateLimits;
  storage: () => Pick<BlobStorage, 'delete'>;
  reportStorage: () => BlobStorage;
  requireSession: MiddlewareHandler<AuthEnv>;
  requireRecentPin: MiddlewareHandler<AuthEnv>;
}

export function resolveDeps(deps: WebAppRouterDeps): RouteDeps {
  const now = deps.now ?? (() => new Date());
  let fallbackStorage: BlobStorage | undefined;
  // Lazy: the router is built in tests without an encryption key.
  const defaultStorage = () => {
    fallbackStorage ??= new PostgresBlobStorage(deps.db, getConfig().encryptionKey);
    return fallbackStorage;
  };
  return {
    db: deps.db,
    now,
    pinHasher: deps.pinHasher ?? createScryptPinHasher(),
    cookies: { secure: deps.secureCookies ?? process.env.NODE_ENV === 'production' },
    rateLimits: deps.rateLimits ?? DEFAULT_AUTH_RATE_LIMITS,
    storage: () => deps.storage ?? defaultStorage(),
    reportStorage: () => deps.reportStorage ?? defaultStorage(),
    ...createAuthMiddleware({ db: deps.db, now }),
  };
}
