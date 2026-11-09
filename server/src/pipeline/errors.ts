import type { AiFailureKind } from '../ai/router.js';
import { ChannelError } from '../channel/types.js';

/**
 * A failure while processing a message (RF-IN-05). `code` goes to `inbound_messages.error_code`
 * and to the logs: a code, never content.
 */
export class PipelineError extends Error {
  readonly code: string;
  /** False when retrying cannot help (the message goes straight to `failed`). */
  readonly retryable: boolean;

  constructor(code: string, options: { retryable?: boolean; cause?: unknown } = {}) {
    super(code, { cause: options.cause });
    this.name = 'PipelineError';
    this.code = code;
    this.retryable = options.retryable ?? true;
  }
}

export function aiFailure(kind: AiFailureKind): PipelineError {
  // Missing keys or an unimplemented function will not fix themselves between retries, but the
  // admin panel may fix the configuration and retry: they still count as retryable here.
  return new PipelineError(`ai_${kind}`);
}

/** Error code for any thrown value (safe to store and log). */
export function errorCodeOf(err: unknown): { code: string; retryable: boolean } {
  if (err instanceof PipelineError) return { code: err.code, retryable: err.retryable };
  if (err instanceof ChannelError) {
    return { code: `channel_${err.code}`, retryable: err.code === 'unavailable' };
  }
  const pg = err as { code?: unknown; cause?: { code?: unknown } };
  const sqlState = pg?.code ?? pg?.cause?.code;
  if (typeof sqlState === 'string' && /^[0-9A-Z]{5}$/.test(sqlState)) {
    return { code: `db_${sqlState}`, retryable: true };
  }
  return { code: 'unexpected', retryable: true };
}
