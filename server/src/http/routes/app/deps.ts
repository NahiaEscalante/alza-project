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
}

export interface RouteDeps {
  db: Db;
  now: () => Date;
  pinHasher: PinHasher;
  cookies: CookieSettings;
  rateLimits: AuthRateLimits;
  storage: () => Pick<BlobStorage, 'delete'>;
  requireSession: MiddlewareHandler<AuthEnv>;
  requireRecentPin: MiddlewareHandler<AuthEnv>;
}

export function resolveDeps(deps: WebAppRouterDeps): RouteDeps {
  const now = deps.now ?? (() => new Date());
  let storage = deps.storage;
  return {
    db: deps.db,
    now,
    pinHasher: deps.pinHasher ?? createScryptPinHasher(),
    cookies: { secure: deps.secureCookies ?? process.env.NODE_ENV === 'production' },
    rateLimits: deps.rateLimits ?? DEFAULT_AUTH_RATE_LIMITS,
    // Lazy: the router is built in tests without an encryption key.
    storage: () => {
      storage ??= new PostgresBlobStorage(deps.db, getConfig().encryptionKey);
      return storage;
    },
    ...createAuthMiddleware({ db: deps.db, now }),
  };
}
