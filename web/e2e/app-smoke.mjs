/**
 * Smoke walk of the user's web (Fase 7) against the dev servers, with 360×800 screenshots.
 *
 *   npm run dev                       # in another terminal (server + web)
 *   node web/e2e/app-smoke.mjs [screenshots-dir]
 *
 * It RESETS the demo user (runs `npm run seed:demo -w server`) to get fresh links, then walks:
 * activation → create PIN → Inicio → Movimientos → a day → correct an entry (PIN sheet) →
 * «personal» rule offer → Pendientes → Premios (redeem) → Ajustes (hide amounts) → access link on a
 * new phone (wrong PIN, then right) → dead links and no session.
 *
 * To show the PIN sheet it ages the 10-minute PIN window in the local Docker database (dev-only
 * credentials from docker-compose.yml). Not part of `npm test`.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(root, 'package.json'));
const { chromium } = require('playwright');

const BASE = process.env.ALZA_WEB_URL ?? 'http://localhost:5173';
const OUT = resolve(process.argv[2] ?? join(root, 'web/e2e/screenshots'));
const PIN = '284719';
const DEMO_PHONE = '+51999000111';
mkdirSync(OUT, { recursive: true });

function seed() {
  const output = execFileSync('npm', ['run', 'seed:demo', '-w', 'server'], {
    cwd: root,
    encoding: 'utf8',
  });
  const activation = output.match(/https?:\/\/\S+\/app\/activar\/\S+/)?.[0];
  const access = output.match(/https?:\/\/\S+\/app\/entrar\/\S+/)?.[0];
  if (!activation || !access) throw new Error(`seed:demo printed no links:\n${output}`);
  const path = (url) => new URL(url).pathname;
  return { activation: path(activation), access: path(access) };
}

/** Dev-only: makes the PIN typed on her phones older than 10 minutes. */
function agePin() {
  execFileSync(
    'docker',
    [
      'exec',
      'alza-postgres',
      'psql',
      '-U',
      'alza',
      '-d',
      'alza',
      '-qc',
      `update trusted_devices set pin_verified_at = now() - interval '11 minutes'
       where user_id = (select id from users where phone_e164 = '${DEMO_PHONE}')`,
    ],
    { stdio: 'inherit' },
  );
}

let step = 0;
async function shot(page, name, { full = false } = {}) {
  step += 1;
  const file = join(OUT, `app-${String(step).padStart(2, '0')}-${name}.png`);
  await page.waitForTimeout(250); // let the sheet animation settle
  await page.screenshot({ path: file, fullPage: full });
  console.log(`  📸 ${file}`);
}

function check(condition, message) {
  if (!condition) throw new Error(`✗ ${message}`);
  console.log(`  ✓ ${message}`);
}

const links = seed();
console.log('Demo reseeded.');

const browser = await chromium.launch();
const phone = { viewport: { width: 360, height: 800 }, deviceScaleFactor: 1, locale: 'es-PE' };
const context = await browser.newContext(phone);
const page = await context.newPage();
const errors = [];
page.on('pageerror', (err) => errors.push(err.message));

