/**
 * A complete day of a brand-new user, over the WhatsApp simulator and the web, with 360 px
 * screenshots of every step. For integration checks and demo rehearsals.
 *
 *   npm run dev                                   # server (SIMULATOR_ENABLED) + web, or e.g.
 *   PORT=3100 APP_BASE_URL=http://localhost:5180 npx tsx server/src/index.ts
 *   PORT=3100 npx vite --port 5180 --strictPort   # from web/
 *   ALZA_SERVER_URL=http://localhost:3100 ALZA_WEB_URL=http://localhost:5180 \
 *     node web/e2e/whatsapp-day.mjs [screenshots-dir]
 *
 * Walk: new number → «Hola» → Acepto → business → holder → a close time after 2 a. m. (D67
 * variant) → 9 pm (or 2 a. m. when it is already late, so the 5-minute sender does not beat
 * «cierre») → WA-06 → Yape received and sent screenshots (WA-07 once) → an unreadable screenshot →
 * an audio → «vendí 5 soles de pan» → «cierre» → WA-10 (image + caption) → the answer to its
 * doubts → WA-12 → the 7-day link before having a PIN → activation link → PIN → Inicio →
 * `close-finalize` of the day through `/dev/simulador/api/run-job` → points and streak.
 *
 * Real AI (Groq/Gemini free tiers): messages are sent one at a time and each one is waited for;
 * the summary lists the messages that needed retries (429s). Not part of `npm test`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(root, 'package.json'));
const { chromium } = require('playwright');

const SERVER = process.env.ALZA_SERVER_URL ?? 'http://localhost:3000';
const WEB = process.env.ALZA_WEB_URL ?? 'http://localhost:5173';
const OUT = resolve(process.argv[2] ?? join(root, 'web/e2e/screenshots'));
const PHONE =
  process.env.ALZA_PHONE ?? `+519${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const BUSINESS = process.env.ALZA_BUSINESS ?? 'Bodega Sofía';
// Matches the «¡Yapeaste!» dataset receipt (to «Sofia Rey*»): that screen is a client paying her.
const HOLDER = process.env.ALZA_HOLDER ?? 'Sofia Reyes';
const PIN = process.env.ALZA_PIN ?? '284719';
const SIM = `${SERVER}/dev/simulador`;
const MESSAGE_TIMEOUT_MS = Number(process.env.ALZA_MESSAGE_TIMEOUT_MS ?? 6 * 60_000);

const DATASET = {
  yapeReceived: 'yape-imgs/WhatsApp Image 2026-11-08 at 12.39.44 PM.jpeg', // ¡Te Yapearon! S/ 2
  yapeSent: 'yape-imgs/WhatsApp Image 2026-11-08 at 12.40.24 PM.jpeg', // ¡Yapeaste! S/ 7,50
  unreadable: 'generated/C-002-heavy_blur.png',
  audio: 'audios/WhatsApp-Audio-2026-11-08-at-18.27.18.ogg', // «Tres soles de pan.»
};

mkdirSync(OUT, { recursive: true });
const report = { phone: PHONE, steps: [], retries: [], notes: [] };

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function log(message) {
  console.log(message);
}

function check(condition, message) {
  if (!condition) throw new Error(`✗ ${message}`);
  log(`  ✓ ${message}`);
  report.steps.push(message);
}

function note(message) {
  log(`  · ${message}`);
  report.notes.push(message);
}

async function json(path, init) {
  const res = await fetch(`${SIM}/api${path}`, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${JSON.stringify(body)}`);
  return body;
}

const post = (path, body) =>
  json(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function outbound() {
  const { events } = await json(`/conversation?phone=${encodeURIComponent(PHONE)}`);
  return events.filter((event) => event.direction === 'outbound');
}

const bodyOf = (event) =>
  event.content.type === 'image' ? (event.content.caption ?? '') : (event.content.body ?? '');

/** Waits for the next message(s) ALZA sends after `seen` of them, until `until` holds. */
async function waitForOutbound(seen, until, timeoutMs = MESSAGE_TIMEOUT_MS) {
  const started = Date.now();
  for (;;) {
    const all = await outbound();
    const fresh = all.slice(seen);
    if (until(fresh)) return fresh;
    if (Date.now() - started > timeoutMs) {
      throw new Error(
        `timed out waiting for ALZA; got ${JSON.stringify(fresh.map((e) => e.catalogId))}`,
      );
    }
    await sleep(1_000);
  }
}

