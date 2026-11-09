/**
 * Telegram webhook status (D71), read only: `npm run telegram:status -w server`.
 * Prints the bot username and `getWebhookInfo` (host and path of the webhook, pending updates,
 * last error). The bot token and the webhook secret are never printed.
 */
import { TelegramBotApi } from '../channel/telegram-api.js';
import { ChannelError } from '../channel/types.js';
import { TELEGRAM_BOT_TOKEN_PATTERN } from '../config.js';
import { loadDotEnv } from '../paths.js';

loadDotEnv();

const token = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? '';
if (!TELEGRAM_BOT_TOKEN_PATTERN.test(token)) {
  console.error('TELEGRAM_BOT_TOKEN is missing or invalid.');
  process.exit(1);
}
const api = new TelegramBotApi({ botToken: token });

try {
  const bot = await api.getMe();
  const info = await api.getWebhookInfo();
  console.log(`Bot: @${bot.username}`);
  if (info.url === '') {
    console.log('Webhook: not set (updates wait for getUpdates / local polling).');
  } else {
    const target = new URL(info.url);
    console.log(`Webhook: ${target.host}${target.pathname}`);
  }
  console.log(`Pending updates: ${info.pending_update_count}`);
  if (info.allowed_updates) console.log(`Allowed updates: ${info.allowed_updates.join(', ')}`);
  if (info.last_error_date) {
    const when = new Date(info.last_error_date * 1000).toISOString();
    // Telegram's message describes our server's answer (e.g. «Wrong response: 401»), no secrets.
    console.log(`Last error: ${when} · ${(info.last_error_message ?? '').slice(0, 120)}`);
  }
} catch (err) {
  console.error(
    `Telegram status failed: ${err instanceof ChannelError ? err.message : 'request failed'}`,
  );
  process.exitCode = 1;
}