try {
  // ---- Activation and PIN (HU-09) ---------------------------------------------------------
  console.log('Activación');
  await page.goto(BASE + links.activation);
  await page.getByRole('heading', { name: 'Crea tu PIN' }).waitFor();
  check(!page.url().includes(links.activation.split('/').at(-1)), 'token removed from the URL');
  await shot(page, 'activate');

  await page.getByLabel('Tu PIN de 6 números').fill('123456');
  await page.getByLabel('Escríbelo otra vez').fill('123456');
  await page.getByRole('button', { name: 'Guardar mi PIN' }).click();
  await page.getByText('muy fácil de adivinar').waitFor();
  check(true, '123456 rejected with the 12.2 message');
  await shot(page, 'activate-easy-pin');

  await page.getByLabel('Tu PIN de 6 números').fill(PIN);
  await page.getByLabel('Escríbelo otra vez').fill(PIN);
  await page.getByRole('button', { name: 'Guardar mi PIN' }).click();

  // ---- Inicio (RF-WP-01) ------------------------------------------------------------------
  console.log('Inicio');
  await page.getByText('Lo que entró cada día').waitFor();
  await page.getByText(/Hola, Marta/).waitFor();
  await shot(page, 'home');
  await shot(page, 'home-full', { full: true });
  check(await page.getByText(/cosas? por revisar/).isVisible(), 'pending notice on Inicio');

  // ---- Movimientos (RF-WP-02) -------------------------------------------------------------
  console.log('Movimientos');
  await page.getByRole('link', { name: 'Movimientos' }).click();
  await page.getByRole('heading', { name: 'Movimientos' }).waitFor();
  await page
    .getByText(/Cierre completo/)
    .first()
    .waitFor();
  await shot(page, 'movements');
  await page.getByRole('button', { name: 'Semana anterior' }).click();
  await page
    .getByText(/Semana del/)
    .first()
    .waitFor();
  await page.waitForTimeout(400);
  await shot(page, 'movements-previous-week');
  await page.getByRole('button', { name: 'Semana siguiente' }).click();

  // A past day with a close and «Caja sin revisar» if there is one.
  const rows = page.locator('main ul > li a');
  await rows.first().waitFor();
  const unreviewed = rows.filter({ hasText: 'Caja sin revisar' });
  const day = (await unreviewed.count()) > 0 ? unreviewed.first() : rows.nth(1);
  await day.click();
  await page
    .getByText(/registros?$/)
    .first()
    .waitFor();
  await shot(page, 'day');
  await shot(page, 'day-full', { full: true });
  check(
    await page.getByRole('link', { name: 'Agregar algo que faltó' }).isVisible(),
    'add on a past day',
  );

  // ---- Correct an entry with the PIN sheet (HU-11) ----------------------------------------
  console.log('Corregir monto');
  const screenshotEntry = page.locator('main ul > li a').filter({ hasText: 'Con captura' }).first();
  await screenshotEntry.click();
  await page.getByRole('button', { name: 'Corregir monto' }).waitFor();
  await shot(page, 'entry');

  agePin();
  await page.getByRole('button', { name: 'Corregir monto' }).click();
  const amount = page.getByLabel('Monto correcto');
  await amount.fill('120');
  await shot(page, 'entry-correct-sheet');
  await page.getByRole('button', { name: 'Guardar cambio' }).click();
  await page.getByRole('heading', { name: 'Escribe tu PIN' }).waitFor();
  await shot(page, 'pin-sheet');
  await page.getByLabel('Tu PIN de 6 números').fill(PIN);
  await page.getByText('Listo, corregiste el monto').waitFor();
  await page.getByText('Lo cambiaste').waitFor();
  check(await page.getByText('Monto:').first().isVisible(), 'history shows before → after');
  await shot(page, 'entry-corrected', { full: true });

  // ---- «Personal» rule offer (RF-WP-08): 3 marks on the same incoming counterparty ---------
  console.log('Regla de pagos personales');
  const offerCounterparty = await page.evaluate(async () => {
    const days = await (await fetch('/api/days')).json();
    const byName = new Map();
    for (const d of days.days) {
      if (d.isToday || !d.hasActivity) continue;
      const { entries } = await (await fetch(`/api/days/${d.businessDay}/entries`)).json();
      for (const e of entries) {
        if (e.direction !== 'in' || e.category !== 'sale' || !e.counterparty || e.isPending)
          continue;
        byName.set(e.counterparty, [...(byName.get(e.counterparty) ?? []), e]);
      }
    }
    const [name, list] = [...byName].find(([, l]) => l.length >= 3) ?? [];
    if (!name) return null;
    for (const e of list.slice(0, 2)) {
      await fetch(`/api/entries/${e.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ category: 'personal' }),
      });
    }
    return { name, day: list[2].businessDay, id: list[2].id };
  });
  check(offerCounterparty !== null, 'found a counterparty with 3 incoming payments');
  await page.goto(`${BASE}/app/movimientos/${offerCounterparty.day}/${offerCounterparty.id}`);
  await page.getByRole('button', { name: 'Cambiar tipo' }).click();
  await page.getByLabel(/Personal \(no cuenta\)/).check();
  await shot(page, 'entry-change-type-sheet');
  await page.getByRole('button', { name: 'Guardar cambio' }).click();
  await page.getByText(/no cuenten como venta\?/).waitFor();
  await shot(page, 'personal-rule-offer');
  await page.getByRole('button', { name: 'Sí, que no cuenten como venta' }).click();
  await page.getByText(/Desde ahora, los pagos de/).waitFor();
  check(true, 'rule accepted');

  // ---- Pendientes (RF-WP-04) ---------------------------------------------------------------
  console.log('Pendientes');
  await page.getByRole('link', { name: 'Inicio' }).click();
  await page.getByRole('link', { name: /por revisar/ }).click();
  await page.getByRole('heading', { name: 'Pendientes' }).waitFor();
  await page
    .getByText(/¿Fueron dos pagos\?|¿Fue mercadería o un gasto\?|que no me mandaste/)
    .first()
    .waitFor();
  await shot(page, 'pending');
  await shot(page, 'pending-full', { full: true });
  const before = await page.locator('main ul > li').count();
  await page.getByRole('button', { name: 'Sí, fueron dos' }).click();
  await page.getByText('Listo, resuelto.').waitFor();
  check(
    (await page.locator('main ul > li').count()) === before - 1,
    'one doubt resolved with a tap',
  );
  await shot(page, 'pending-resolved');

  // ---- Premios (RF-WP-05, HU-12) -----------------------------------------------------------
  console.log('Premios');
  await page.getByRole('link', { name: 'Premios' }).click();
  await page.getByText('Premios de ejemplo para la demo.').waitFor();
  await shot(page, 'rewards');
  await shot(page, 'rewards-full', { full: true });
  const balanceBefore = Number(
    (
      ((await page.locator('main p.text-\\[40px\\]').textContent()) ?? '').match(/[\d ]+/)?.[0] ??
      '0'
    ).replace(/\s/g, ''),
  );
  await page
    .getByRole('button', { name: /^Canjear · 100 puntos/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Canjear con mi PIN' }).waitFor();
  await shot(page, 'redeem-confirm');
  await page.getByRole('button', { name: 'Canjear con mi PIN' }).click();
  const code =
    (await page
      .getByText(/^DEMO-[A-Z0-9]{4}$/)
      .first()
      .textContent()) ?? '';
  check(/^DEMO-/.test(code), `code ${code} on screen`);
  await shot(page, 'redeem-code');
  await page.getByRole('button', { name: 'Entendido' }).click();
  await page.waitForTimeout(500);
  const balanceAfter = Number(
    (
      ((await page.locator('main p.text-\\[40px\\]').textContent()) ?? '').match(/[\d ]+/)?.[0] ??
      '0'
    ).replace(/\s/g, ''),
  );
  check(balanceAfter === balanceBefore - 100, `balance ${balanceBefore} → ${balanceAfter}`);

  // ---- Chat placeholder ----------------------------------------------------------------------
  await page.getByRole('link', { name: 'Chat' }).click();
  await page.getByText('Muy pronto').waitFor();
  await shot(page, 'chat');

  // ---- Ajustes (RF-WP-09/10/11) --------------------------------------------------------------
  console.log('Ajustes');
  await page.getByRole('link', { name: 'Ajustes' }).click();
  await page.getByRole('heading', { name: 'Ajustes' }).waitFor();
  await shot(page, 'settings');
  await shot(page, 'settings-full', { full: true });
  await page
    .getByRole('button', { name: 'Que WhatsApp no guarde las imágenes en tu galería' })
    .click();
  await page
    .getByText('Verifica en tu versión', { exact: false })
    .waitFor()
    .catch(() => {});
  await shot(page, 'settings-gallery-help');
  await page.getByRole('button', { name: 'Entendido' }).click();
  await page.getByRole('switch', { name: 'Ocultar montos' }).click();
  check(
    (await page.getByRole('switch', { name: 'Ocultar montos' }).getAttribute('aria-checked')) ===
      'true',
    'amounts hidden',
  );
  await page.getByRole('link', { name: 'Volver' }).click();
  await page.getByText('Lo que entró cada día').waitFor();
  check((await page.getByText('S/ ••••').count()) > 0, 'Inicio shows S/ ••••');
  await shot(page, 'home-hidden-amounts');
  await page.reload();
  await page.getByText('Lo que entró cada día').waitFor();
  check((await page.getByText('S/ ••••').count()) > 0, 'remembered on this phone after reload');
  await page.getByRole('button', { name: 'Mostrar montos' }).click();

  // ---- Another phone with the 7-day link (HU-10) ----------------------------------------------
  console.log('Entrar desde otro celular');
  const other = await browser.newContext(phone);
  const page2 = await other.newPage();
  await page2.goto(BASE + links.access);
  await page2.getByRole('heading', { name: 'Escribe tu PIN' }).waitFor();
  await shot(page2, 'login-pin');
  await page2.getByLabel('Tu PIN de 6 números').fill('111111');
  await page2.getByText(/PIN incorrecto\. Te quedan? \d/).waitFor();
  await shot(page2, 'login-wrong-pin');
  await page2.getByLabel('Tu PIN de 6 números').fill(PIN);
  await page2.getByText('Lo que entró cada día').waitFor();
  check(true, 'new phone in after the PIN');

  // Same phone, same link again: remembered → straight to Inicio.
  await page2.goto(BASE + links.access);
  await page2.getByText('Lo que entró cada día').waitFor();
  check(true, 'remembered phone enters without PIN');
  await other.close();

  // ---- Dead ends -------------------------------------------------------------------------------
  console.log('Enlaces vencidos y sin sesión');
  const fresh = await browser.newContext(phone);
  const page3 = await fresh.newPage();
  await page3.goto(BASE + links.activation);
  await page3.getByText('Este enlace ya se usó').waitFor();
  await shot(page3, 'activation-link-used');
  await page3.goto(`${BASE}/app`);
  await page3.getByRole('heading', { name: 'Entra con tu enlace' }).waitFor();
  await shot(page3, 'no-session');
  await fresh.close();

  // ---- Lockout after 5 wrong PINs (HU-10, 14.3) ------------------------------------------------
  console.log('Bloqueo');
  const thief = await browser.newContext(phone);
  const page4 = await thief.newPage();
  await page4.goto(BASE + links.access);
  await page4.getByRole('heading', { name: 'Escribe tu PIN' }).waitFor();
  for (let i = 0; i < 5; i++) {
    await page4.getByLabel('Tu PIN de 6 números').fill('111111');
    await page4.getByText(/PIN incorrecto|espera 15 minutos/).waitFor();
  }
  await page4.getByText(/Puedes volver a intentar a las/).waitFor();
  check(
    await page4.getByLabel('Tu PIN de 6 números').isDisabled(),
    'locked for 15 minutes, with the time',
  );
  await shot(page4, 'login-locked');
  await thief.close();

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  console.log('\nSmoke OK');
} catch (err) {
  await page.screenshot({ path: join(OUT, 'app-failure.png'), fullPage: true }).catch(() => {});
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
