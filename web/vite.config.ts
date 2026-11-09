import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig(({ mode }) => {
  // Only PORT (the server's port) is read from the repo-root .env. The client bundle reads env
  // files from web/ (none exist), so no secret can reach the browser.
  const { PORT } = loadEnv(mode, repoRoot, 'PORT');
  const server = `http://localhost:${PORT || '3000'}`;

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: { '/api': server, '/health': server },
    },
    build: { target: 'es2020' },
  };
});
