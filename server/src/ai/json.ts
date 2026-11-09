import type { ZodType } from 'zod';
import { InvalidOutput } from './router.js';

/**
 * Extracts the JSON object from a model answer: plain JSON, a ```json fence, or text around it.
 * Returns undefined when there is no parseable object.
 */
export function extractJson(raw: string): unknown {
  const text = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [text, fenced?.[1]?.trim() ?? ''];
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
  for (const candidate of candidates) {
    if (!candidate.startsWith('{')) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

/** Parses and validates a model answer. Failures carry a reason code only (no content). */
export function parseModelJson<T>(raw: string, schema: ZodType<T>): T | InvalidOutput {
  const json = extractJson(raw);
  if (json === undefined) return new InvalidOutput('json_parse');
  const result = schema.safeParse(json);
  if (!result.success) {
    const path = result.error.issues[0]?.path.join('.') ?? '';
    return new InvalidOutput(`schema:${path}`);
  }
  return result.data;
}
