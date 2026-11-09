/**
 * Fase 4: onboarding and the exception messages, as `FlowHooks` for the pipeline. Fase 5 adds
 * `closeNow` and `closeReply`; `src/index.ts` merges both with `withFlowHooks`.
 */
import type { FlowHooks } from '../hooks.js';
import { handleDanger, handleRequest, sendScreenshotTip } from '../requests/requests.js';
import type { FlowDeps } from './deps.js';
import { confirmFirstScreenshot } from './first-screenshot.js';
import { handleOnboarding } from './onboarding.js';

export * from './answers.js';
export * from './close-time.js';
export * from './deps.js';
export * from './first-screenshot.js';
export * from './onboarding.js';

export type OnboardingHooks = Pick<
  FlowHooks,
  'onboarding' | 'request' | 'danger' | 'unreadableTip' | 'afterProcessed'
>;

export function createOnboardingHooks(deps: FlowDeps): OnboardingHooks {
  return {
    onboarding: (event) => handleOnboarding(deps, event),
    request: (event) => handleRequest(deps, event),
    danger: (event) => handleDanger(deps, event),
    unreadableTip: (event) => sendScreenshotTip(deps, event),
    afterProcessed: (event) => confirmFirstScreenshot(deps, event),
  };
}
