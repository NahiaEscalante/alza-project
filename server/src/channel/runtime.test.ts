import { describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import { createChannelRuntime } from './runtime.js';
import { SIMULATOR_APP_SECRET } from './signature.js';

const db = {} as Db;
const whatsapp = {
  apiVersion: 'v25.0',
  accessToken: 'test-token',
  phoneNumberId: '12345',
  appSecret: 'meta-secret',
  verifyToken: 'verify-token',
};
describe('channel runtime', () => {
  it('keeps the simulator and its signing secret together even with Meta credentials present', () => {
    const runtime = createChannelRuntime(db, { simulatorEnabled: true, whatsapp });
    expect(runtime.channel.kind).toBe('simulator');
    expect(runtime.store).not.toBeNull();
    expect(runtime.appSecret).toBe(SIMULATOR_APP_SECRET);
    expect(runtime.verifyToken).toBeNull();
  });
  it('selects Meta and disables the simulator when configured for the real transport', () => {
    const runtime = createChannelRuntime(db, { simulatorEnabled: false, whatsapp });
    expect(runtime.channel.kind).toBe('meta');
    expect(runtime.store).toBeNull();
    expect(runtime.appSecret).toBe('meta-secret');
    expect(runtime.verifyToken).toBe('verify-token');
  });
  it('selects 360dialog without leaving the Meta webhook active', () => {
    const runtime = createChannelRuntime(db, {
      simulatorEnabled: false,
      whatsapp,
      whatsappProvider: 'dialog360',
      dialog360: { apiKey: 'sandbox-key', webhookToken: 'x'.repeat(64) },
    });
    expect(runtime.channel.kind).toBe('dialog360');
    expect(runtime.appSecret).toBeNull();
    expect(runtime.verifyToken).toBeNull();
  });

  it('selects Telegram only with CHANNEL_PROVIDER=telegram, never the WhatsApp webhook', () => {
    const runtime = createChannelRuntime(db, {
      simulatorEnabled: true,
      whatsapp,
      channelProvider: 'telegram',
      telegram: {
        botToken: `123456789:${'a'.repeat(35)}`,
        webhookSecret: 's'.repeat(48),
        polling: false,
        dailyInboundCap: 150,
      },
    });
    expect(runtime.channel.kind).toBe('telegram');
    expect(runtime.telegram).toBe(runtime.channel);
    expect(runtime.store).toBeNull();
    expect(runtime.appSecret).toBeNull();
    expect(runtime.verifyToken).toBeNull();
  });

  it('without the new variables the legacy selection is unchanged', () => {
    for (const config of [
      { simulatorEnabled: true, whatsapp },
      { simulatorEnabled: false, whatsapp },
      { simulatorEnabled: false, whatsapp: null },
    ]) {
      const legacy = createChannelRuntime(db, config);
      const explicitNull = createChannelRuntime(db, { ...config, channelProvider: null });
      expect(explicitNull.channel.kind).toBe(legacy.channel.kind);
      expect(legacy.telegram).toBeNull();
    }
    expect(
      createChannelRuntime(db, { simulatorEnabled: true, whatsapp, channelProvider: 'meta' })
        .channel.kind,
    ).toBe('meta');
  });

  it('disables the webhook and fails without credentials or a simulator', async () => {
    const runtime = createChannelRuntime(db, { simulatorEnabled: false, whatsapp: null });
    expect(runtime.appSecret).toBeNull();
    expect(runtime.verifyToken).toBeNull();
    await expect(runtime.channel.markAsRead('wamid.test')).rejects.toMatchObject({
      code: 'unavailable',
    });
  });
});
