import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Absolute paths used at runtime. This file lives in `server/src` (or `server/dist` after build),
 * so `..` is always the server package root.
 */
export const SERVER_ROOT = resolve(import.meta.dirname, '..');
export const REPO_ROOT = resolve(SERVER_ROOT, '..');
export const MIGRATIONS_DIR = resolve(SERVER_ROOT, 'drizzle');
export const WEB_DIST_DIR = resolve(REPO_ROOT, 'web', 'dist');
export const DOTENV_PATH = resolve(REPO_ROOT, '.env');

/**
 * Loads the repo-root `.env` into `process.env` when it exists (local development).
 * Variables already set in the environment win, so hosting platforms are never overridden.
 */
export function loadDotEnv(path: string = DOTENV_PATH): void {
  if (existsSync(path)) process.loadEnvFile(path);
}
