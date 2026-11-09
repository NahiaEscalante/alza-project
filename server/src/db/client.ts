import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Logger } from '../lib/logger.js';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;
export type Pool = pg.Pool;

export interface PoolSettings {
  max?: number;
  connectionTimeoutMillis?: number;
  applicationName?: string;
  logger?: Logger;
}

export function createPool(connectionString: string, settings: PoolSettings = {}): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max: settings.max ?? 10,
    connectionTimeoutMillis: settings.connectionTimeoutMillis ?? 5_000,
    application_name: settings.applicationName ?? 'alza-server',
  });
  // An idle client can error (e.g. the DB restarts); without a listener the process would crash.
  pool.on('error', (err) => settings.logger?.error({ err }, 'postgres pool error'));
  return pool;
}

export function createDb(pool: pg.Pool): Db {
  return drizzle({ client: pool, schema });
}
