/**
 * Fase 5 · Cierre del día (4.5, 5.5, 10.3, 11.5–11.9, 12.1 WA-10/11/12/18/21/22, HU-06, HU-07).
 *
 * Wiring (`src/index.ts`):
 *
 *   const closeDeps = { db, logger, channel, ai, now, baseUrl: config.appBaseUrl };
 *   hooks: withFlowHooks({ ...createCloseHooks(closeDeps), ...otherHooks }),
 *   await registerCloseJobs(boss, closeDeps); // after startBoss
 */
import type { FlowHooks } from '../hooks.js';
import { applyCloseReply } from './reply.js';
import { sendDailyClose } from './send.js';
import type { CloseFlowDeps } from './types.js';

export { applyCloseReply, CLOSE_REPLY_ACTOR, replyLogOf } from './reply.js';
export {
  CLOSE_SENDER_CRON,
  CLOSE_SENDER_QUEUE,
  type CloseJobs,
  type CloseSenderSummary,
  registerCloseJobs,
  sendDueCloses,
} from './scheduler.js';
export { type CloseTrigger, sendDailyClose } from './send.js';
export type * from './types.js';

/**
 * The two hand-offs of the pipeline that belong to the close:
 * - `closeNow` («cierre», RF-CI-03): WA-10 now, WA-21 if the day is empty (D39), WA-22 if it was
 *   already sent, answered or not (D49, D54).
 * - `closeReply` (PR17): applies her answer and answers once (WA-11, WA-12 or WA-18).
 */
export function createCloseHooks(deps: CloseFlowDeps): Pick<FlowHooks, 'closeNow' | 'closeReply'> {
  return {
    closeNow: async (event) => {
      await sendDailyClose(deps, {
        user: event.user,
        businessDay: event.businessDay,
        trigger: 'on_demand',
      });
    },
    closeReply: (event) => applyCloseReply(deps, event),
  };
}
