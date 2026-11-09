/**
 * CLI: `npm run db:migrate` (dev, tsx) or `npm run db:migrate:dist -w server` (after build).
 * Only needs DATABASE_URL, so it runs before the rest of the config exists.
 */
import { runMigrations } from '../db/migrate.js';
import { loadDotEnv } from '../paths.js';

loadDotEnv();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

try {
  await runMigrations(url);
  console.log('Migrations applied');
} catch (err) {
  console.error('Migration failed:', err instanceof Error ? err.message : err);
  process.exit(1);
}
