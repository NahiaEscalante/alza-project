import pg from 'pg';
import { runMigrations } from '../src/db/migrate.js';

/**
 * Runs once per `vitest run`: wipes the test database and applies every migration from scratch,
 * so migrations are exercised on each run. Refuses to touch a database not named `*_test`.
 */
export default async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) {
    console.warn('[test] DATABASE_URL_TEST is not set: database tests will be skipped');
    return;
  }
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to reset "${dbName}": the test database name must end with _test`);
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`
      drop schema if exists public cascade;
      drop schema if exists drizzle cascade;
      drop schema if exists pgboss cascade;
      create schema public;
    `);
  } finally {
    await client.end();
  }
  await runMigrations(url);
}
