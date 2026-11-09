/**
 * Test harness for the message pipeline (tests only): the real app (webhook + simulated channel),
 * an in-memory queue drained by hand with pg-boss's retry rule, a fake AI layer and a fake
 * screenshot reader. No network, no OCR.
 */

import { randomInt } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import type { AiLayer } from '../ai/layer.js';
import type { ScreenshotReading } from '../ai/read-screenshot.js';
import type { AiResult } from '../ai/router.js';
import {
  type ScreenshotExtraction,
  screenshotExtractionSchema,
  type TextInterpretation,
  textInterpretationSchema,
} from '../ai/schemas.js';
import {
  buildWebhookPayload,
  newWaMessageId,
  type OutgoingWebhookMessage,
  SimulatorChannel,
  SimulatorStore,
  signPayload,
} from '../channel/index.js';
import type { Db } from '../db/client.js';
import { accountHolders, consents, type User, users } from '../db/schema.js';
import { normalizeName } from '../domain/index.js';
import { type FlowHooks, withFlowHooks } from '../flows/hooks.js';
import { createApp } from '../http/app.js';
import { createLogger } from '../lib/logger.js';
import { CONSENT_TEXT_VERSION } from '../messages/consent.js';
import type { BlobStorage, StoredBlob } from '../storage/blob-storage.js';
import type { InboundQueue, PipelineDeps } from './deps.js';
import { MAX_RETRIES, type ProcessResult, processInboundJob } from './worker.js';

export const TEST_APP_SECRET = 'test-app-secret';
export const TEST_VERIFY_TOKEN = 'test-verify-token';
export const silentLogger = createLogger({ level: 'silent' });

