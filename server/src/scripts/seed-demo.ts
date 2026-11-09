/**
 * CLI: `npm run seed:demo -w server` (development only). Resets «Marta · Bodega Sol» with five
 * weeks of demo data and prints a 1-hour activation link and a 7-day link for the local web.
 * The links carry tokens: they are printed for the developer, never logged.
 */
import { getConfig } from '../config.js';
import { createDb, createPool } from '../db/client.js';
import { loadDotEnv } from '../paths.js';
import { seedDemo } from './demo-data.js';

loadDotEnv();
const config = getConfig();
if (config.nodeEnv === 'production') {
  console.error('seed:demo resets data and only runs outside production');
  process.exit(1);
}

const pool = createPool(config.databaseUrl, { max: 2, applicationName: 'alza-seed-demo' });
try {
  const result = await seedDemo(createDb(pool), { now: new Date(), baseUrl: config.appBaseUrl });
  console.log(`Demo lista: Marta · Bodega Sol (desde el ${result.firstDay})`);
  console.log(`  registros: ${result.entries} · pendientes: ${result.pending}`);
  console.log(`  puntos: ${result.balance} · racha: ${result.streakDays} días`);
  console.log('');
  console.log(`Crear PIN (vale 1 hora):  ${result.activationUrl}`);
  console.log(`Entrar (vale 7 días):     ${result.accessUrl}`);
} catch (err) {
  console.error('seed:demo failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
