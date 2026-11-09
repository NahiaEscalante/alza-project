import { Hono } from 'hono';
import type { Db } from '../db/client.js';
import { createWaitlistRouter } from './routes/waitlist.js';

export interface ApiDeps {
  db: Db;
}

/**
 * `/api` router (contracts in spec 10.4). Every unknown `/api/*` path answers JSON 404 so it never
 * falls through to the web app.
 */
export function createApiRouter(deps: ApiDeps): Hono {
  const api = new Hono();
  api.get('/', (c) => c.json({ service: 'alza', status: 'ok' }));
  api.route('/waitlist', createWaitlistRouter({ db: deps.db }));
  api.all('*', (c) => c.json({ error: 'not_found' }, 404));
  return api;
}