export function randomPhone(): string {
  return `+519${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
}

/** Records jobs; `fresh` jobs always enqueue, others once per message (job id = message id). */
export class TestQueue implements InboundQueue {
  readonly jobs: { inboundMessageId: string; userId: string }[] = [];
  readonly #seen = new Set<string>();
  async enqueue(
    job: { inboundMessageId: string; userId: string },
    options: { fresh?: boolean } = {},
  ) {
    if (!options.fresh && this.#seen.has(job.inboundMessageId)) return;
    this.#seen.add(job.inboundMessageId);
    this.jobs.push(job);
  }
}

/** Plain in-memory BlobStorage that still lets tests look at what was stored. */
export class MemoryStorage implements BlobStorage {
  readonly blobs = new Map<string, StoredBlob>();
  async put(key: string, data: Uint8Array, options: { contentType?: string } = {}) {
    this.blobs.set(key, {
      data: Buffer.from(data),
      contentType: options.contentType ?? null,
      sizeBytes: data.byteLength,
    });
  }
  async get(key: string) {
    return this.blobs.get(key) ?? null;
  }
  async delete(key: string) {
    return this.blobs.delete(key);
  }
}

const AI_META = {
  provider: 'groq' as const,
  model: 'fake-model',
  promptVersion: 'fake/1',
  routeId: 'fake',
  latencyMs: 1,
  attempts: 1,
};

export type FakeTextAnswer = Partial<TextInterpretation> | 'unavailable';

/** AI layer whose answers are scripted per text and per audio (bytes as utf8 key). */
export class FakeAi implements Pick<AiLayer, 'interpretText' | 'transcribeAudio'> {
  readonly texts = new Map<string, FakeTextAnswer>();
  readonly audios = new Map<string, { text: string; lowConfidence?: boolean } | 'unavailable'>();
  readonly calls: { fn: string; input: string }[] = [];

  text(input: string, answer: FakeTextAnswer): this {
    this.texts.set(input, answer);
    return this;
  }

  audio(key: string, answer: { text: string; lowConfidence?: boolean } | 'unavailable'): this {
    this.audios.set(key, answer);
    return this;
  }

  async interpretText(input: string): Promise<AiResult<TextInterpretation>> {
    this.calls.push({ fn: 'interpret_text', input });
    const answer = this.texts.get(input) ?? { intent: 'other' };
    if (answer === 'unavailable') return { ok: false, error: 'unavailable', attempts: 2 };
    return { ok: true, meta: AI_META, value: textInterpretationSchema.parse(answer) };
  }

  async transcribeAudio(audio: { data: Buffer }) {
    const key = audio.data.toString('utf8');
    this.calls.push({ fn: 'transcribe_audio', input: key });
    const answer = this.audios.get(key);
    if (!answer || answer === 'unavailable') {
      return { ok: false as const, error: 'unavailable' as const, attempts: 2 };
    }
    return {
      ok: true as const,
      meta: AI_META,
      value: { text: answer.text, lowConfidence: answer.lowConfidence ?? false },
    };
  }
}

/** One single cash sale («vendí 5 de pan»), as the text model returns it. */
export function cashSale(amount: string, description = 'pan'): Partial<TextInterpretation> {
  return {
    intent: 'record',
    operations: [
      {
        amount,
        amount_alternatives: [],
        direction: 'in',
        payment_method: 'cash',
        scope: 'single',
        suggested_category: 'sale',
        counterparty_name: null,
        description,
        confidence: { amount: 0.97 },
      },
    ],
  };
}

export interface ReceiptSpec {
  amount: string | null;
  header?: 'yape_received' | 'yape_sent' | 'plin_sent' | 'bank_transfer_sent' | 'unknown';
  paymentMethod?: 'yape' | 'plin' | 'bank_transfer';
  counterparty?: string | null;
  visibleHolder?: string | null;
  holderRole?: 'payer' | 'payee' | 'unknown';
  occurredAt?: string | null;
  operationNumber?: string | null;
}

export function receiptExtraction(spec: ReceiptSpec): ScreenshotExtraction {
  const header = spec.header ?? 'yape_received';
  const role =
    spec.holderRole ??
    (header === 'yape_received' ? 'payee' : header === 'unknown' ? 'unknown' : 'payer');
  return screenshotExtractionSchema.parse({
    content_type: 'individual_receipt',
    legible: spec.amount !== null,
    operations: [
      {
        amount: spec.amount,
        payment_method: spec.paymentMethod ?? 'yape',
        counterparty_name: spec.counterparty ?? null,
        visible_holder_name: spec.visibleHolder ?? null,
        receipt_header: header,
        receipt_header_text:
          header === 'yape_received'
            ? '¡Te Yapearon!'
            : header === 'yape_sent'
              ? '¡Yapeaste!'
              : null,
        holder_role: role,
        occurred_at: spec.occurredAt === undefined ? new Date().toISOString() : spec.occurredAt,
        operation_number: spec.operationNumber ?? null,
        scope: 'single',
        confidence: { amount: spec.amount === null ? 0 : 0.97 },
      },
    ],
  });
}

/** Screenshot reader scripted per image (bytes as utf8 key). */
export class FakeReader {
  readonly readings = new Map<string, ScreenshotExtraction | 'ai_down'>();
  calls = 0;

  set(key: string, reading: ScreenshotExtraction | 'ai_down'): this {
    this.readings.set(key, reading);
    return this;
  }

  read = async (image: { data: Buffer }): Promise<ScreenshotReading> => {
    this.calls += 1;
    const key = image.data.toString('utf8');
    const scripted = this.readings.get(key);
    const base = {
      layout: null,
      meta: { provider: 'local', model: 'fake-ocr', promptVersion: 'fake/1' },
      issues: [],
      timings: { ocrMs: 0, visionMs: 0 },
    };
    if (scripted === 'ai_down' || scripted === undefined) {
      return {
        ...base,
        extraction: { content_type: 'individual_receipt', legible: false, operations: [] },
        source: 'none',
        aiFailure: 'unavailable',
      };
    }
    return { ...base, extraction: scripted, source: 'ocr', aiFailure: null };
  };
}

export interface Harness {
  db: Db;
  app: Hono;
  store: SimulatorStore;
  channel: SimulatorChannel;
  queue: TestQueue;
  storage: MemoryStorage;
  ai: FakeAi;
  reader: FakeReader;
  hookCalls: { hook: keyof FlowHooks; event: unknown }[];
  deps: PipelineDeps;
  /** Processes every queued job in order, retrying like pg-boss (up to MAX_RETRIES). */
  drain(): Promise<ProcessResult[]>;
  /** Posts one signed Meta payload through `POST /webhook/whatsapp`. */
  deliver(
    phone: string,
    message: OutgoingWebhookMessage,
    options?: { waMessageId?: string; sentAt?: Date; replyTo?: string },
  ): Promise<{ status: number; waMessageId: string }>;
  sendText(phone: string, text: string, options?: { replyTo?: string }): Promise<string>;
  /** `key` is the fake file content; the fake reader/transcriber answers by it. */
  sendImage(phone: string, key: string): Promise<string>;
  sendAudio(phone: string, key: string): Promise<string>;
}

export function createHarness(
  db: Db,
  options: { hooks?: Partial<FlowHooks>; now?: () => Date } = {},
): Harness {
  const now = options.now ?? (() => new Date());
  const store = new SimulatorStore({ now });
  const channel = new SimulatorChannel({ db, store });
  const queue = new TestQueue();
  const storage = new MemoryStorage();
  const ai = new FakeAi();
  const reader = new FakeReader();
  const hookCalls: Harness['hookCalls'] = [];
  const recorded: Partial<FlowHooks> = {};
  for (const name of [
    'onboarding',
    'request',
    'danger',
    'closeNow',
    'closeReply',
    'unreadableTip',
  ] as const) {
    const custom = options.hooks?.[name] as ((event: unknown) => Promise<unknown>) | undefined;
    (recorded as Record<string, unknown>)[name] = async (event: unknown) => {
      hookCalls.push({ hook: name, event });
      return custom ? custom(event) : name === 'onboarding' ? 'handled' : undefined;
    };
  }
  const deps: PipelineDeps = {
    db,
    logger: silentLogger,
    storage,
    channel,
    ai,
    readScreenshot: reader.read,
    // `afterProcessed` runs for every message: passed through, not recorded in `hookCalls`.
    hooks: withFlowHooks({
      ...recorded,
      ...(options.hooks?.afterProcessed ? { afterProcessed: options.hooks.afterProcessed } : {}),
    }),
    now,
  };
  const app = createApp({
    db,
    logger: silentLogger,
    webhook: {
      receive: { db, logger: silentLogger, channel, queue, now },
      logger: silentLogger,
      appSecret: TEST_APP_SECRET,
      verifyToken: TEST_VERIFY_TOKEN,
    },
    simulator: { db, store, now },
  });

  let drained = 0;
  async function drain(): Promise<ProcessResult[]> {
    const results: ProcessResult[] = [];
    while (drained < queue.jobs.length) {
      const job = queue.jobs[drained++] as { inboundMessageId: string };
      for (let retryCount = 0; retryCount <= MAX_RETRIES; retryCount++) {
        try {
          results.push(await processInboundJob(deps, { ...job, retryCount }));
          break;
        } catch {
          // pg-boss would retry after a growing delay.
        }
      }
    }
    return results;
  }

  async function deliver(
    phone: string,
    message: OutgoingWebhookMessage,
    opts: { waMessageId?: string; sentAt?: Date; replyTo?: string } = {},
  ) {
    const waMessageId = opts.waMessageId ?? newWaMessageId();
    // As the simulator UI does, so ticks can be checked.
    if (store.tickOf(waMessageId) === null) {
      store.addInbound(
        phone,
        waMessageId,
        message.type === 'text'
          ? { type: 'text', body: message.body }
          : message.type === 'interactive'
            ? { type: 'interactive', buttonId: message.buttonId, buttonTitle: message.buttonTitle }
            : { type: message.type, mediaId: message.mediaId },
        opts.replyTo,
      );
    }
    const raw = JSON.stringify(
      buildWebhookPayload({
        waMessageId,
        from: phone,
        sentAt: opts.sentAt ?? now(),
        message,
        replyToWaMessageId: opts.replyTo ?? null,
      }),
    );
    const res = await app.request('/webhook/whatsapp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signPayload(raw, TEST_APP_SECRET),
      },
      body: raw,
    });
    return { status: res.status, waMessageId };
  }

  async function sendMedia(phone: string, kind: 'image' | 'audio', key: string) {
    const mimeType = kind === 'image' ? 'image/jpeg' : 'audio/ogg';
    const { mediaId, sha256 } = store.putMedia(Buffer.from(key, 'utf8'), mimeType);
    const { waMessageId } = await deliver(phone, { type: kind, mediaId, mimeType, sha256 });
    return waMessageId;
  }

  return {
    db,
    app,
    store,
    channel,
    queue,
    storage,
    ai,
    reader,
    hookCalls,
    deps,
    drain,
    deliver,
    sendText: async (phone, text, opts = {}) =>
      (await deliver(phone, { type: 'text', body: text }, { replyTo: opts.replyTo })).waMessageId,
    sendImage: (phone, key) => sendMedia(phone, 'image', key),
    sendAudio: (phone, key) => sendMedia(phone, 'audio', key),
  };
}

/** A user who finished onboarding and accepted the privacy notice. */
export async function createOnboardedUser(
  db: Db,
  overrides: { phone?: string; holder?: string; extraHolders?: string[]; createdAt?: Date } = {},
): Promise<User> {
  const holder = overrides.holder ?? 'Marta Quispe';
  const [user] = await db
    .insert(users)
    .values({
      phoneE164: overrides.phone ?? randomPhone(),
      businessName: 'Bodega Marta',
      accountHolderName: holder,
      accountHolderNormalized: normalizeName(holder),
      closeTime: '21:00',
      onboardingStatus: 'complete',
      ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
    })
    .returning();
  if (!user) throw new Error('no user');
  await db
    .insert(consents)
    .values({ userId: user.id, textVersion: CONSENT_TEXT_VERSION, accepted: true });
  for (const name of overrides.extraHolders ?? []) {
    await db
      .insert(accountHolders)
      .values({ userId: user.id, name, nameNormalized: normalizeName(name) });
  }
  return user;
}

export async function userByPhone(db: Db, phone: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.phoneE164, phone));
  return user;
}
