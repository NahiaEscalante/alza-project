import type { Config } from '../config.js';
import { createGeminiClient } from './providers/gemini.js';
import { createGroqClient } from './providers/groq.js';
import type { ProviderClient } from './providers/types.js';
import type { Route, RouteTable } from './router.js';

/**
 * Free-tier models for the demo (D25, D33–D35). Ids checked with
 * `npx tsx src/scripts/eval-list-models.ts` (lists what each key can use).
 * A model enters the rotation only after passing the eval (17.2, `npm run eval -w server`).
 */
export const MODELS_CHECKED_AT = '2026-11-08';

export const MODELS = {
  /** Groq Whisper: speech to text (D34). `whisper-large-v3-turbo` is also available. */
  groqWhisper: 'whisper-large-v3',
  /** Groq text model for interpretation and chat (D35). */
  groqText: 'openai/gpt-oss-120b',
  /** Smaller Groq text model: its own free-tier quota (8k tokens/min, 1000 requests/day). */
  groqTextSmall: 'openai/gpt-oss-20b',
  /** Groq multimodal model (accepts images): vision fallback and image classification. */
  groqVision: 'qwen/qwen3.8-27b',
  /** Gemini Flash: vision fallback, text fallback and audio fallback (D34). */
  geminiFlash: 'gemini-3.5-flash',
  /** Gemini Flash-Lite: lighter model with its own quota per key (D35 candidate). */
  geminiFlashLite: 'gemini-3.5-flash-lite',
  /** Previous Flash-Lite generation: one more quota per key (D35 candidate). */
  geminiFlashLitePrev: 'gemini-3.1-flash-lite',
} as const;

export interface RouteClients {
  groq?: ProviderClient;
  /** One client per key: each Google project has its own quota. */
  gemini: ProviderClient[];
}

export function createClients(config: Pick<Config, 'groqApiKey' | 'geminiApiKeys'>): RouteClients {
  return {
    groq: config.groqApiKey ? createGroqClient(config.groqApiKey) : undefined,
    gemini: config.geminiApiKeys.map((key) => createGeminiClient(key)),
  };
}

function groqRoute(
  client: ProviderClient | undefined,
  model: string,
  extra: Partial<Route> = {},
): Route[] {
  return client ? [{ id: `groq:${model}`, provider: 'groq', model, client, ...extra }] : [];
}

function geminiRoutes(
  clients: ProviderClient[],
  model: string,
  extra: Partial<Route> = {},
): Route[] {
  return clients.map((client, i) => ({
    id: `gemini#${i + 1}:${model}`,
    provider: 'gemini' as const,
    model,
    client,
    ...extra,
  }));
}

/**
 * Every route the eval can try (`--route`), certified or not. A model enters `defaultRoutes`
 * only after passing 17.2 with it (D35).
 */
export function candidateRoutes(clients: RouteClients): RouteTable {
  const vision = [
    ...geminiRoutes(clients.gemini, MODELS.geminiFlash),
    ...groqRoute(clients.groq, MODELS.groqVision),
    ...geminiRoutes(clients.gemini, MODELS.geminiFlashLite),
  ];
  const text = [
    ...groqRoute(clients.groq, MODELS.groqText),
    ...geminiRoutes(clients.gemini, MODELS.geminiFlash),
    ...groqRoute(clients.groq, MODELS.groqTextSmall),
    ...groqRoute(clients.groq, MODELS.groqVision),
    ...geminiRoutes(clients.gemini, MODELS.geminiFlashLite),
    ...geminiRoutes(clients.gemini, MODELS.geminiFlashLitePrev),
  ];
  return {
    classify_image: vision,
    extract_screenshot: vision,
    transcribe_audio: [
      ...groqRoute(clients.groq, MODELS.groqWhisper, { transcription: 'whisper' }),
      ...geminiRoutes(clients.gemini, MODELS.geminiFlash, { transcription: 'llm' }),
    ],
    interpret_text: text,
    interpret_close_reply: text,
    chat: text,
  };
}

/**
 * Default rotation per function (8.3). Order = preference; failover walks the list.
 * - Vision (extract_screenshot, classify_image): Gemini Flash on each key, then Groq's multimodal
 *   model.
 * - Audio: Groq Whisper, then Gemini with audio input (D34).
 * - Text: Groq gpt-oss-120b, then Gemini Flash on each key (D35).
 */
export function defaultRoutes(clients: RouteClients): RouteTable {
  const vision = [
    ...geminiRoutes(clients.gemini, MODELS.geminiFlash),
    ...groqRoute(clients.groq, MODELS.groqVision),
  ];
  const text = [
    ...groqRoute(clients.groq, MODELS.groqText),
    ...geminiRoutes(clients.gemini, MODELS.geminiFlash),
  ];
  return {
    classify_image: vision,
    extract_screenshot: vision,
    transcribe_audio: [
      ...groqRoute(clients.groq, MODELS.groqWhisper, { transcription: 'whisper' }),
      ...geminiRoutes(clients.gemini, MODELS.geminiFlash, { transcription: 'llm' }),
    ],
    interpret_text: text,
    interpret_close_reply: text,
    chat: text,
  };
}