const hasCatalog = (id) => (fresh) => fresh.some((event) => event.catalogId === id);

/** Waits until every message of this phone reached a final state (retries included). */
async function waitIdle(label, timeoutMs = MESSAGE_TIMEOUT_MS) {
  const started = Date.now();
  for (;;) {
    const ledger = await json(`/ledger?phone=${encodeURIComponent(PHONE)}`);
    const waiting = ledger.messages.filter((m) =>
      ['received', 'processing', 'error'].includes(m.status),
    );
    if (waiting.length === 0) {
      const failed = ledger.messages.filter((m) => m.status === 'failed');
      if (failed.length > 0) note(`${label}: failed messages ${JSON.stringify(failed)}`);
      return ledger;
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`${label}: still processing ${JSON.stringify(waiting)}`);
    }
    await sleep(1_500);
  }
}

/** Notes every message that needed more than one attempt (AI rate limits, RF-IN-05). */
function recordRetries(ledger) {
  for (const m of ledger.messages) {
    if (m.attempts > 1 && !report.retries.some((r) => r.waMessageId === m.waMessageId)) {
      report.retries.push({
        waMessageId: m.waMessageId,
        type: m.type,
        attempts: m.attempts,
        status: m.status,
        errorCode: m.errorCode,
      });
      note(`${m.type} needed ${m.attempts} attempts (${m.errorCode ?? 'ok in the end'})`);
    }
  }
}

let shotIndex = 0;
async function shot(target, name) {
  shotIndex += 1;
  const file = join(OUT, `e2e-${String(shotIndex).padStart(2, '0')}-${name}.png`);
  await sleep(300);
  await target.screenshot({ path: file });
  log(`  📸 ${file}`);
}

/** Lima wall-clock hour and minute right now. */
function limaClock() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Lima',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (type) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { hour: get('hour'), minute: get('minute') };
}

