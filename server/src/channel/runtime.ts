/**
 * Select one transport and its webhook credentials together: never mix Meta with the simulator.
 *
 * `CHANNEL_PROVIDER` (D71) picks it explicitly: `simulator`, `meta`, `dialog360` or `telegram`.
 * Unset, the legacy rules stay exactly as before: `SIMULATOR_ENABLED` first, then
 * `WHATSAPP_PROVIDER` (dialog360) and the Meta credentials.
 */
import type { ChannelProvider, Config } from '../config.js';
import type { Db } from '../db/client.js';
import { Dialog360SandboxChannel } from './dialog360.js';
import { MetaChannel } from './meta.js';
import { SIMULATOR_APP_SECRET } from './signature.js';
import { SimulatorChannel, SimulatorStore } from './simulator.js';
import { TelegramChannel } from './telegram.js';
import { type Channel, ChannelError } from './types.js';

export interface ChannelRuntime {
  channel: Channel;
  store: SimulatorStore | null;
  /** HMAC secret of `/webhook/whatsapp`; null disables it (503). */
  appSecret: string | null;
  verifyToken: string | null;
  /** The Telegram adapter when selected (webhook, polling and identity need its extras). */
  telegram: TelegramChannel | null;
}

type RuntimeConfig = Pick<Config, 'simulatorEnabled' | 'whatsapp'> &
  Partial<Pick<Config, 'whatsappProvider' | 'dialog360' | 'channelProvider' | 'telegram'>>;

export function createChannelRuntime(db: Db, config: RuntimeConfig): ChannelRuntime {
  const none = { store: null, appSecret: null, verifyToken: null, telegram: null };
  const provider: ChannelProvider =
    config.channelProvider ??
    (config.simulatorEnabled
      ? 'simulator'
      : config.whatsappProvider === 'dialog360'
        ? 'dialog360'
        : 'meta');

  switch (provider) {
    case 'telegram': {
      if (!config.telegram) throw new ChannelError('rejected', 'Telegram configuration missing');
      const telegram = new TelegramChannel({ db, botToken: config.telegram.botToken });
      return { ...none, channel: telegram, telegram };
    }
    case 'simulator': {
      const store = new SimulatorStore();
      return {
        ...none,
        channel: new SimulatorChannel({ db, store }),
        store,
        appSecret: SIMULATOR_APP_SECRET,
      };
    }
    case 'dialog360':
      if (!config.dialog360) throw new ChannelError('rejected', '360dialog configuration missing');
      return {
        ...none,
        channel: new Dialog360SandboxChannel({ db, apiKey: config.dialog360.apiKey }),
      };
    case 'meta':
      if (config.whatsapp) {
        return {
          ...none,
          channel: new MetaChannel({ db, config: config.whatsapp }),
          appSecret: config.whatsapp.appSecret,
          verifyToken: config.whatsapp.verifyToken,
        };
      }
  }
  const fail = async (): Promise<never> => {
    throw new ChannelError('unavailable', 'no WhatsApp channel configured');
  };
  const channel: Channel = {
    kind: 'meta',
    markAsRead: fail,
    sendText: fail,
    sendButtons: fail,
    sendImage: fail,
    uploadMedia: fail,
    downloadMedia: fail,
  };
  return { ...none, channel };
}
