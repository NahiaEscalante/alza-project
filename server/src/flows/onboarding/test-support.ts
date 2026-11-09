/**
 * Tests only: the pipeline harness (webhook + simulated channel + fake AI) with the Fase 4 hooks
 * wired in, plus small readers of what ALZA «said» to a phone.
 */
import { and, asc, eq } from 'drizzle-orm';
import type { SimulatorEvent, SimulatorOutboundContent } from '../../channel/index.js';
import type { Db } from '../../db/client.js';
import { outboundMessages, users } from '../../db/schema.js';
import { createHarness, type Harness, silentLogger } from '../../pipeline/test-support.js';
import type { FlowHooks } from '../hooks.js';
import { createOnboardingHooks, type OnboardingHooks } from './index.js';

export const TEST_BASE_URL = 'https://alza.test';

export interface FlowHarness extends Harness {
  /** What ALZA sent to this phone, in order (simulator view). */
  said(phone: string): { catalogId: string; content: SimulatorOutboundContent }[];
  /** Sends a text and processes the queue. */
  say(phone: string, text: string): Promise<void>;
  /** Taps a reply button and processes the queue. */
  tap(phone: string, button: { id: string; title: string }): Promise<void>;
  /** Sends an image (fake reader key) and processes the queue. */
  image(phone: string, key: string): Promise<void>;
}

export function createFlowHarness(
  db: Db,
  options: { now?: () => Date; extraHooks?: Partial<FlowHooks> } = {},
): FlowHarness {
  let hooks: OnboardingHooks | null = null;
  const wired = (): OnboardingHooks => {
    if (!hooks) throw new Error('hooks not ready');
    return hooks;
  };
  const harness = createHarness(db, {
    now: options.now,
    hooks: {
      onboarding: (event) => wired().onboarding(event),
      request: (event) => wired().request(event),
      danger: (event) => wired().danger(event),
      unreadableTip: (event) => wired().unreadableTip(event),
      afterProcessed: (event) => wired().afterProcessed(event),
      ...options.extraHooks,
    },
  });
  hooks = createOnboardingHooks({
    db,
    channel: harness.channel,
    storage: harness.storage,
    logger: silentLogger,
    appBaseUrl: TEST_BASE_URL,
    ...(options.now ? { now: options.now } : {}),
  });

  const said = (phone: string) =>
    harness.store
      .events(phone)
      .filter(
        (event): event is Extract<SimulatorEvent, { direction: 'outbound' }> =>
          event.direction === 'outbound',
      )
      .map((event) => ({ catalogId: event.catalogId, content: event.content }));

  return {
    ...harness,
    said,
    say: async (phone, text) => {
      await harness.sendText(phone, text);
      await harness.drain();
    },
    tap: async (phone, button) => {
      await harness.deliver(phone, {
        type: 'interactive',
        buttonId: button.id,
        buttonTitle: button.title,
      });
      await harness.drain();
    },
    image: async (phone, key) => {
      await harness.sendImage(phone, key);
      await harness.drain();
    },
  };
}

export function bodyOf(content: SimulatorOutboundContent | undefined): string {
  if (!content) return '';
  return content.type === 'image' ? (content.caption ?? '') : content.body;
}

export async function outboundTypes(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .select({ type: outboundMessages.type })
    .from(outboundMessages)
    .where(eq(outboundMessages.userId, userId))
    .orderBy(asc(outboundMessages.createdAt));
  return rows.map((row) => row.type);
}

/** Moves her outbound messages of one catalog id back in time (RF-ON-06 tests). */
export async function backdateOutbound(
  db: Db,
  userId: string,
  catalogId: string,
  to: Date,
): Promise<void> {
  await db
    .update(outboundMessages)
    .set({ createdAt: to })
    .where(and(eq(outboundMessages.userId, userId), eq(outboundMessages.type, catalogId)));
}

export async function userRow(db: Db, phone: string) {
  const [user] = await db.select().from(users).where(eq(users.phoneE164, phone));
  return user;
}