/** Lima business day (4:00 to 3:59, D12) of now. */
function businessDayNow() {
  const shifted = new Date(Date.now() - 4 * 3_600_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(shifted);
}

/** The answer to the doubts of a WA-10 caption, one point per numbered question. */
function answerFor(caption) {
  const parts = [];
  for (const line of caption.split('\n')) {
    const match = /^(\d)️⃣ (.*)$/.exec(line.trim());
    if (!match) continue;
    const [, n, question] = match;
    if (/no se lee bien|no se entendió|¿Por cuánto\?/.test(question))
      parts.push(`${n} son 12 soles`);
    else if (/todo el día o solo efectivo/.test(question)) parts.push(`${n} solo efectivo`);
    else if (/¿Fueron dos pagos\?/.test(question)) parts.push(`${n} sí, fueron dos`);
    else if (/te pagaron o pagaste/.test(question)) parts.push(`${n} me pagaron`);
    else if (/¿Es del /.test(question)) parts.push(`${n} sí`);
    else if (/mercadería o un gasto/.test(question)) parts.push(`${n} mercadería`);
    else if (/¿Cuál es correcto\?/.test(question)) parts.push(`${n} está bien lo anotado`);
    else if (/¿Cuadra\?/.test(question)) parts.push(`${n} sí`);
    else parts.push(`${n} no sé`);
  }
  return parts.join(', ');
}

// ---------------------------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------------------------

const health = await fetch(`${SERVER}/health`).catch(() => null);
if (!health?.ok) throw new Error(`server not reachable at ${SERVER}`);
const web = await fetch(WEB).catch(() => null);
if (!web?.ok) throw new Error(`web not reachable at ${WEB}`);

const browser = await chromium.launch();
const phoneView = { viewport: { width: 360, height: 800 }, deviceScaleFactor: 1, locale: 'es-PE' };
const errors = [];

try {
  // ---- WhatsApp (simulator) -----------------------------------------------------------------
  const simContext = await browser.newContext(phoneView);
  const sim = await simContext.newPage();
  sim.on('pageerror', (err) => errors.push(`simulator: ${err.message}`));
  await sim.goto(SIM);
  await sim.locator('#phoneInput').fill(PHONE);
  await sim.locator('#usePhone').click();
  const chat = sim.locator('.chat');
  log(`Número nuevo: ${PHONE}`);

  async function say(text) {
    await sim.locator('#textInput').fill(text);
    await sim.locator('#sendText').click();
    await sim.getByText('Webhook respondió 200').waitFor();
  }
  async function tap(title) {
    await sim.locator('.bubble.theirs .buttons button', { hasText: title }).last().click();
    await sim.getByText('Webhook respondió 200').waitFor();
  }
  async function sendDataset(path) {
    await sim.locator('#datasetSelect').selectOption(path);
    await sim.locator('#sendDataset').click();
    await sim.getByText('Webhook respondió 200').waitFor();
  }
  /** Lets the page poll the conversation once more before a screenshot. */
  async function settle() {
    await sim.locator('#phoneInput').fill(PHONE);
    await sim.locator('#usePhone').click();
    await sleep(1_200);
  }

  log('Alta (HU-01)');
  let seen = 0;
  await say('Hola');
  let fresh = await waitForOutbound(seen, hasCatalog('WA-01'));
  seen += fresh.length;
  check(fresh[0]?.content.buttons?.length === 2, 'WA-01 with «Acepto» / «No, gracias»');
  await settle();
  await shot(chat, 'welcome');

  await tap('Acepto');
  fresh = await waitForOutbound(seen, hasCatalog('WA-03'));
  seen += fresh.length;
  check(true, 'Acepto → WA-03 (business name)');

  await say(BUSINESS);
  fresh = await waitForOutbound(seen, hasCatalog('WA-04'));
  seen += fresh.length;
  check(true, 'business → WA-04 (holder)');

  await say(HOLDER);
  fresh = await waitForOutbound(seen, hasCatalog('WA-05'));
  seen += fresh.length;
  check(true, 'holder → WA-05 (close time, 3 buttons)');

  await say('cierro como a las 3 am');
  fresh = await waitForOutbound(seen, hasCatalog('WA-05'));
  seen += fresh.length;
  check(
    bodyOf(fresh[0]) === 'Puedo mandarte tu resumen hasta las 2 a. m. ¿A qué hora cierras?',
    '«3 am» → D67 variant of WA-05',
  );
  await settle();
  await shot(chat, 'onboarding-close-time');

  const { hour, minute } = limaClock();
  const early = hour >= 4 && hour * 60 + minute < 20 * 60 + 30;
  if (early) await tap('9 pm');
  else {
    note(
      `it is ${hour}:${String(minute).padStart(2, '0')} in Lima: close time «2 am» instead of 9 pm`,
    );
    await say('a las 2 am');
  }
  fresh = await waitForOutbound(seen, hasCatalog('WA-06'));
  seen += fresh.length;
  const habit = bodyOf(fresh.find((e) => e.catalogId === 'WA-06'));
  const activationUrl = /https?:\/\/\S+\/app\/activar\/\S+/.exec(habit)?.[0];
  check(
    Boolean(activationUrl),
    `WA-06 with a 1-hour activation link (${early ? '9 p. m.' : '2 a. m.'})`,
  );
  check(habit.startsWith('¡Listo, Sofia!'), 'WA-06 greets her by the holder first name');
  await settle();
  await shot(chat, 'habit');

  // ---- The day -------------------------------------------------------------------------------
  log('Día: capturas, audio y texto');
  await sendDataset(DATASET.yapeReceived);
  recordRetries(await waitIdle('yape received'));
  fresh = await waitForOutbound(seen, hasCatalog('WA-07'), 30_000).catch(() => []);
  seen += fresh.length;
  check(
    fresh.some((e) => e.catalogId === 'WA-07'),
    `first screenshot confirmed: «${bodyOf(fresh[0] ?? { content: {} })}»`,
  );
  await settle();
  await shot(chat, 'first-screenshot');

  await sendDataset(DATASET.yapeSent);
  recordRetries(await waitIdle('yape sent'));
  await sendDataset(DATASET.unreadable);
  recordRetries(await waitIdle('unreadable screenshot'));
  await sendDataset(DATASET.audio);
  recordRetries(await waitIdle('audio'));
  await say('vendí 5 soles de pan');
  let ledger = await waitIdle('text');
  recordRetries(ledger);
  const silent = (await outbound()).slice(seen);
  check(silent.length === 0, `silent while she records (D04): ${silent.length} messages`);
  await settle();
  await shot(chat, 'day-recorded');
  const ledgerPanel = sim.locator('.ledger');
  await shot(ledgerPanel, 'day-ledger');
  log(
    `  libro: ${JSON.stringify(ledger.entries.map((e) => [e.businessDay, e.amount, e.direction, e.paymentMethod, e.label, e.status]))}`,
  );
  log(
    `  dudas: ${JSON.stringify(ledger.clarifications.map((d) => [d.businessDay, d.type, d.status]))}`,
  );

  // ---- The close -------------------------------------------------------------------------------
  log('Cierre (HU-06)');
  await say('cierre');
  fresh = await waitForOutbound(seen, (f) =>
    f.some((e) => ['WA-10', 'WA-21', 'WA-22'].includes(e.catalogId)),
  );
  seen += fresh.length;
  let close = fresh.find((e) => e.catalogId === 'WA-10');
  if (!close && fresh.some((e) => e.catalogId === 'WA-22')) {
    note('the 5-minute sender sent the close before «cierre»: WA-22 points to it');
    close = (await outbound()).find((e) => e.catalogId === 'WA-10');
  }
  check(Boolean(close), `WA-10 sent as ${close?.content.type}`);
  const caption = bodyOf(close);
  log(
    caption
      .split('\n')
      .map((line) => `    | ${line}`)
      .join('\n'),
  );
  check(
    /Ver todo \(vale 7 días\): https?:\/\/\S+\/app\/entrar\/\S+/.test(caption),
    'WA-10 carries the 7-day link',
  );
  check(/¿Cuadra\?/.test(caption), 'cash question in WA-10');
  if (close.content.type === 'image') {
    const res = await fetch(`${SIM}/api/media/${encodeURIComponent(close.content.mediaId)}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    shotIndex += 1;
    const file = join(OUT, `e2e-${String(shotIndex).padStart(2, '0')}-summary-image.png`);
    writeFileSync(file, bytes);
    log(`  📸 ${file} (${Math.round(bytes.length / 1024)} KB)`);
  }
  await settle();
  await shot(chat, 'close');
  const accessUrl = /https?:\/\/\S+\/app\/entrar\/\S+/.exec(caption)?.[0];

  log('Respuesta al cierre (HU-07)');
  const answer = answerFor(caption);
  log(`  respuesta: «${answer}»`);
  await say(answer);
  fresh = await waitForOutbound(seen, (f) =>
    f.some((e) => ['WA-11', 'WA-12', 'WA-18'].includes(e.catalogId)),
  );
  seen += fresh.length;
  if (fresh.some((e) => e.catalogId === 'WA-11')) {
    note(`WA-11: «${bodyOf(fresh.find((e) => e.catalogId === 'WA-11'))}»`);
    await settle();
    await shot(chat, 'clarify');
    await say('son 12 soles y la caja sí cuadra');
    fresh = await waitForOutbound(seen, (f) =>
      f.some((e) => ['WA-11', 'WA-12'].includes(e.catalogId)),
    );
    seen += fresh.length;
  }
  ledger = await waitIdle('close reply');
  recordRetries(ledger);
  const confirmation = fresh.find((e) => e.catalogId === 'WA-12');
  check(
    Boolean(confirmation),
    `WA-12: «${bodyOf(confirmation ?? { content: {} }).replace(/\n/g, ' / ')}»`,
  );
  await settle();
  await shot(chat, 'confirmation');
  await shot(ledgerPanel, 'ledger-after-reply');
  const resolved = ledger.entries.filter(
    (e) => e.source === 'close_reply' || e.label === 'self_reported',
  );
  log(
    `  libro: ${JSON.stringify(ledger.entries.map((e) => [e.businessDay, e.amount, e.direction, e.paymentMethod, e.label, e.status, e.source]))}`,
  );
  const fromScreenshot = ledger.entries.find(
    (e) => e.source === 'close_reply' && e.amount.includes('12'),
  );
  if (fromScreenshot) {
    check(
      fromScreenshot.label === 'self_reported',
      'the unreadable screenshot answered in the close is «Lo contaste tú» (D66)',
    );
    note(
      `its method: ${fromScreenshot.paymentMethod} (D69: counts with Yape y Plin even when unknown)`,
    );
  } else note(`no close-reply entry of S/ 12 (${resolved.length} self-reported entries)`);

  // ---- Web -----------------------------------------------------------------------------------
  log('Web (HU-09)');
  const webContext = await browser.newContext(phoneView);
  const page = await webContext.newPage();
  page.on('pageerror', (err) => errors.push(`web: ${err.message}`));
  const local = (url) => WEB + new URL(url).pathname;

  if (accessUrl) {
    await page.goto(local(accessUrl));
    await page.waitForLoadState('networkidle');
    await shot(page, 'web-7-day-link-without-pin');
  }

  await page.goto(local(activationUrl));
  await page.getByRole('heading', { name: 'Crea tu PIN' }).waitFor();
  await shot(page, 'web-create-pin');
  await page.getByLabel('Tu PIN de 6 números').fill(PIN);
  await page.getByLabel('Escríbelo otra vez').fill(PIN);
  await page.getByRole('button', { name: 'Guardar mi PIN' }).click();
  await page.getByText('Esta semana').waitFor();
  await page.waitForLoadState('networkidle');
  check(true, 'PIN created → Inicio');
  await shot(page, 'web-home-before-noon');
  const pointsBefore = (await page.locator('#points-title b').textContent()) ?? '';
  log(`  puntos antes de las 12:00: ${pointsBefore}`);

  await page.getByRole('link', { name: 'Movimientos' }).click();
  await page.getByRole('heading', { name: 'Movimientos' }).waitFor();
  await page.waitForLoadState('networkidle');
  await shot(page, 'web-movements');
  const today = page.locator('main ul > li a').first();
  if (await today.count()) {
    await today.click();
    await page.waitForLoadState('networkidle');
    await sleep(500);
    await shot(page, 'web-day');
  }

  // ---- 12:00: the day becomes final (RF-PT-01) ------------------------------------------------
  log('12:00 del día siguiente (close-finalize)');
  const day = businessDayNow();
  const run = await post('/run-job', { job: 'close-finalize', phone: PHONE, businessDay: day });
  log(`  ${JSON.stringify(run)}`);
  check(
    run.summary.daysFinalized >= 1,
    `close-finalize made ${run.summary.daysFinalized} day(s) final, +${run.summary.pointsAwarded} points`,
  );
  await page.goto(`${WEB}/app`);
  await page.getByText('Esta semana').waitFor();
  await page.waitForLoadState('networkidle');
  const pointsAfter = (await page.locator('#points-title b').textContent()) ?? '';
  const streak = await page
    .locator('p', { hasText: /cerrando tu día|empezar tu racha/ })
    .first()
    .textContent();
  check(
    Number(pointsAfter.replace(/\D/g, '')) > Number(pointsBefore.replace(/\D/g, '')),
    `points ${pointsBefore} → ${pointsAfter}`,
  );
  log(`  racha: ${streak}`);
  await shot(page, 'web-home-after-noon');

  check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
} finally {
  await browser.close();
  writeFileSync(join(OUT, 'e2e-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  log(`Informe: ${join(OUT, 'e2e-report.json')}`);
}
