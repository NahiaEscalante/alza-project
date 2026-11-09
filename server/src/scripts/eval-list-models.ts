import { GoogleGenAI } from '@google/genai';
import Groq from 'groq-sdk';
import { getConfig } from '../config.js';
import { loadDotEnv } from '../paths.js';

/**
 * One-off model discovery (Fase 2): lists the models each configured key can use, so the routes in
 * `ai/models.ts` can be updated. Prints model ids only, never keys.
 *
 *   npx tsx src/scripts/eval-list-models.ts
 */
async function main(): Promise<void> {
  loadDotEnv();
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
