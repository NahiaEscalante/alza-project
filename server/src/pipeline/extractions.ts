import { INTERPRET_TEXT_PROMPT_VERSION } from '../ai/prompts/text.js';
import { TRANSCRIBE_PROMPT_VERSION } from '../ai/prompts/transcribe.js';
import type { ScreenshotReading } from '../ai/read-screenshot.js';
import type { AiResult } from '../ai/router.js';
import type { Db } from '../db/client.js';
import { type ExtractionFunction, extractions } from '../db/schema.js';

/**
 * 8.3: every AI or OCR call is kept in `extractions` with its model and prompt version, valid or
 * not, so readings can be compared and debugged. Saved right after the call (outside the ledger
 * transaction): a retried job adds one row per call.
 */
export async function saveExtraction(
  db: Db,
  row: {
    inboundMessageId: string;
    fn: ExtractionFunction;
    model: string;
    promptVersion: string;
    result: unknown;
    isValid: boolean;
  },
): Promise<void> {
  await db.insert(extractions).values({
    inboundMessageId: row.inboundMessageId,
    function: row.fn,
    model: row.model,
    promptVersion: row.promptVersion,
    result: row.result ?? {},
    isValid: row.isValid,
  });
}

const DEFAULT_PROMPT_VERSIONS: Partial<Record<ExtractionFunction, string>> = {
  transcribe_audio: TRANSCRIBE_PROMPT_VERSION,
  interpret_text: INTERPRET_TEXT_PROMPT_VERSION,
};

/** Saves an AI layer result (`ok` or a typed failure). */
export async function saveAiResult<T>(
  db: Db,
  inboundMessageId: string,
  fn: ExtractionFunction,
  result: AiResult<T>,
): Promise<void> {
  if (result.ok) {
    await saveExtraction(db, {
      inboundMessageId,
      fn,
      model: result.meta.model,
      promptVersion: result.meta.promptVersion,
      result: result.value,
      isValid: true,
    });
    return;
  }
  await saveExtraction(db, {
    inboundMessageId,
    fn,
    model: 'none',
    promptVersion: DEFAULT_PROMPT_VERSIONS[fn] ?? 'unknown',
    result: { error: result.error, attempts: result.attempts },
    isValid: false,
  });
}

export async function saveScreenshotReading(
  db: Db,
  inboundMessageId: string,
  reading: ScreenshotReading,
): Promise<void> {
  await saveExtraction(db, {
    inboundMessageId,
    fn: 'extract_screenshot',
    model: reading.meta.model,
    promptVersion: reading.meta.promptVersion,
    result: {
      ...reading.extraction,
      source: reading.source,
      layout: reading.layout,
      issues: reading.issues,
      aiFailure: reading.aiFailure,
    },
    isValid: reading.aiFailure === null,
  });
}
