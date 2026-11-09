/**
 * Test harness for the close flow (tests only): the pipeline harness (webhook, simulated channel,
 * fake text AI and screenshot reader) with the close hooks plugged in, a fake close-reply AI and a
 * clock the test moves.
 */
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { AiLayer } from '../../ai/layer.js';
import type { AiResult } from '../../ai/router.js';
import {
  type CloseQuestion,
  type CloseReplyInterpretation,
  closeReplyInterpretationSchema,
  type TextInterpretation,
} from '../../ai/schemas.js';
import type { SimulatorOutboundContent } from '../../channel/index.js';
import type { Db } from '../../db/client.js';
import { type DailyClose, dailyCloses } from '../../db/schema.js';
import { type IsoDate, limaInstant } from '../../domain/index.js';
import { createHarness, type Harness, silentLogger } from '../../pipeline/test-support.js';
import type { SummaryImageData } from '../../render/index.js';
import { createCloseHooks } from './index.js';
import { sendDueCloses } from './scheduler.js';
import type { CloseFlowDeps } from './types.js';

export const TEST_BASE_URL = 'https://alza.test';

const AI_META = {
  provider: 'groq' as const,
  model: 'fake-model',
  promptVersion: 'fake/1',
  routeId: 'fake',
  latencyMs: 1,
  attempts: 1,
};

/** What the model returns, before validation (defaults filled by the schema). */
export type FakeCloseReply = Partial<z.input<typeof closeReplyInterpretationSchema>>;

/** Close-reply interpretations scripted per reply text. */
export class FakeCloseAi implements Pick<AiLayer, 'interpretCloseReply'> {
  readonly replies = new Map<string, FakeCloseReply | 'unavailable'>();
  readonly calls: { text: string; questions: CloseQuestion[] }[] = [];

  reply(text: string, answer: FakeCloseReply | 'unavailable'): this {
    this.replies.set(text, answer);
    return this;
  }

  async interpretCloseReply(
    text: string,
    questions: CloseQuestion[],
  ): Promise<AiResult<CloseReplyInterpretation>> {
    this.calls.push({ text, questions });
    const answer = this.replies.get(text) ?? { answers: [] };
    if (answer === 'unavailable') return { ok: false, error: 'unavailable', attempts: 2 };
    return {
      ok: true,
      meta: AI_META,
      value: closeReplyInterpretationSchema.parse({ answers: [], ...answer }),
    };
  }
}

/** A movable clock, starting at a Lima wall time. */
export class Clock {
  #now: Date;
  constructor(start: Date) {
    this.#now = start;
  }
  now = (): Date => this.#now;
  set(at: Date): void {
    this.#now = at;
  }
  /** Lima wall clock on a calendar date. */
  setLima(day: IsoDate, hour: number, minute = 0): Date {
    this.#now = limaInstant(day, hour, minute);
    return this.#now;
  }
}

export interface CloseHarness extends Harness {
  clock: Clock;
  closeAi: FakeCloseAi;
  closeDeps: CloseFlowDeps;
  /** The 5-minute job, limited to these users. */
  runSender(userIds: readonly string[]): ReturnType<typeof sendDueCloses>;
  /** What ALZA sent to this phone, oldest first. */
  outbound(
    phone: string,
  ): { catalogId: string; content: SimulatorOutboundContent; waMessageId: string }[];
  /** Text of an outbound message (caption of an image). */
  textOf(message: { content: SimulatorOutboundContent }): string;
  closeOf(userId: string, day: IsoDate): Promise<DailyClose | undefined>;
}

export function createCloseHarness(
  db: Db,
  options: { start: Date; renderImage?: (data: SummaryImageData) => Promise<Buffer> },
): CloseHarness {
  const clock = new Clock(options.start);
  const closeAi = new FakeCloseAi();
  let hooks: ReturnType<typeof createCloseHooks> | null = null;
  const h = createHarness(db, {
    now: clock.now,
    hooks: {
      closeNow: (event) => (hooks as ReturnType<typeof createCloseHooks>).closeNow(event),
      closeReply: (event) => (hooks as ReturnType<typeof createCloseHooks>).closeReply(event),
    },
  });
  const closeDeps: CloseFlowDeps = {
    db,
    logger: silentLogger,
    channel: h.channel,
    ai: closeAi,
    now: clock.now,
    baseUrl: TEST_BASE_URL,
    ...(options.renderImage ? { renderImage: options.renderImage } : {}),
  };
  hooks = createCloseHooks(closeDeps);

  const outbound = (phone: string) =>
    h.store
      .events(phone)
      .filter((e) => e.direction === 'outbound')
      .map((e) => ({
        catalogId: e.direction === 'outbound' ? e.catalogId : '',
        content: e.content as SimulatorOutboundContent,
        waMessageId: e.waMessageId,
      }));
  const textOf = (message: { content: SimulatorOutboundContent }) => {
    const c = message.content;
    if (c.type === 'image') return c.caption ?? '';
    return c.body;
  };
  return {
    ...h,
    clock,
    closeAi,
    closeDeps,
    runSender: (userIds) => sendDueCloses(closeDeps, clock.now(), { userIds }),
    outbound,
    textOf,
    closeOf: async (userId, day) => {
      const rows = await db.select().from(dailyCloses).where(eq(dailyCloses.userId, userId));
      return rows.find((row) => row.businessDay === day);
    },
  };
}

/** A declared day total («hoy vendí 200 en efectivo»), as the text model returns it. */
export function dayTotal(
  amount: string,
  paymentMethod: 'cash' | 'yape' | 'plin' | 'unknown',
): Partial<TextInterpretation> {
  return {
    intent: 'record',
    operations: [
      {
        amount,
        amount_alternatives: [],
        direction: 'in',
        payment_method: paymentMethod,
        scope: 'day_total',
        suggested_category: 'sale',
        counterparty_name: null,
        description: null,
        confidence: { amount: 0.97 },
      },
    ],
  };
}
