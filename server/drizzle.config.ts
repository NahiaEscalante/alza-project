import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

// `generate` only reads the schema; the URL is needed by `drizzle-kit studio` / `check`.
if (existsSync('../.env')) process.loadEnvFile('../.env');

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
});
