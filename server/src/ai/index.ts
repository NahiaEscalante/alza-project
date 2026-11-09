/**
 * AI layer (spec 8.3): interchangeable providers (Groq, Gemini; Claude Sonnet later), automatic
 * failover, zod-validated outputs, deterministic post-checks. Screenshots: `readScreenshot`
 * (OCR first, D33). Wiring:
 *
 *   const ai = createAiLayer({ routes: defaultRoutes(createClients(config)), logger });
 *   const ocr = await createTesseractEngine();
 *   const reading = await readScreenshot({ data, mimeType }, { ocr, ai, logger });
 */
export * from './amount.js';
export * from './circuit-breaker.js';
export * from './layer.js';
export * from './models.js';
export * from './post-checks.js';
export * from './providers/types.js';
export * from './read-screenshot.js';
export * from './router.js';
export * from './schemas.js';
