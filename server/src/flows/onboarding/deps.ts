import type { Db } from '../../db/client.js';
import type { Logger } from '../../lib/logger.js';
import type { CatalogChannel } from '../../messages/catalog.js';
import type { BlobStorage } from '../../storage/blob-storage.js';

/** What the onboarding and exception flows need (dependencies by parameter). */
export interface FlowDeps {
  db: Db;
  channel: CatalogChannel;
  /** Account deletion removes her files (RF-PV-01). */
  storage: Pick<BlobStorage, 'delete'>;
  logger: Logger;
  /** `config.appBaseUrl`: web links (WA-06, WA-13, WA-14) and the privacy page (WA-01). */
  appBaseUrl: string;
  now?: () => Date;
}

export function nowOf(deps: Pick<FlowDeps, 'now'>): Date {
  return deps.now ? deps.now() : new Date();
}

/** Web route of the privacy notice (`web/src/App.tsx`). */
export const PRIVACY_PATH = '/privacidad';

export function privacyUrl(appBaseUrl: string): string {
  return `${appBaseUrl.replace(/\/+$/, '')}${PRIVACY_PATH}`;
}
