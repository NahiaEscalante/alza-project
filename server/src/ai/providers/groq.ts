import Groq, { toFile } from 'groq-sdk';
import type {
  ChatCompletionContentPart,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from 'groq-sdk/resources/chat/completions';
import {
  type ChatStepRequest,
  type ChatStepResponse,
  type GenerateRequest,
  type ProviderClient,
  ProviderError,
  type RawTranscription,
  type TokenUsage,
  type ToolCall,
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

/** Tool arguments arrive as a JSON string; anything unparsable goes to the executor as is. */
function parseArguments(raw: string): unknown {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return raw;
  }
}

/** Vendor-neutral turns → OpenAI-compatible messages (Groq). */
function toGroqMessages(request: ChatStepRequest): ChatCompletionMessageParam[] {
  const messages: ChatCompletionMessageParam[] = [{ role: 'system', content: request.system }];
  for (const turn of request.messages) {
    if (turn.role === 'user') messages.push({ role: 'user', content: turn.content });
    else if (turn.role === 'tool') {
      messages.push({ role: 'tool', tool_call_id: turn.toolCallId, content: turn.content });
    } else if (turn.toolCalls?.length) {
      messages.push({
        role: 'assistant',
        content: turn.content || null,
        tool_calls: turn.toolCalls.map((call) => ({
          id: call.id,
          type: 'function' as const,
          function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) },
        })),
      });
    } else {
      messages.push({ role: 'assistant', content: turn.content });
    }
  }
  return messages;
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

    async chat(
      model: string,
      request: ChatStepRequest,
      signal: AbortSignal,
    ): Promise<ChatStepResponse> {
      const params: ChatCompletionCreateParamsNonStreaming = {
        model,
        messages: toGroqMessages(request),
        tools: request.tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        })),
        tool_choice: request.toolChoice ?? 'auto',
        temperature: request.temperature ?? 0,
        ...(request.maxOutputTokens ? { max_completion_tokens: request.maxOutputTokens } : {}),
        ...reasoningOptions(model),
      };
      let message: { content?: string | null; tool_calls?: unknown } | undefined;
      let usage: TokenUsage | undefined;
      try {
        const res = await groq.chat.completions.create(params, { signal });
        message = res.choices[0]?.message;
        if (res.usage) {
          usage = {
            inputTokens: res.usage.prompt_tokens ?? 0,
            outputTokens: res.usage.completion_tokens ?? 0,
            ...(res.usage.prompt_tokens_details?.cached_tokens
              ? { cachedInputTokens: res.usage.prompt_tokens_details.cached_tokens }
              : {}),
          };
        }
      } catch (err) {
        throw toProviderError(err);
      }
      const rawCalls = (message?.tool_calls ?? []) as {
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
      const toolCalls: ToolCall[] = rawCalls.map((call, i) => ({
        id: call.id ?? `call_${i + 1}`,
        name: call.function?.name ?? '',
        arguments: parseArguments(call.function?.arguments ?? ''),
      }));
      const text = message?.content ?? '';
      if (!text.trim() && toolCalls.length === 0) throw new ProviderError('empty');
      return { text, toolCalls, ...(usage ? { usage } : {}) };
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
