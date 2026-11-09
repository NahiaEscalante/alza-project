/**
 * Registers the Telegram webhook (D71) after deploying the matching receiver:
 *
 *   npm run telegram:setup -w server -- --base-url=https://alza-project-production.up.railway.app
 *
 * 1. `getMe`: the token works; prints the bot username.
 * 2. Probes `POST /webhook/telegram` with the secret and an empty update: the deployed server
 *    must answer 200 (it has `CHANNEL_PROVIDER=telegram` and the same secret).
 * 3. `setWebhook` with the secret and `allowed_updates` [message, callback_query].
 *
 * `--delete-webhook` removes it instead (rollback, or local polling with this same bot).
 * Prints only HTTP status codes and the bot username: never the token or the secret.
 * Reads TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET from the environment or the root `.env`.
 */
import { z } from 'zod';
import { TelegramBotApi } from '../channel/telegram-api.js';
import { ChannelError } from '../channel/types.js';
import { TELEGRAM_BOT_TOKEN_PATTERN, TELEGRAM_WEBHOOK_SECRET_PATTERN } from '../config.js';
import { TELEGRAM_SECRET_HEADER } from '../http/routes/telegram.js';
import { loadDotEnv } from '../paths.js';

loadDotEnv();

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const token = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? '';
if (!TELEGRAM_BOT_TOKEN_PATTERN.test(token)) fail('TELEGRAM_BOT_TOKEN is missing or invalid.');
const api = new TelegramBotApi({ botToken: token });
const describe = (err: unknown) =>
  err instanceof ChannelError ? err.message : 'request failed (network or timeout)';

let username: string;
try {
  username = (await api.getMe()).username;
  console.log(`Bot: @${username} (getMe OK)`);
} catch (err) {
  fail(`getMe failed: ${describe(err)}. Check TELEGRAM_BOT_TOKEN.`);
}

if (process.argv.includes('--delete-webhook')) {
  try {
    await api.deleteWebhook();
    console.log('Webhook removed (deleteWebhook OK). The deployed bot no longer receives updates.');
  } catch (err) {
    fail(`deleteWebhook failed: ${describe(err)}`);
  }
  process.exit(0);
}

const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() ?? '';
if (!TELEGRAM_WEBHOOK_SECRET_PATTERN.test(secret)) {
  fail('TELEGRAM_WEBHOOK_SECRET is missing or invalid (32–256 of A-Z a-z 0-9 _ -).');
}
const baseArg = process.argv
  .find((arg) => arg.startsWith('--base-url='))
  ?.slice('--base-url='.length);
const origin = URL.parse(baseArg ?? '') ?? fail('Use --base-url=https://your-domain');
if (
  origin.protocol !== 'https:' ||
  origin.username ||
  origin.password ||
  origin.search ||
  origin.hash ||
  origin.pathname !== '/'
) {
  fail('Use a public HTTPS origin with --base-url=https://your-domain');
}
const url = new URL('/webhook/telegram', origin).href;

// The deployed receiver must accept this secret before Telegram is pointed at it.
try {
  const probe = await fetch(url, {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json', [TELEGRAM_SECRET_HEADER]: secret },
    body: JSON.stringify({ update_id: 0 }),
    signal: AbortSignal.timeout(15_000),
  });
  const ready = z.object({ ok: z.literal(true) }).safeParse(await probe.json().catch(() => null));
  console.log(`Receiver probe: HTTP ${probe.status}`);
  if (!probe.ok || !ready.success) {
    fail(
      'The deployed receiver is not ready: deploy, run migrations, set CHANNEL_PROVIDER=telegram ' +
        'and the same TELEGRAM_WEBHOOK_SECRET in Railway, then try again.',
    );
  }
} catch {
  fail('Could not reach the deployed receiver. Check the deployment and the HTTPS origin.');
}

try {
  await api.setWebhook({ url, secretToken: secret });
  console.log(`setWebhook OK for @${username}: updates go to ${origin.host}/webhook/telegram`);
} catch (err) {
  fail(`setWebhook failed: ${describe(err)}`);
}
