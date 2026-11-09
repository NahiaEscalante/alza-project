import { type Content, FunctionCallingConfigMode, GoogleGenAI, type Part } from '@google/genai';
import {
  type ChatStepRequest,
  type ChatStepResponse,
  type GenerateRequest,
  type ProviderClient,
  ProviderError,
  type RawTranscription,
  type TokenUsage,
  type ToolCall,
  toProviderError,
} from './types.js';

/**
 * Vendor-neutral turns → Gemini contents. A model turn with tool calls is echoed from
 * `providerData` (the candidate's own content) so its thought signatures go back as received;
 * consecutive tool results become one user turn of `functionResponse` parts.
 */
function toGeminiContents(request: ChatStepRequest): Content[] {
  const contents: Content[] = [];
  for (const turn of request.messages) {
    if (turn.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: turn.content }] });
    } else if (turn.role === 'assistant') {
      if (turn.providerData) contents.push(turn.providerData as Content);
      else if (turn.toolCalls?.length) {
        contents.push({
          role: 'model',
          parts: [
            ...(turn.content ? [{ text: turn.content }] : []),
            ...turn.toolCalls.map((call) => ({
              functionCall: {
                name: call.name,
                args: (call.arguments ?? {}) as Record<string, unknown>,
              },
            })),
          ],
        });
      } else contents.push({ role: 'model', parts: [{ text: turn.content }] });
    } else {
      const part: Part = {
        functionResponse: { name: turn.name, response: { output: turn.content } },
      };
      const last = contents.at(-1);
      if (last?.role === 'user' && last.parts?.every((p) => p.functionResponse)) {
        last.parts.push(part);
      } else contents.push({ role: 'user', parts: [part] });
    }
  }
  return contents;
}

/** Gemini accepts text, images and audio in the same call (D34: audio fallback). */
export function createGeminiClient(apiKey: string): ProviderClient {
  const ai = new GoogleGenAI({ apiKey });

  return {
    provider: 'gemini',

    async generate(model: string, request: GenerateRequest, signal: AbortSignal): Promise<string> {
      const parts: Part[] = [{ text: request.prompt }];
      for (const media of [request.image, request.audio]) {
        if (media) {
          parts.push({
            inlineData: { mimeType: media.mimeType, data: media.data.toString('base64') },
          });
        }
      }
      let text: string | undefined;
      try {
        const res = await ai.models.generateContent({
          model,
          contents: [{ role: 'user', parts }],
          config: {
            systemInstruction: request.system,
            temperature: request.temperature ?? 0,
            abortSignal: signal,
            ...(request.maxOutputTokens ? { maxOutputTokens: request.maxOutputTokens } : {}),
            ...(request.json ? { responseMimeType: 'application/json' } : {}),
          },
        });
        text = res.text;
      } catch (err) {
        throw toProviderError(err);
      }
      if (!text?.trim()) throw new ProviderError('empty');
      return text;
    },

    async chat(
      model: string,
      request: ChatStepRequest,
      signal: AbortSignal,
    ): Promise<ChatStepResponse> {
      let content: Content | undefined;
      let usage: TokenUsage | undefined;
      try {
        const res = await ai.models.generateContent({
          model,
          contents: toGeminiContents(request),
          config: {
            systemInstruction: request.system,
            temperature: request.temperature ?? 0,
            abortSignal: signal,
            ...(request.maxOutputTokens ? { maxOutputTokens: request.maxOutputTokens } : {}),
            tools: [
              {
                functionDeclarations: request.tools.map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  parametersJsonSchema: tool.parameters,
                })),
              },
            ],
            toolConfig: {
              functionCallingConfig: {
                mode:
                  request.toolChoice === 'none'
                    ? FunctionCallingConfigMode.NONE
                    : FunctionCallingConfigMode.AUTO,
              },
            },
          },
        });
        content = res.candidates?.[0]?.content;
        const meta = res.usageMetadata;
        if (meta) {
          usage = {
            inputTokens: (meta.promptTokenCount ?? 0) + (meta.toolUsePromptTokenCount ?? 0),
            outputTokens: (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0),
            ...(meta.cachedContentTokenCount
              ? { cachedInputTokens: meta.cachedContentTokenCount }
              : {}),
          };
        }
      } catch (err) {
        throw toProviderError(err);
      }
      const parts = content?.parts ?? [];
      const toolCalls: ToolCall[] = parts
        .filter((part) => part.functionCall)
        .map((part, i) => ({
          id: part.functionCall?.id ?? `call_${i + 1}`,
          name: part.functionCall?.name ?? '',
          arguments: part.functionCall?.args ?? {},
        }));
      // Thought parts are the model's reasoning, never the answer.
      const text = parts
        .filter((part) => typeof part.text === 'string' && !part.thought)
        .map((part) => part.text)
        .join('');
      if (!text.trim() && toolCalls.length === 0) throw new ProviderError('empty');
      return {
        text,
        toolCalls,
        providerData: toolCalls.length > 0 ? { role: 'model', parts } : undefined,
        ...(usage ? { usage } : {}),
      };
    },

    async transcribe(): Promise<RawTranscription> {
      // Gemini has no speech-to-text endpoint: the layer transcribes with `generate` + audio.
      throw new ProviderError('unsupported');
    },
  };
}
