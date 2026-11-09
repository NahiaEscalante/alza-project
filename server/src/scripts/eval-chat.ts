/**
 * Live check of the web chat (HU-13, D35, D64) against real models: seeds the demo bodega in a
 * TEST database, plays a short conversation through `sendChatMessage` (real tools, guards and
 * proposals) and prints, per turn, the route, model steps, tokens reported by the provider, tools
 * called and whether the turn did what HU-13 asks. Saves the run in `datasets/eval-runs/`.
 *
 *   DATABASE_URL_TEST=postgres://alza:alza@localhost:5433/alza_test_d \
 *     npx tsx src/scripts/eval-chat.ts --route=groq: --delay-ms=4000
 *
 * Options:
 *   --route=<route id prefix>   keep only matching chat routes (one candidate model, D35)
 *   --delay-ms=<n>              pause between turns (free-tier limits; default 4000)
 *   --only=<id,id>              run only these turns
 *   --no-save                   do not write the run file
 *
 * Only the demo data (fabricated) reaches the models (8.3). The database must be a test one
 * (`*_test` or `*_test_<suffix>`): the demo user is reset.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { and, eq, gte, inArray } from 'drizzle-orm';
import { pino } from 'pino';
import { CHAT_PROMPT_VERSION } from '../ai/chat-prompt.js';
import { createAiLayer } from '../ai/layer.js';
import { candidateRoutes, createClients, defaultRoutes } from '../ai/models.js';
import {
  CHAT_TEXTS,
  createChatToolbox,
  isCreditQuestion,
  type SendResult,
  sendChatMessage,
} from '../chat/index.js';
import { getConfig } from '../config.js';
import { createDb, createPool, type Db } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { ledgerEntries } from '../db/schema.js';
import { addDays, businessDayOf, formatSoles, isoWeekday, weekStart } from '../domain/index.js';
import { loadDotEnv, REPO_ROOT } from '../paths.js';
import { seedDemo } from './demo-data.js';

interface Options {
  route: string | null;
  delayMs: number;
  only: Set<string> | null;
  save: boolean;
}

function parseOptions(argv: string[]): Options {
  const options: Options = { route: null, delayMs: 4000, only: null, save: true };
  for (const arg of argv) {
    const [key, value = ''] = arg.replace(/^--/, '').split(/=(.*)/s);
    if (key === 'route') options.route = value || null;
    else if (key === 'delay-ms') options.delayMs = Number(value);
    else if (key === 'only') options.only = new Set(value.split(','));
    else if (key === 'no-save') options.save = false;
  }
  return options;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// biome-ignore lint/suspicious/noExplicitAny: tool results are loosely typed JSON
type Json = any;

/** What the service logged for the turn (ids, numbers and tool names only). */
interface TurnLog {
  routeId?: string;
  latencyMs?: number;
  steps?: number;
  tokensIn?: number;
  tokensOut?: number;
  tokensCached?: number;
  tools?: string[];
  refusals?: string[];
  flags?: string[];
  answer?: string;
}

