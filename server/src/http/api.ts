import { Hono } from 'hono';

/**
 * `/api` router (contracts in spec 10.4). Placeholder until Fase 7: every unknown `/api/*` path
 * answers JSON 404 so it never falls through to the web app.
 */
export function createApiRouter(): Hono {
  const api = new Hono();
  api.get('/', (c) => c.json({ service: 'alza', status: 'ok' }));
  api.all('*', (c) => c.json({ error: 'not_found' }, 404));
  return api;
}
