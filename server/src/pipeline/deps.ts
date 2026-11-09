import type { AiLayer } from '../ai/layer.js';
import type { MediaInput } from '../ai/providers/types.js';
import { readScreenshot, type ScreenshotReading } from '../ai/read-screenshot.js';
import type { Channel } from '../channel/types.js';
import type { Db } from '../db/client.js';
import type { FlowHooks } from '../flows/hooks.js';
import type { Logger } from '../lib/logger.js';
import type { OcrEngine } from '../ocr/engine.js';
import type { BlobStorage } from '../storage/blob-storage.js';

/** Reads one screenshot (D33: OCR first, vision fallback). Injected so tests need no OCR/network. */
export type ScreenshotReader = (image: MediaInput, now: Date) => Promise<ScreenshotReading>;

export function createScreenshotReader(deps: {
  ocr: OcrEngine;
  ai: Pick<AiLayer, 'extractScreenshot'>;
  logger?: Logger;
}): ScreenshotReader {
  return (image, now) => readScreenshot(image, { ...deps, now: () => now });
}

/** What the worker needs (dependencies by parameter, CLAUDE.md). */
export interface PipelineDeps {
  db: Db;
  logger: Logger;
  storage: BlobStorage;
  channel: Pick<Channel, 'downloadMedia'>;
  ai: Pick<AiLayer, 'transcribeAudio' | 'interpretText'>;
  readScreenshot: ScreenshotReader;
  hooks: FlowHooks;
  now: () => Date;
}

/** Enqueues the processing of a stored inbound message. */
export interface InboundQueue {
  /** Idempotent per message; `fresh` forces a new job (admin retry, RF-AD-01). */
  enqueue(
    job: { inboundMessageId: string; userId: string },
    options?: { fresh?: boolean },
  ): Promise<void>;
}

/** What the webhook needs to receive messages. */
export interface ReceiveDeps {
  db: Db;
  logger: Logger;
  channel: Pick<Channel, 'markAsRead'>;
  queue: InboundQueue;
  now: () => Date;
}
