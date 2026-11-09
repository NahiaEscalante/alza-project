import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Local development: DATABASE_URL_TEST comes from the repo-root .env. Existing env vars win.
if (existsSync('../.env')) process.loadEnvFile('../.env');

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['./test/global-setup.ts'],
    env: { NODE_ENV: 'test' },
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
