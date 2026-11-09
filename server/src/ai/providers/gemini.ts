import { GoogleGenAI, type Part } from '@google/genai';
import {
  type GenerateRequest,
  type ProviderClient,
  ProviderError,
  type RawTranscription,
  toProviderError,
} from './types.js';

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

    async transcribe(): Promise<RawTranscription> {
      // Gemini has no speech-to-text endpoint: the layer transcribes with `generate` + audio.
      throw new ProviderError('unsupported');
    },
  };
}
