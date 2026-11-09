/** Select one transport and its webhook credentials together: never mix Meta with the simulator. */
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import { MetaChannel } from './meta.js';
import { SIMULATOR_APP_SECRET } from './signature.js';
import { SimulatorChannel, SimulatorStore } from './simulator.js';
import { type Channel, ChannelError } from './types.js';

export function createChannelRuntime(
  db: Db,
  config: Pick<Config, 'simulatorEnabled' | 'whatsapp'>,
) {
  if (config.simulatorEnabled) {
    const store = new SimulatorStore();
    return {
      channel: new SimulatorChannel({ db, store }),
      store,
      appSecret: SIMULATOR_APP_SECRET,
      verifyToken: null,
    };
  }
  if (config.whatsapp) {
    return {
      channel: new MetaChannel({ db, config: config.whatsapp }),
      store: null,
      appSecret: config.whatsapp.appSecret,
      verifyToken: config.whatsapp.verifyToken,
    };
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
  return { channel, store: null, appSecret: null, verifyToken: null };
}
