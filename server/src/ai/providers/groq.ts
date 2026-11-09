import Groq, { toFile } from 'groq-sdk';
import type {
  ChatCompletionContentPart,
  ChatCompletionCreateParamsNonStreaming,
} from 'groq-sdk/resources/chat/completions';
import {
  type GenerateRequest,
  type ProviderClient,
  ProviderError,
  type RawTranscription,
  type TranscribeRequest,
  toProviderError,
} from './types.js';

const EXTENSIONS: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/opus': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'm4a',
  'audio/amr': 'amr',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
};

/** Reasoning models: keep reasoning short and out of the answer. */
function reasoningOptions(model: string): Partial<ChatCompletionCreateParamsNonStreaming> {
  if (model.startsWith('openai/gpt-oss'))
    return { reasoning_effort: 'low', include_reasoning: false };
  if (model.startsWith('qwen/')) return { reasoning_format: 'hidden' };
  return {};
}

export function createGroqClient(apiKey: string): ProviderClient {
  const groq = new Groq({ apiKey, maxRetries: 0, timeout: 120_000 });

  return {
    provider: 'groq',

    async generate(model: string, request: GenerateRequest, signal: AbortSignal): Promise<string> {
      if (request.audio) throw new ProviderError('unsupported');
      const userContent: string | ChatCompletionContentPart[] = request.image
        ? [
            { type: 'text', text: request.prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:${request.image.mimeType};base64,${request.image.data.toString('base64')}`,
              },
            },
          ]
        : request.prompt;
      const params: ChatCompletionCreateParamsNonStreaming = {
        model,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: userContent },
        ],
        temperature: request.temperature ?? 0,
        ...(request.maxOutputTokens ? { max_completion_tokens: request.maxOutputTokens } : {}),
        ...(request.json ? { response_format: { type: 'json_object' } } : {}),
        ...reasoningOptions(model),
      };
      let content: string | null | undefined;
      try {
        const res = await groq.chat.completions.create(params, { signal });
        content = res.choices[0]?.message.content;
      } catch (err) {
        throw toProviderError(err);
      }
      if (!content?.trim()) throw new ProviderError('empty');
      return content;
    },

    async transcribe(
      model: string,
      request: TranscribeRequest,
      signal: AbortSignal,
    ): Promise<RawTranscription> {
      const base = request.audio.mimeType.split(';')[0]?.trim() ?? '';
      const ext = EXTENSIONS[base] ?? 'ogg';
      try {
        const res = await groq.audio.transcriptions.create(
          {
            file: await toFile(request.audio.data, `audio.${ext}`),
            model,
            language: request.language,
            temperature: 0,
            response_format: 'verbose_json',
            ...(request.prompt ? { prompt: request.prompt } : {}),
          },
          { signal },
        );
        const verbose = res as unknown as {
          text?: string;
          segments?: { avg_logprob?: number; no_speech_prob?: number }[];
        };
        const segments = verbose.segments ?? [];
        const logprobs = segments.map((s) => s.avg_logprob).filter((n) => typeof n === 'number');
        const noSpeech = segments.map((s) => s.no_speech_prob).filter((n) => typeof n === 'number');
        return {
          text: verbose.text ?? '',
          avgLogprob: logprobs.length
            ? logprobs.reduce((a, b) => a + b, 0) / logprobs.length
            : undefined,
          noSpeechProb: noSpeech.length ? Math.max(...noSpeech) : undefined,
        };
      } catch (err) {
        throw toProviderError(err);
      }
    },
  };
}
