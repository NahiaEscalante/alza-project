/**
 * CLI: creates a panel account for one team member, or resets its password (RF-AD-04, 14.4).
 *
 *   npm run create-admin -w server -- <username> [--name "Nombre visible"]
 *
 * The password is never an argument (it would stay in the shell history) and is never printed:
 * - `ADMIN_PASSWORD` in the environment, if set;
 * - otherwise the first line of stdin when it is piped (`... < file`, `printf … |`);
 * - otherwise it is asked twice on the terminal, hidden.
 * At least 12 characters. Only needs DATABASE_URL. After `npm run build`:
 * `npm run create-admin:dist -w server -- <username>`.
 */
import { stdin, stdout } from 'node:process';
import {
  checkPassword,
  checkUsername,
  MIN_PASSWORD_LENGTH,
  normalizeUsername,
  upsertAdminUser,
} from '../admin/accounts.js';
import { createScryptPinHasher } from '../auth/pin-hash.js';
import { createDb, createPool } from '../db/client.js';
import { loadDotEnv } from '../paths.js';

const USAGE = 'Uso: npm run create-admin -w server -- <usuario> [--name "Nombre visible"]';

function parseArgs(argv: string[]): { username: string; name?: string } | null {
  let username: string | undefined;
  let name: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--name') name = argv[++i];
    else if (arg.startsWith('--name=')) name = arg.slice('--name='.length);
    else if (!arg.startsWith('--') && username === undefined) username = arg;
    else return null;
  }
  return username ? { username, name } : null;
}

async function readPipedLine(): Promise<string> {
  let data = '';
  for await (const chunk of stdin) {
    data += String(chunk);
    if (data.includes('\n')) break;
  }
  return data.split(/\r?\n/)[0] ?? '';
}

/** Reads a line from the terminal without echoing it. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let value = '';
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    const done = (error?: Error) => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return done();
        if (ch === '\u0003') return done(new Error('cancelado'));
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function readPassword(): Promise<string> {
  const fromEnv = process.env.ADMIN_PASSWORD;
  if (fromEnv) return fromEnv;
  if (!stdin.isTTY) return readPipedLine();
  const first = await promptHidden(`Contraseña (mínimo ${MIN_PASSWORD_LENGTH} caracteres): `);
  const second = await promptHidden('Repite la contraseña: ');
  if (first !== second) throw new Error('Las contraseñas no coinciden.');
  return first;
}

const PROBLEMS: Record<string, string> = {
  invalid_username:
    'Usuario inválido: de 3 a 64 caracteres, letras, números y . _ @ + - (sin espacios).',
  password_too_short: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
  password_too_long: 'La contraseña es demasiado larga.',
};

loadDotEnv();
const args = parseArgs(process.argv.slice(2));
if (!args) {
  console.error(USAGE);
  process.exit(1);
}
const username = normalizeUsername(args.username);
const usernameProblem = checkUsername(username);
if (usernameProblem) {
  console.error(PROBLEMS[usernameProblem]);
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

let password: string;
try {
  password = await readPassword();
} catch (err) {
  console.error(err instanceof Error ? err.message : 'No se pudo leer la contraseña.');
  process.exit(1);
}
const passwordProblem = checkPassword(password);
if (passwordProblem) {
  console.error(PROBLEMS[passwordProblem]);
  process.exit(1);
}

const pool = createPool(url, { max: 1, applicationName: 'alza-create-admin' });
try {
  const result = await upsertAdminUser(
    createDb(pool),
    { username, password, name: args.name },
    createScryptPinHasher(),
  );
  console.log(
    result.created
      ? `Cuenta del panel creada: ${username}`
      : `Contraseña actualizada (y cuenta activa): ${username}`,
  );
  console.log('Entra en /panel con ese usuario.');
} catch (err) {
  // Only the error type and SQL state: a query error message would quote the hash.
  const e = err as { name?: unknown; code?: unknown; cause?: { code?: unknown } };
  const code = e?.code ?? e?.cause?.code;
  console.error(
    'create-admin failed:',
    String(e?.name ?? 'Error'),
    code ? `(${String(code)})` : '',
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
