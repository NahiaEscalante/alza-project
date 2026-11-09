/** Register the sandbox callback after deploying the matching receiver. Never prints its secret URL. */
import { z } from 'zod';
import { DIALOG360_SANDBOX_URL } from '../channel/dialog360.js';
import { getConfig } from '../config.js';
import { loadDotEnv } from '../paths.js';

loadDotEnv();
const config = getConfig();
const sandbox = config.dialog360;
if (!sandbox) throw new Error('DIALOG360_API_KEY and DIALOG360_WEBHOOK_TOKEN are required');
const baseArg = process.argv
  .find((arg) => arg.startsWith('--base-url='))
  ?.slice('--base-url='.length);
const base = new URL(baseArg ?? config.appBaseUrl);
if (
  base.protocol !== 'https:' ||
  base.username ||
  base.password ||
  base.search ||
  base.hash ||
  base.pathname !== '/'
) {
  throw new Error('Use a public HTTPS origin with --base-url=https://your-domain');
}
const url = new URL(`/webhook/dialog360/${sandbox.webhookToken}`, base).href;
try {
  // Confirm that this receiver is deployed before updating the provider's callback.
  const probe = await fetch(url, {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entry: [] }),
    signal: AbortSignal.timeout(15000),
  });
  const ready = z.object({ ok: z.literal(true) }).safeParse(await probe.json().catch(() => null));
  if (!probe.ok || !ready.success) throw new Error('The deployed sandbox receiver is not ready');
  const response = await fetch(`${DIALOG360_SANDBOX_URL}/configs/webhook`, {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json', 'D360-API-KEY': sandbox.apiKey },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(15000),
  });
  // Provider may echo the entire secret URL. Do not print its response body.
  await response.body?.cancel();
  console.log(`360dialog webhook configuration: HTTP ${response.status}`);
  if (!response.ok) process.exitCode = 1;
} catch {
  console.error('Could not configure 360dialog. Confirm deployment, credentials and HTTPS origin.');
  process.exitCode = 1;
}
