import type { Logger } from '../lib/logger.js';
import { type ChatInput, type ChatOutput, runChatAttempt } from './chat.js';
import { CHAT_PROMPT_VERSION, chatSystemPrompt } from './chat-prompt.js';
import type { CircuitBreaker } from './circuit-breaker.js';
import { parseModelJson } from './json.js';
import { checkCloseReply, checkTextInterpretation } from './post-checks.js';
import {
  INTERPRET_CLOSE_REPLY_PROMPT_VERSION,
  INTERPRET_CLOSE_REPLY_SYSTEM,
  interpretCloseReplyPrompt,
} from './prompts/close-reply.js';
import {
  CLASSIFY_IMAGE_PROMPT,
  CLASSIFY_IMAGE_PROMPT_VERSION,
  CLASSIFY_IMAGE_SYSTEM,
  EXTRACT_SCREENSHOT_PROMPT_VERSION,
  EXTRACT_SCREENSHOT_SYSTEM,
  extractScreenshotPrompt,
} from './prompts/screenshot.js';
import {
  INTERPRET_TEXT_PROMPT_VERSION,
  INTERPRET_TEXT_SYSTEM,
  interpretTextPrompt,
  type TextContext,
} from './prompts/text.js';
import {
  TRANSCRIBE_PROMPT,
  TRANSCRIBE_PROMPT_VERSION,
  TRANSCRIBE_SYSTEM,
  WHISPER_VOCABULARY_HINT,
} from './prompts/transcribe.js';
import type { MediaInput } from './providers/types.js';
import {
  type AiResult,
  AiRouter,
  InvalidOutput,
  type RouteStats,
  type RouteTable,
} from './router.js';
import {
  type CloseQuestion,
  type CloseReplyInterpretation,
  closeReplyInterpretationSchema,
  type ImageClassification,
  imageClassificationSchema,
  type ScreenshotExtraction,
  screenshotExtractionSchema,
  type TextInterpretation,
  type Transcription,
  textInterpretationSchema,
  transcriptionSchema,
} from './schemas.js';

export type { TextContext } from './prompts/text.js';

/** Per-call timeouts (ms). Free tiers can be slow; failover handles the rest. */
export const AI_TIMEOUTS = {
  vision: 45_000,
  audio: 45_000,
  text: 30_000,
  /** The whole tool loop of one chat turn (up to 4 model steps). */
  chat: 40_000,
} as const;

/** Whisper segments below this mean log-probability, or likely silence, are «low confidence». */
const WHISPER_MIN_AVG_LOGPROB = -1;
const WHISPER_MAX_NO_SPEECH = 0.6;

/**
 * The AI layer used by the rest of the system (spec 8.3). Every function returns JSON validated
 * with zod plus `{provider, model, promptVersion}`, or a typed failure the caller turns into a
 * clarification or an error. User content is always sent as delimited DATA (RF-CH-04).
 *
 * Screenshots should go through `readScreenshot` (OCR first, D33); `extractScreenshot` is its
 * vision fallback.
 */
export interface AiLayer {
  classifyImage(image: MediaInput): Promise<AiResult<ImageClassification>>;
  /** Vision model read of an image (fallback of the OCR readers). Raw model output, validated. */
  extractScreenshot(image: MediaInput, now?: Date): Promise<AiResult<ScreenshotExtraction>>;
  transcribeAudio(audio: MediaInput): Promise<AiResult<Transcription>>;
  interpretText(text: string, context: TextContext): Promise<AiResult<TextInterpretation>>;
  interpretCloseReply(
    text: string,
    questions: CloseQuestion[],
  ): Promise<AiResult<CloseReplyInterpretation>>;
  /**
   * Web chat (10.5): a tool loop over the caller's read-only tools. It never changes data: the
   * caller's `propose_change` tool only collects a proposal she confirms with her PIN (14.5).
   */
  chat<T>(input: ChatInput<T>): Promise<AiResult<ChatOutput<T>>>;
  /** Usage and latency per function and route. */
  stats(): RouteStats[];
}

export interface AiLayerOptions {
  routes: RouteTable;
  logger?: Logger;
  breaker?: CircuitBreaker;
  /** Business clock: «today» in prompts. Default: real time. */
  now?: () => Date;
}

