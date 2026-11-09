/**
 * AI evaluation (spec 17.2, insumos 3.1): runs the whole dataset through the real pipeline
 * (OCR + layout readers + vision fallback, Whisper, text and close-reply interpretation), compares
 * with the answer sheets, prints the 17.2 table plus per-route usage and latency, and saves the run
 * in `datasets/eval-runs/`.
 *
 *   npm run eval -w server
 *   npm run eval -w server -- --only=images,texts --route=interpret_text=gemini#1 --delay-ms=2000
 *
 * Options:
 *   --only=images,generated,audios,texts,close   subsets (default: all)
 *   --route=<function>=<route id prefix>         keep only matching routes for a function, to
 *                                                evaluate one candidate model (D35); picks from
 *                                                `candidateRoutes`, repeatable
 *   --delay-ms=<n>                               pause after each AI call (free-tier limits; 1500)
 *   --limit=<n>                                  first n items of each subset
 *   --no-save                                    do not write the run file
 *
 * The dataset is fabricated by the team, so it may go to free models (8.3).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { createAiLayer } from '../ai/layer.js';
import {
  candidateRoutes,
  createClients,
  defaultRoutes,
  MODELS,
  MODELS_CHECKED_AT,
} from '../ai/models.js';
import { INTERPRET_CLOSE_REPLY_PROMPT_VERSION } from '../ai/prompts/close-reply.js';
import { EXTRACT_SCREENSHOT_PROMPT_VERSION } from '../ai/prompts/screenshot.js';
import { INTERPRET_TEXT_PROMPT_VERSION, type RecentEntry } from '../ai/prompts/text.js';
import { TRANSCRIBE_PROMPT_VERSION } from '../ai/prompts/transcribe.js';
import { readScreenshot } from '../ai/read-screenshot.js';
import type { AiFunction, RouteTable } from '../ai/router.js';
import { getConfig } from '../config.js';
import { createTesseractEngine, OCR_MODEL_ID } from '../ocr/engine.js';
import { OCR_PARSERS_VERSION } from '../ocr/layouts/index.js';
import { loadDotEnv, REPO_ROOT } from '../paths.js';
import {
  type AnswerRow,
  type CloseReplyItem,
  type Expectation,
  type ExpectedText,
  formatTable,
  type MetricRow,
  passes,
  pct,
  type Ratio,
  ratio,
  readAnswers,
  readJsonl,
  scoreCloseReply,
  scoreImage,
  scoreText,
  silentAmount,
} from './eval-lib.js';

const DATASETS = resolve(REPO_ROOT, 'datasets');
const SUBSETS = ['images', 'generated', 'audios', 'texts', 'close'] as const;
type Subset = (typeof SUBSETS)[number];

interface Options {
  only: Set<Subset>;
  routeFilters: Map<AiFunction, string>;
  delayMs: number;
  limit: number;
  save: boolean;
}

function parseOptions(argv: string[]): Options {
  const options: Options = {
    only: new Set(SUBSETS),
    routeFilters: new Map(),
    delayMs: 1500,
    limit: Number.POSITIVE_INFINITY,
    save: true,
  };
  for (const arg of argv) {
    const [key, value = ''] = arg.replace(/^--/, '').split(/=(.*)/s);
    if (key === 'only') options.only = new Set(value.split(',') as Subset[]);
    else if (key === 'route') {
      const [fn, prefix] = value.split(/=(.*)/s);
      if (fn && prefix) options.routeFilters.set(fn as AiFunction, prefix);
    } else if (key === 'delay-ms') options.delayMs = Number(value);
    else if (key === 'limit') options.limit = Number(value);
    else if (key === 'no-save') options.save = false;
  }
  return options;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Free tiers go down for a while (429/503): wait and retry so an outage is not scored. */
const OUTAGE_WAITS_MS = [20_000, 60_000];

