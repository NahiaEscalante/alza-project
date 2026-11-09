import type { MessagingApp } from './catalog.js';

/** Relevant notice changes must bump this version (14.1). WA-01 as in 12.1. */
export const CONSENT_TEXT_VERSION = 'wa-01-v1';

/** D74: WA-01 with the demo notice, on Telegram (the public demo channel). */
export const DEMO_CONSENT_TEXT_VERSION = 'wa-01-v2-demo';

/**
 * The consent version she must have accepted on this channel. A different version asks for her
 * consent again (14.1), keeping the configuration of a finished onboarding.
 */
export function consentTextVersion(app: MessagingApp = 'whatsapp'): string {
  return app === 'telegram' ? DEMO_CONSENT_TEXT_VERSION : CONSENT_TEXT_VERSION;
}