export function createAiLayer(options: AiLayerOptions): AiLayer {
  const now = options.now ?? (() => new Date());
  const router = new AiRouter({
    routes: options.routes,
    logger: options.logger,
    breaker: options.breaker,
  });

  return {
    classifyImage(image) {
      return router.run(
        'classify_image',
        CLASSIFY_IMAGE_PROMPT_VERSION,
        AI_TIMEOUTS.vision,
        async (route, signal) => {
          const raw = await route.client.generate(
            route.model,
            { system: CLASSIFY_IMAGE_SYSTEM, prompt: CLASSIFY_IMAGE_PROMPT, image, json: true },
            signal,
          );
          return parseModelJson(raw, imageClassificationSchema);
        },
      );
    },

    extractScreenshot(image, at) {
      return router.run(
        'extract_screenshot',
        EXTRACT_SCREENSHOT_PROMPT_VERSION,
        AI_TIMEOUTS.vision,
        async (route, signal) => {
          const raw = await route.client.generate(
            route.model,
            {
              system: EXTRACT_SCREENSHOT_SYSTEM,
              prompt: extractScreenshotPrompt(at ?? now()),
              image,
              json: true,
            },
            signal,
          );
          return parseModelJson(raw, screenshotExtractionSchema);
        },
      );
    },

    transcribeAudio(audio) {
      return router.run(
        'transcribe_audio',
        TRANSCRIBE_PROMPT_VERSION,
        AI_TIMEOUTS.audio,
        async (route, signal): Promise<Transcription | InvalidOutput> => {
          if (route.transcription === 'whisper') {
            const raw = await route.client.transcribe(
              route.model,
              { audio, language: 'es', prompt: WHISPER_VOCABULARY_HINT },
              signal,
            );
            const text = raw.text.trim();
            const lowConfidence =
              text === '' ||
              (raw.avgLogprob !== undefined && raw.avgLogprob < WHISPER_MIN_AVG_LOGPROB) ||
              (raw.noSpeechProb !== undefined && raw.noSpeechProb > WHISPER_MAX_NO_SPEECH);
            return { text, lowConfidence };
          }
          const raw = await route.client.generate(
            route.model,
            { system: TRANSCRIBE_SYSTEM, prompt: TRANSCRIBE_PROMPT, audio, json: true },
            signal,
          );
          const parsed = parseModelJson(raw, transcriptionSchema);
          if (parsed instanceof InvalidOutput) return parsed;
          const text = parsed.text.trim();
          return { text, lowConfidence: text === '' };
        },
      );
    },

    interpretText(text, context) {
      return router.run(
        'interpret_text',
        INTERPRET_TEXT_PROMPT_VERSION,
        AI_TIMEOUTS.text,
        async (route, signal) => {
          const raw = await route.client.generate(
            route.model,
            {
              system: INTERPRET_TEXT_SYSTEM,
              prompt: interpretTextPrompt(text, context),
              json: true,
            },
            signal,
          );
          const parsed = parseModelJson(raw, textInterpretationSchema);
          if (parsed instanceof InvalidOutput) return parsed;
          return checkTextInterpretation(parsed).value;
        },
      );
    },

    interpretCloseReply(text, questions) {
      return router.run(
        'interpret_close_reply',
        INTERPRET_CLOSE_REPLY_PROMPT_VERSION,
        AI_TIMEOUTS.text,
        async (route, signal) => {
          const raw = await route.client.generate(
            route.model,
            {
              system: INTERPRET_CLOSE_REPLY_SYSTEM,
              prompt: interpretCloseReplyPrompt(text, questions),
              json: true,
            },
            signal,
          );
          const parsed = parseModelJson(raw, closeReplyInterpretationSchema);
          if (parsed instanceof InvalidOutput) return parsed;
          return checkCloseReply(parsed, questions).value;
        },
      );
    },

    chat(input) {
      const system = chatSystemPrompt({
        now: input.now ?? now(),
        creditAnswer: input.creditAnswer,
        changes: input.allowChanges ?? true,
      });
      return router.run('chat', CHAT_PROMPT_VERSION, AI_TIMEOUTS.chat, (route, signal) =>
        runChatAttempt(route, input, system, signal),
      );
    },

    stats() {
      return router.stats();
    },
  };
}
