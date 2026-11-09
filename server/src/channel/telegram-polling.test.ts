import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../lib/logger.js';
import type { TelegramUpdate, WebhookInfo } from './telegram-api.js';
import { startTelegramPolling } from './telegram-polling.js';
import { ChannelError } from './types.js';

const logger = createLogger({ level: 'silent' });
const info = (url: string): WebhookInfo => ({ url, pending_update_count: 0 });

function fakeApi(batches: TelegramUpdate[][], webhookUrl = '') {
  const offsets: number[] = [];
  const api = {
    getWebhookInfo: vi.fn(async () => info(webhookUrl)),
    deleteWebhook: vi.fn(async () => true as const),
    getUpdates: vi.fn(async (params: { offset: number }, signal?: AbortSignal) => {
      offsets.push(params.offset);
      const next = batches.shift();
      if (next) return next;
      // Long poll until stopped.
      await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve()));
      throw new ChannelError('unavailable', 'aborted');
    }),
  };
  return { api, offsets };
}

describe('Telegram long polling (development)', () => {
  it('handles updates in order and moves the offset past each one', async () => {
    const { api, offsets } = fakeApi([[{ update_id: 5 }, { update_id: 6 }], [{ update_id: 9 }]]);
    const handled: number[] = [];
    const poller = startTelegramPolling({
      api,
      logger,
      handle: async (update) => {
        handled.push(update.update_id);
      },
      sleep: async () => undefined,
    });
    await vi.waitFor(() => expect(offsets).toEqual([0, 7, 10]));
    await poller.stop();
    expect(handled).toEqual([5, 6, 9]);
    expect(api.deleteWebhook).toHaveBeenCalledOnce();
  });

  it('retries a failing update, then skips it', async () => {
    const { api, offsets } = fakeApi([[{ update_id: 1 }]]);
    const handle = vi.fn(async () => {
      throw new Error('db down');
    });
    const poller = startTelegramPolling({ api, logger, handle, sleep: async () => undefined });
    await vi.waitFor(() => expect(offsets).toEqual([0, 2]));
    await poller.stop();
    expect(handle).toHaveBeenCalledTimes(3);
  });

  it('never removes a registered webhook (the deployed bot would go silent)', async () => {
    const { api } = fakeApi([], 'https://alza.example/webhook/telegram');
    const poller = startTelegramPolling({ api, logger, handle: async () => undefined });
    await poller.done;
    expect(api.deleteWebhook).not.toHaveBeenCalled();
    expect(api.getUpdates).not.toHaveBeenCalled();
  });
});