async function retryOutage<T>(run: () => Promise<T>, unavailable: (r: T) => boolean): Promise<T> {
  let result = await run();
  for (const wait of OUTAGE_WAITS_MS) {
    if (!unavailable(result)) break;
    console.log(`  (all routes unavailable, retrying in ${wait / 1000} s)`);
    await sleep(wait);
    result = await run();
  }
  return result;
}

const isUnavailable = (r: { ok: boolean; error?: string }): boolean =>
  !r.ok && r.error === 'unavailable';

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.ogg': 'audio/ogg',
};

interface ImageItem {
  id: string;
  file: string;
  expect: Expectation;
  answer: AnswerRow;
  transform: string;
  duplicateOf?: string;
}

interface TextItem {
  id: string;
  case: string;
  text: string;
  context?: { closePending?: boolean; recentEntries?: RecentEntry[] };
  expected: ExpectedText;
}

interface GeneratedRow {
  id: string;
  file: string;
  source_id: string;
  transform: string;
  expect: Expectation;
  duplicate_of?: string;
}

function gitCommit(): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO_ROOT })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  loadDotEnv();
  const config = getConfig();
  const clients = createClients(config);
  const rotation = defaultRoutes(clients);
  // A --route filter picks from every candidate (certified or not, D35); the rest use the rotation.
  const candidates = candidateRoutes(clients);
  const routes: RouteTable = Object.fromEntries(
    Object.entries(rotation).map(([fn, list]) => {
      const prefix = options.routeFilters.get(fn as AiFunction);
      if (!prefix) return [fn, list];
      return [fn, (candidates[fn as AiFunction] ?? []).filter((r) => r.id.startsWith(prefix))];
    }),
  );
  const ai = createAiLayer({ routes });
  const ocr = await createTesseractEngine();
  const now = new Date();
  const started = Date.now();

  const answers = readAnswers(join(DATASETS, 'answers.csv'));
  const byId = new Map(answers.map((a) => [a.id, a]));
  const items: Record<string, unknown>[] = [];

  // ---------------------------------------------------------------- images
  const imageItems: ImageItem[] = [];
  if (options.only.has('images')) {
    for (const a of answers
      .filter((r) => r.type === 'individual_receipt')
      .slice(0, options.limit)) {
      imageItems.push({ id: a.id, file: a.file, expect: 'same', answer: a, transform: 'original' });
    }
  }
  if (options.only.has('generated')) {
    const generated = readJsonl<GeneratedRow>(join(DATASETS, 'generated', 'expected.jsonl'));
    for (const g of generated.slice(0, options.limit)) {
      const answer = byId.get(g.source_id);
      if (!answer) continue;
      imageItems.push({
        id: g.id,
        file: g.file,
        expect: g.expect,
        answer,
        transform: g.transform,
        duplicateOf: g.duplicate_of,
      });
    }
  }

  const imageScores: (ReturnType<typeof scoreImage> & {
    expect: Expectation;
    transform: string;
    source: string;
  })[] = [];
  const ocrTimes: number[] = [];
  for (const item of imageItems) {
    const data = readFileSync(join(DATASETS, item.file));
    const mimeType = MIME[extname(item.file).toLowerCase()] ?? 'image/jpeg';
    const reading = await retryOutage(
      () => readScreenshot({ data, mimeType }, { ocr, ai, now: () => now }),
      (r) => r.aiFailure === 'unavailable',
    );
    ocrTimes.push(reading.timings.ocrMs);
    const score = scoreImage(reading.extraction, item.expect, item.answer);
    imageScores.push({
      ...score,
      expect: item.expect,
      transform: item.transform,
      source: reading.source,
    });
    let duplicateDetected: boolean | undefined;
    if (item.duplicateOf) {
      const { createHash } = await import('node:crypto');
      const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
      duplicateDetected = sha(data) === sha(readFileSync(join(DATASETS, item.duplicateOf)));
    }
    items.push({
      kind: 'image',
      id: item.id,
      file: item.file,
      transform: item.transform,
      expect: item.expect,
      expectedAmount: item.answer.amount,
      source: reading.source,
      meta: reading.meta,
      aiFailure: reading.aiFailure,
      issues: reading.issues,
      timings: {
        ocrMs: Math.round(reading.timings.ocrMs),
        visionMs: Math.round(reading.timings.visionMs),
      },
      extraction: reading.extraction,
      score,
      duplicateDetected,
    });
    const flag = score.invented
      ? 'INVENTED'
      : score.amountOk
        ? 'ok'
        : score.unreadableDetected
          ? 'unreadable'
          : 'wrong';
    console.log(
      `${item.id.padEnd(34)} ${reading.source.padEnd(10)} amount=${String(score.amountRead).padEnd(8)} expected=${item.expect === 'unreadable' ? 'unreadable' : item.answer.amount} ${flag} ocr=${Math.round(reading.timings.ocrMs)}ms vision=${Math.round(reading.timings.visionMs)}ms`,
    );
    if (reading.source !== 'ocr') await sleep(options.delayMs);
  }

  // ---------------------------------------------------------------- audios
  const audioScores: ReturnType<typeof scoreText>[] = [];
  if (options.only.has('audios')) {
    for (const a of answers.filter((r) => r.type === 'audio').slice(0, options.limit)) {
      const data = readFileSync(join(DATASETS, a.file));
      const transcription = await retryOutage(
        () => ai.transcribeAudio({ data, mimeType: 'audio/ogg' }),
        isUnavailable,
      );
      await sleep(options.delayMs);
      if (!transcription.ok) {
        audioScores.push({
          correct: false,
          intentOk: false,
          invented: 0,
          problems: [transcription.error],
        });
        items.push({ kind: 'audio', id: a.id, error: transcription.error });
        console.log(`${a.id.padEnd(34)} transcription failed: ${transcription.error}`);
        continue;
      }
      const transcript = transcription.value.text;
      const interpretation = await retryOutage(
        () => ai.interpretText(transcript, { now, closePending: false }),
        isUnavailable,
      );
      await sleep(options.delayMs);
      const expected: ExpectedText = {
        intent: 'record',
        operations: [
          {
            amount: a.amount,
            direction: a.direction,
            payment_method: [a.payment_method],
            scope: a.scope,
            category: ['sale'],
          },
        ],
      };
      const score = interpretation.ok
        ? scoreText(interpretation.value, expected)
        : { correct: false, intentOk: false, invented: 0, problems: [interpretation.error] };
      audioScores.push(score);
      items.push({
        kind: 'audio',
        id: a.id,
        transcript: transcription.value.text,
        transcriptionMeta: transcription.meta,
        interpretation: interpretation.ok ? interpretation.value : null,
        interpretationMeta: interpretation.ok ? interpretation.meta : null,
        score,
      });
      console.log(
        `${a.id.padEnd(34)} «${transcription.value.text}» ${score.correct ? 'ok' : score.problems.join(',')}`,
      );
    }
  }

  // ---------------------------------------------------------------- texts
  const textScores: ReturnType<typeof scoreText>[] = [];
  if (options.only.has('texts')) {
    const texts = readJsonl<TextItem>(join(DATASETS, 'texts', 'texts.jsonl')).slice(
      0,
      options.limit,
    );
    for (const t of texts) {
      const result = await retryOutage(
        () =>
          ai.interpretText(t.text, {
            now,
            closePending: t.context?.closePending ?? false,
            recentEntries: t.context?.recentEntries ?? [],
          }),
        isUnavailable,
      );
      await sleep(options.delayMs);
      const score = result.ok
        ? scoreText(result.value, t.expected)
        : { correct: false, intentOk: false, invented: 0, problems: [result.error] };
      textScores.push(score);
      items.push({
        kind: 'text',
        id: t.id,
        case: t.case,
        result: result.ok ? result.value : null,
        meta: result.ok ? result.meta : null,
        error: result.ok ? null : result.error,
        score,
      });
      const amounts = result.ok
        ? result.value.operations.map((o) => `${o.amount}${silentAmount(o) ? '' : '?'}`).join('+')
        : '';
      console.log(
        `${t.id.padEnd(8)} ${(result.ok ? result.value.intent : 'FAIL').padEnd(12)} ${amounts.padEnd(18)} ${score.correct ? 'ok' : score.problems.join(',')}${score.invented ? ' INVENTED' : ''}`,
      );
    }
  }

  // ---------------------------------------------------------------- close replies
  const closeScores: ReturnType<typeof scoreCloseReply>[] = [];
  if (options.only.has('close')) {
    const replies = readJsonl<CloseReplyItem>(
      join(DATASETS, 'close-replies', 'close-replies.jsonl'),
    ).slice(0, options.limit);
    for (const r of replies) {
      const result = await retryOutage(
        () => ai.interpretCloseReply(r.reply, r.questions),
        isUnavailable,
      );
      await sleep(options.delayMs);
      const score = result.ok
        ? scoreCloseReply(result.value, r.expected, r.questions)
        : { correct: false, intentOk: false, invented: 0, problems: [result.error] };
      closeScores.push(score);
      items.push({
        kind: 'close_reply',
        id: r.id,
        case: r.case,
        result: result.ok ? result.value : null,
        meta: result.ok ? result.meta : null,
        error: result.ok ? null : result.error,
        score,
      });
      console.log(
        `${r.id.padEnd(8)} ${score.correct ? 'ok' : score.problems.join(',')}${score.invented ? ' INVENTED' : ''}`,
      );
    }
  }
  await ocr.close();

  // ---------------------------------------------------------------- metrics (17.2)
  const legibleSet = imageScores.filter((s) => s.expect === 'same');
  const unreadableSet = imageScores.filter((s) => s.expect === 'unreadable');
  const degradedSet = imageScores.filter((s) => s.expect === 'same_or_unreadable');
  const directionSet = imageScores.filter((s) => s.directionOk !== null);
  const dateSet = legibleSet;
  const invented =
    imageScores.filter((s) => s.invented).length +
    [...audioScores, ...textScores, ...closeScores].reduce(
      (n, s) => n + (s.invented > 0 ? 1 : 0),
      0,
    );
  const evaluated =
    imageScores.length + audioScores.length + textScores.length + closeScores.length;
  const opsSet = [...audioScores, ...textScores];

  const rows: MetricRow[] = [
    {
      measure: 'Monto exacto en capturas legibles',
      threshold: '≥ 95 %',
      value: ratio(legibleSet.filter((s) => s.amountOk).length, legibleSet.length),
      limit: 0.95,
    },
    {
      measure: 'Dirección correcta (entra o sale)',
      threshold: '≥ 95 %',
      value: ratio(directionSet.filter((s) => s.directionOk).length, directionSet.length),
      limit: 0.95,
    },
    {
      measure: 'Fecha correcta cuando es visible',
      threshold: '≥ 90 %',
      value: ratio(dateSet.filter((s) => s.dateOk === true).length, dateSet.length),
      limit: 0.9,
    },
    {
      measure: '**Montos inventados** (incorrecto y sin duda)',
      threshold: '≤ 2 %',
      value: ratio(invented, evaluated),
      lowerIsBetter: true,
      limit: 0.02,
    },
    {
      measure: 'Ilegibles detectados como ilegibles',
      threshold: '≥ 90 %',
      value: ratio(unreadableSet.filter((s) => s.unreadableDetected).length, unreadableSet.length),
      limit: 0.9,
    },
    {
      measure: 'Operaciones correctas en audios y textos',
      threshold: '≥ 90 %',
      value: ratio(opsSet.filter((s) => s.correct).length, opsSet.length),
      limit: 0.9,
    },
    {
      measure: 'Respuestas al cierre interpretadas correctamente',
      threshold: '≥ 90 %',
      value: ratio(closeScores.filter((s) => s.correct).length, closeScores.length),
      limit: 0.9,
    },
  ];

  const extra: Record<string, Ratio> = {
    degradedReadCorrectly: ratio(degradedSet.filter((s) => s.amountOk).length, degradedSet.length),
    readByOcrOnly: ratio(imageScores.filter((s) => s.source === 'ocr').length, imageScores.length),
    textsCorrect: ratio(textScores.filter((s) => s.correct).length, textScores.length),
    audiosCorrect: ratio(audioScores.filter((s) => s.correct).length, audioScores.length),
  };
  const sortedOcr = [...ocrTimes].sort((a, b) => a - b);
  const ocrTiming = sortedOcr.length
    ? {
        meanMs: Math.round(sortedOcr.reduce((a, b) => a + b, 0) / sortedOcr.length),
        medianMs: Math.round(sortedOcr[Math.floor(sortedOcr.length / 2)] as number),
        maxMs: Math.round(sortedOcr[sortedOcr.length - 1] as number),
      }
    : null;
  const routeStats = ai.stats().map((s) => ({
    ...s,
    meanLatencyMs: s.calls ? Math.round(s.latencyMsTotal / s.calls) : 0,
  }));

  console.log('\n## Evaluación 17.2\n');
  console.log(formatTable(rows));
  console.log(
    `\nDegradadas leídas bien: ${pct(extra.degradedReadCorrectly as Ratio)} · solo OCR: ${pct(extra.readByOcrOnly as Ratio)} · textos: ${pct(extra.textsCorrect as Ratio)} · audios: ${pct(extra.audiosCorrect as Ratio)}`,
  );
  if (ocrTiming) {
    console.log(
      `OCR por imagen: media ${ocrTiming.meanMs} ms · mediana ${ocrTiming.medianMs} ms · máx ${ocrTiming.maxMs} ms`,
    );
  }
  console.log('\n## Uso por ruta\n');
  console.log('| Función | Ruta | Llamadas | OK | Fallas | Latencia media | Máx |');
  console.log('|---|---|---|---|---|---|---|');
  for (const s of routeStats) {
    const failures =
      Object.entries(s.failures)
        .map(([k, v]) => `${k}:${v}`)
        .join(' ') || '—';
    console.log(
      `| ${s.fn} | ${s.routeId} | ${s.calls} | ${s.ok} | ${failures} | ${s.meanLatencyMs} ms | ${s.latencyMsMax} ms |`,
    );
  }

  if (options.save) {
    const dir = join(DATASETS, 'eval-runs');
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = join(dir, `${stamp}.json`);
    writeFileSync(
      file,
      `${JSON.stringify(
        {
          date: new Date().toISOString(),
          durationMs: Date.now() - started,
          commit: gitCommit(),
          options: {
            only: [...options.only],
            routeFilters: Object.fromEntries(options.routeFilters),
            delayMs: options.delayMs,
            limit: Number.isFinite(options.limit) ? options.limit : null,
          },
          models: { ...MODELS, checkedAt: MODELS_CHECKED_AT, ocr: OCR_MODEL_ID },
          routes: Object.fromEntries(
            Object.entries(routes).map(([fn, list]) => [fn, (list ?? []).map((r) => r.id)]),
          ),
          promptVersions: {
            extract_screenshot: EXTRACT_SCREENSHOT_PROMPT_VERSION,
            transcribe_audio: TRANSCRIBE_PROMPT_VERSION,
            interpret_text: INTERPRET_TEXT_PROMPT_VERSION,
            interpret_close_reply: INTERPRET_CLOSE_REPLY_PROMPT_VERSION,
            ocr_layouts: OCR_PARSERS_VERSION,
          },
          metrics: rows.map((r) => ({ ...r, pass: passes(r) })),
          extra,
          ocrTiming,
          routeStats,
          items,
        },
        null,
        2,
      )}\n`,
    );
    console.log(`\nGuardado en ${file.replace(`${REPO_ROOT}/`, '')}`);
  }
}

await main();
