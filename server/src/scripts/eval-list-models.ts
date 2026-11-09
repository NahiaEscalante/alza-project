import { GoogleGenAI } from '@google/genai';
import Groq from 'groq-sdk';
import { getConfig } from '../config.js';
import { loadDotEnv } from '../paths.js';

/**
 * One-off model discovery (Fase 2): lists the models each configured key can use, so the routes in
 * `ai/models.ts` can be updated. Prints model ids only, never keys.
 *
 *   npx tsx src/scripts/eval-list-models.ts
 *   npx tsx src/scripts/eval-list-models.ts --limits=openai/gpt-oss-20b,gemini-3.5-flash-lite
 *
 * `--limits`: one tiny call per model (Groq ids have a «/», the rest are Gemini; «2#model» uses
 * key 2, default key 1). Groq
 * answers with its free-tier limits in headers (requests per day, tokens per minute); Gemini only
 * says whether the model answers (ok, rate_limit…).
 */
async function probeLimits(models: string[]): Promise<void> {
  const config = getConfig();
  for (const model of models) {
    if (model.includes('/')) {
      if (!config.groqApiKey) continue;
      const groq = new Groq({ apiKey: config.groqApiKey, maxRetries: 0 });
      try {
        const { response } = await groq.chat.completions
          .create({
            model,
            messages: [{ role: 'user', content: 'di ok' }],
            max_completion_tokens: 8,
          })
          .withResponse();
        const h = (name: string) => response.headers.get(name) ?? '?';
        console.log(
          `${model}\tok\trequests/day=${h('x-ratelimit-limit-requests')} (left ${h('x-ratelimit-remaining-requests')})\ttokens/min=${h('x-ratelimit-limit-tokens')} (left ${h('x-ratelimit-remaining-tokens')})`,
        );
      } catch (err) {
        const e = err as {
          status?: number;
          headers?: Headers;
          error?: { error?: { code?: string } };
        };
        const h = (name: string) => e.headers?.get?.(name) ?? '?';
        // The vendor message can echo request data: only the error code and the headers.
        console.log(
          `${model}\terror ${e.status ?? ''} ${e.error?.error?.code ?? ''}\tretry-after=${h('retry-after')}\trequests left=${h('x-ratelimit-remaining-requests')}\ttokens left=${h('x-ratelimit-remaining-tokens')}`,
        );
      }
    } else {
      // «2#gemini-3.5-flash» probes key 2.
      const [keyPart, name] = model.includes('#') ? model.split('#') : ['1', model];
      const apiKey = config.geminiApiKeys[Number(keyPart) - 1];
      if (!apiKey || !name) continue;
      const ai = new GoogleGenAI({ apiKey });
      try {
        await ai.models.generateContent({
          model: name,
          contents: 'di ok',
          config: { maxOutputTokens: 8 },
        });
        console.log(`${model}\tok`);
      } catch (err) {
        console.log(`${model}\terror ${(err as { status?: number }).status ?? ''}`);
      }
    }
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const limits = process.argv.find((a) => a.startsWith('--limits='));
  if (limits) {
    await probeLimits(limits.slice('--limits='.length).split(',').filter(Boolean));
    return;
  }
  const config = getConfig();

  if (config.groqApiKey) {
    const groq = new Groq({ apiKey: config.groqApiKey });
    const models = await groq.models.list();
    console.log('# Groq');
    for (const m of models.data) {
      const extra = m as unknown as { context_window?: number; active?: boolean };
      console.log(
        `${m.id}\towner=${m.owned_by}\tctx=${extra.context_window ?? '?'}\tactive=${extra.active ?? '?'}`,
      );
    }
  }

  for (const [index, apiKey] of config.geminiApiKeys.entries()) {
    const ai = new GoogleGenAI({ apiKey });
    console.log(`# Gemini key ${index + 1}`);
    const pager = await ai.models.list({ config: { pageSize: 100 } });
    const names: string[] = [];
    for await (const m of pager) {
      const actions = m.supportedActions ?? [];
      if (!actions.includes('generateContent')) continue;
      names.push(`${m.name}\tin=${m.inputTokenLimit ?? '?'}`);
    }
    console.log(index === 0 ? names.join('\n') : `${names.length} generateContent models`);
  }
}

await main();