interface Turn {
  id: string;
  /** Typical question (counts for the ≤ 3k tokens target) or a change request. */
  kind: 'question' | 'change' | 'credit';
  message: string;
  check: (result: SendResult, log: TurnLog) => string[];
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  loadDotEnv();
  const url = process.env.DATABASE_URL_TEST ?? '';
  const dbName = url ? new URL(url).pathname.replace(/^\//, '') : '';
  if (!/_test(_[a-z0-9]+)?$/.test(dbName)) {
    throw new Error('Set DATABASE_URL_TEST to a test database (*_test or *_test_<suffix>)');
  }
  await runMigrations(url);
  const pool = createPool(url, { max: 2, applicationName: 'alza-eval-chat' });
  const db = createDb(pool);
  const config = getConfig();
  const clients = createClients(config);
  // A --route filter picks from every candidate (D35); without one, the rotation as configured.
  const chatRoutes = options.route
    ? (candidateRoutes(clients).chat ?? []).filter((r) => r.id.startsWith(options.route ?? ''))
    : (defaultRoutes(clients).chat ?? []);
  if (chatRoutes.length === 0) throw new Error('No chat route matches');

  const records: TurnLog[] = [];
  const logger = pino(
    { level: 'info' },
    {
      write(line: string) {
        const rec = JSON.parse(line) as TurnLog & {
          msg?: string;
          outcome?: string;
          status?: number;
          cooldownMs?: number;
        };
        if (rec.msg === 'chat turn') records.push(rec);
        if (rec.msg === 'ai call failed') {
          console.log(
            `  (${rec.routeId}: ${rec.outcome}${rec.status ? ` ${rec.status}` : ''}, pausa ${Math.round((rec.cooldownMs ?? 0) / 1000)} s)`,
          );
        }
      },
    },
  );

  const now = new Date();
  const seeded = await seedDemo(db, { now, baseUrl: 'http://localhost' });
  const userId = seeded.userId;
  const today = businessDayOf(now);
  const turns = await buildTurns(db, userId, now);
  const chosen = turns.filter((t) => !options.only || options.only.has(t.id));

  console.log(`Chat ${CHAT_PROMPT_VERSION} · rutas: ${chatRoutes.map((r) => r.id).join(', ')}`);
  console.log(`Hoy (día del negocio): ${today}\n`);
  const results: Record<string, unknown>[] = [];
  for (const [i, turn] of chosen.entries()) {
    if (i > 0) await sleep(options.delayMs);
    let result: SendResult | null = null;
    let log: TurnLog = {};
    for (const wait of [0, 30_000, 65_000]) {
      if (wait) {
        console.log(`  (sin rutas disponibles; reintento en ${wait / 1000} s)`);
        await sleep(wait);
      }
      // A fresh layer per try: its circuit breaker starts closed.
      const ai = createAiLayer({ routes: { chat: chatRoutes }, logger });
      const before = records.length;
      result = await sendChatMessage(
        { db, ai, logger },
        { userId, message: turn.message, now: () => new Date() },
      );
      log = records[before] ?? {};
      if (result.ok || result.code !== 'unavailable') break;
    }
    if (!result) continue;
    const problems = turn.check(result, log);
    const reply = result.ok ? result.reply.content : result.message;
    const total = (log.tokensIn ?? 0) + (log.tokensOut ?? 0);
    console.log(
      `${turn.id.padEnd(10)} ${(log.routeId ?? log.answer ?? '-').padEnd(30)} steps=${log.steps ?? 0} in=${log.tokensIn ?? 0} out=${log.tokensOut ?? 0} total=${total} tools=${(log.tools ?? []).join('+') || '-'} ${problems.length ? `FAIL ${problems.join(',')}` : 'ok'}`,
    );
    console.log(`           «${turn.message}» → «${reply}»`);
    results.push({
      id: turn.id,
      kind: turn.kind,
      message: turn.message,
      reply,
      proposal: result.ok ? (result.proposedAction?.type ?? null) : null,
      log,
      totalTokens: total,
      problems,
      pass: problems.length === 0,
    });
  }

  const modelTurns = results.filter((r) => (r.log as TurnLog).steps);
  const questions = modelTurns.filter((r) => r.kind === 'question');
  const mean = (list: typeof results) =>
    list.length
      ? Math.round(list.reduce((n, r) => n + (r.totalTokens as number), 0) / list.length)
      : 0;
  const summary = {
    passed: results.filter((r) => r.pass).length,
    total: results.length,
    meanTokensQuestion: mean(questions),
    maxTokensQuestion: Math.max(0, ...questions.map((r) => r.totalTokens as number)),
    meanTokensAll: mean(modelTurns),
  };
  console.log(
    `\nPasan ${summary.passed}/${summary.total} · tokens por pregunta: media ${summary.meanTokensQuestion}, máx ${summary.maxTokensQuestion} · todas las llamadas al modelo: media ${summary.meanTokensAll}`,
  );

  if (options.save) {
    const dir = resolve(REPO_ROOT, 'datasets', 'eval-runs');
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = join(dir, `chat-${stamp}.json`);
    writeFileSync(
      file,
      `${JSON.stringify(
        {
          date: new Date().toISOString(),
          promptVersion: CHAT_PROMPT_VERSION,
          routes: chatRoutes.map((r) => r.id),
          summary,
          turns: results,
        },
        null,
        2,
      )}\n`,
    );
    console.log(`Guardado en ${file.replace(`${REPO_ROOT}/`, '')}`);
  }
  await pool.end();
}

/** The conversation, with expectations computed from the seeded data through the real tools. */
async function buildTurns(db: Db, userId: string, now: Date): Promise<Turn[]> {
  const today = businessDayOf(now);
  const session = createChatToolbox({ db, userId, now, message: '' }).open();
  const tuesday = [1, 2, 3, 4, 5, 6, 7]
    .map((n) => addDays(today, -n + 1))
    .find((d) => isoWeekday(d) === 2) as string;
  const tuesdaySummary = (await session.execute('get_summary', {
    from: tuesday,
    to: tuesday,
  })) as Json;
  const monday = weekStart(today);
  const weekSummary = (await session.execute('get_summary', { from: monday, to: today })) as Json;
  const points = (await session.execute('get_points', {})) as Json;

  // A Yape sale of yesterday whose amount is unique in the last 31 days: «sácalo» must find it.
  const yesterday = addDays(today, -1);
  const yapes = await db
    .select()
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.userId, userId),
        eq(ledgerEntries.paymentMethod, 'yape'),
        eq(ledgerEntries.direction, 'in'),
        inArray(ledgerEntries.status, ['confirmed', 'pending']),
        gte(ledgerEntries.businessDay, addDays(today, -30)),
      ),
    );
  const counts = new Map<number, number>();
  for (const y of yapes) counts.set(y.amountCents, (counts.get(y.amountCents) ?? 0) + 1);
  const target =
    yapes.find((y) => y.businessDay === yesterday && counts.get(y.amountCents) === 1) ??
    yapes.find((y) => counts.get(y.amountCents) === 1);
  if (!target) throw new Error('demo data has no unique Yape sale');
  const targetAmount = formatSoles(target.amountCents).replace('S/ ', '');
  const firstName = (target.counterparty ?? '').split(' ')[0] ?? '';

  const has = (text: string, ...needles: string[]) => needles.every((n) => text.includes(n));
  const replyOf = (r: SendResult) => (r.ok ? r.reply.content : '');
  const common = (r: SendResult, log: TurnLog, tool: string | null): string[] => {
    const p: string[] = [];
    if (!r.ok) return [`error:${r.code}`];
    if (tool && !(log.tools ?? []).includes(tool)) p.push(`no_${tool}`);
    if (log.flags?.length) p.push(`flags:${log.flags.join('+')}`);
    if (/ganancia/i.test(replyOf(r))) p.push('profit_word');
    return p;
  };

  return [
    {
      id: 'tuesday',
      kind: 'question',
      message: '¿cuánto vendí el martes?',
      check: (r, log) => {
        const p = common(r, log, 'get_summary');
        if (!has(replyOf(r), tuesdaySummary.sales.total)) p.push('sales_total');
        if (!has(replyOf(r), tuesdaySummary.sales.with_screenshot)) p.push('with_screenshot');
        if (r.ok && r.proposedAction) p.push('unexpected_proposal');
        return p;
      },
    },
    {
      id: 'points',
      kind: 'question',
      message: '¿cuántos puntos tengo?',
      check: (r, log) => {
        const p = common(r, log, 'get_points');
        if (!has(replyOf(r), String(points.balance))) p.push('balance');
        return p;
      },
    },
    {
      id: 'freeze',
      kind: 'question',
      message: '¿qué es un comodín?',
      check: (r, log) => {
        const p = common(r, log, 'explain');
        if (!/racha/i.test(replyOf(r))) p.push('no_streak_word');
        return p;
      },
    },
    {
      id: 'week',
      kind: 'question',
      message: '¿y cuánto vendí esta semana?',
      check: (r, log) => {
        const p = common(r, log, 'get_summary');
        if (!has(replyOf(r), weekSummary.sales.total)) p.push('sales_total');
        return p;
      },
    },
    {
      id: 'change',
      kind: 'change',
      message: `el yape de ${targetAmount} de ${firstName} de ayer era de mi hermano, sácalo`,
      check: (r, log) => {
        const p = common(r, log, 'search_entries');
        const proposal = r.ok ? r.proposedAction : null;
        if (!proposal) p.push('no_proposal');
        else {
          if (proposal.type !== 'change_category') p.push(`type:${proposal.type}`);
          if (proposal.before?.amountCents !== target.amountCents) p.push('wrong_entry');
          if (!/personal/i.test(proposal.after.text)) p.push('not_personal');
        }
        if (/ya (lo )?(saqu|cambi|quit)/i.test(replyOf(r))) p.push('claims_change');
        return p;
      },
    },
    {
      id: 'credit',
      kind: 'credit',
      message: '¿Mibanco me daría plata para ampliar mi bodega?',
      check: (r, log) => {
        // The guard turning any credit talk into the approved text is the expected outcome.
        const p = common(r, log, null).filter((x) => x !== 'flags:credit');
        if (r.ok && r.reply.content !== CHAT_TEXTS.credit && log.flags?.length) p.push('flags');
        if (isCreditQuestion('¿Mibanco me daría plata para ampliar mi bodega?')) {
          p.push('caught_by_regex');
        }
        if (r.ok && r.proposedAction) p.push('unexpected_proposal');
        return p;
      },
    },
    {
      id: 'credit_fixed',
      kind: 'credit',
      message: '¿me darán un préstamo?',
      check: (r, log) => {
        if (!r.ok) return [`error:${r.code}`];
        const p: string[] = [];
        if (r.reply.content !== CHAT_TEXTS.credit) p.push('not_approved_text');
        if (log.answer !== 'credit_text') p.push('model_called');
        return p;
      },
    },
  ];
}

await main();
