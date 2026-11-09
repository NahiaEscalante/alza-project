import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestDb, hasTestDb } from '../../test/db.js';
import { createDb, createPool } from '../db/client.js';
import { createLogger } from '../lib/logger.js';
import { createApp } from './app.js';

const logger = createLogger({ level: 'silent' });

describe.skipIf(!hasTestDb)('GET /health', () => {
  const { pool, db } = createTestDb();
  afterAll(() => pool.end());

  it('answers 200 when the database responds', async () => {
    const res = await createApp({ db, logger }).request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', db: 'ok' });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('createApp', () => {
  // Nothing listens on port 1: the ping fails fast.
  const deadPool = createPool('postgres://alza:alza@127.0.0.1:1/alza', {
    connectionTimeoutMillis: 500,
  });
  const deadDb = createDb(deadPool);
  afterAll(() => deadPool.end());

  it('answers /health 503 when the database is down', async () => {
    const res = await createApp({ db: deadDb, logger, healthTimeoutMs: 1_000 }).request('/health');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: 'error', db: 'error' });
  });

  it('mounts the /api router and answers JSON 404 for unknown paths', async () => {
    const app = createApp({ db: deadDb, logger });
    const api = await app.request('/api');
    expect(api.status).toBe(200);
    expect(await api.json()).toEqual({ service: 'alza', status: 'ok' });

    const missing = await app.request('/api/nope');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'not_found' });

    expect((await app.request('/app/inicio')).status).toBe(404);
  });

  it('mounts the internal panel API with its own authentication', async () => {
    const app = createApp({ db: deadDb, logger, admin: { logger } });
    const res = await app.request('/api/admin/unknown');
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('sets security headers', async () => {
    const res = await createApp({ db: deadDb, logger }).request('/api');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('logs the matched route pattern, never the raw path or query (RNF-09)', async () => {
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const app = createApp({ db: deadDb, logger: createLogger({ level: 'debug', destination }) });
    await app.request('/api/a/f3c9secret?token=t0ps3cret');
    const [line] = lines.map((l) => JSON.parse(l));
    expect(line).toMatchObject({ method: 'GET', route: '/api/*', status: 404 });
    expect(lines.join('')).not.toMatch(/f3c9secret|t0ps3cret/);
  });

  describe('serving the built web app (production)', () => {
    const dist = mkdtempSync(join(tmpdir(), 'alza-web-'));
    mkdirSync(join(dist, 'assets'));
    writeFileSync(
      join(dist, 'index.html'),
      '<!doctype html><title>ALZA</title><div id="root"></div>',
    );
    writeFileSync(join(dist, 'assets', 'index-abc123.js'), 'console.log(1);\n'.repeat(200));
    const app = createApp({ db: deadDb, logger, webDistDir: dist });
    afterAll(() => rmSync(dist, { recursive: true, force: true }));

    it('serves index.html at / and as SPA fallback', async () => {
      for (const path of ['/', '/app', '/app/movimientos/2026-11-08']) {
        const res = await app.request(path);
        expect(res.status, path).toBe(200);
        expect(await res.text()).toContain('<title>ALZA</title>');
      }
    });

    it('serves hashed assets with long cache, and 404 for missing ones', async () => {
      const res = await app.request('/assets/index-abc123.js');
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toContain('immutable');
      expect((await app.request('/assets/missing.js')).status).toBe(404);
    });

    it('compresses text assets when the browser accepts gzip (RNF-06)', async () => {
      const res = await app.request('/assets/index-abc123.js', {
        headers: { 'Accept-Encoding': 'gzip' },
      });
      expect(res.headers.get('content-encoding')).toBe('gzip');
      expect((await res.arrayBuffer()).byteLength).toBeLessThan(200 * 'console.log(1);\n'.length);
    });

    it('keeps /api out of the fallback', async () => {
      const res = await app.request('/api/nope');
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'not_found' });
    });
  });
});
