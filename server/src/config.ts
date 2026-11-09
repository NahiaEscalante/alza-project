import { z } from 'zod';

/**
 * Environment configuration, validated once at boot.
 *
 * - `loadConfig(env)` is pure: tests pass a plain object.
 * - `getConfig()` reads `process.env` (call `loadDotEnv()` first in local development).
 * - AI keys and WhatsApp credentials are optional so the app and the tests boot without them.
 * - Error messages list variable names only, never values (secrets stay out of logs).
 */

export const NODE_ENVS = ['development', 'test', 'production'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const ENCRYPTION_KEY_BYTES = 32;
const DEFAULT_META_API_VERSION = 'v25.0';

const postgresUrl = z
  .string()
  .regex(/^postgres(ql)?:\/\/.+/, 'must be a postgres:// connection string');

const booleanFlag = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const encryptionKey = z.string().transform((value, ctx) => {
  const key = Buffer.from(value, 'base64');
  if (key.length !== ENCRYPTION_KEY_BYTES || key.toString('base64') !== value) {
    ctx.addIssue({
      code: 'custom',
      message: `must be ${ENCRYPTION_KEY_BYTES} random bytes in base64 (openssl rand -base64 32)`,
    });
    return z.NEVER;
  }
  return key;
});

const envSchema = z.object({
  NODE_ENV: z.enum(NODE_ENVS).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z.enum(LOG_LEVELS).optional(),
  APP_BASE_URL: z.url().default('http://localhost:5173'),
  DATABASE_URL: postgresUrl,
  DATABASE_URL_TEST: postgresUrl.optional(),
  ENCRYPTION_KEY: encryptionKey,
  GROQ_API_KEY: z.string().optional(),
  WHATSAPP_API_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/)
    .default(DEFAULT_META_API_VERSION),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().regex(/^\d+$/).optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  SIMULATOR_ENABLED: booleanFlag.optional(),
  WHATSAPP_PROVIDER: z.enum(['meta', 'dialog360']).default('meta'),
  DIALOG360_API_KEY: z.string().optional(),
  DIALOG360_WEBHOOK_TOKEN: z.string().min(32).optional(),
});

export interface WhatsAppConfig {
  apiVersion: string;
  accessToken: string;
  phoneNumberId: string;
  appSecret: string;
  verifyToken: string;
}

export interface Config {
  nodeEnv: NodeEnv;
  port: number;
  logLevel: LogLevel;
  appBaseUrl: string;
  databaseUrl: string;
  databaseUrlTest: string | undefined;
  /** 32-byte key for AES-256-GCM (blob storage). */
  encryptionKey: Buffer;
  /** Every Gemini key found (GEMINI_API_KEY, then GEMINI_API_KEY_1..N), in order, deduplicated. */
  geminiApiKeys: string[];
  groqApiKey: string | undefined;
  /** Meta WhatsApp Cloud API credentials; null until all four are set (Fase 10). */
  whatsapp: WhatsAppConfig | null;
  whatsappProvider: 'meta' | 'dialog360';
  dialog360: { apiKey: string; webhookToken: string } | null;
  /** Simulated WhatsApp channel (`/dev/simulador`). Defaults to on outside production. */
  simulatorEnabled: boolean;
}

export type Env = Record<string, string | undefined>;

export class ConfigError extends Error {
  readonly variables: string[];

  constructor(variables: string[]) {
    super(`Invalid or missing environment variables: ${variables.join(', ')}`);
    this.name = 'ConfigError';
    this.variables = variables;
  }
}

/** Empty strings (e.g. `KEY=` copied from .env.example) count as unset. */
function withoutEmpty(env: Env): Env {
  return Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined && value.trim() !== ''),
  );
}

export function collectGeminiKeys(env: Env): string[] {
  const numbered = Object.keys(env)
    .map((name) => /^GEMINI_API_KEY_(\d+)$/.exec(name))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ name: match[0], index: Number(match[1]) }))
    .sort((a, b) => a.index - b.index)
    .map(({ name }) => env[name]);
  const keys = [env.GEMINI_API_KEY, ...numbered]
    .map((key) => key?.trim())
    .filter((key): key is string => Boolean(key));
  return [...new Set(keys)];
}

const WHATSAPP_VARS = [
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_APP_SECRET',
  'WHATSAPP_VERIFY_TOKEN',
] as const;

export function loadConfig(rawEnv: Env): Config {
  const env = withoutEmpty(rawEnv);
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const variables = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
    throw new ConfigError(variables);
  }
  const e = parsed.data;

  const whatsappSet = WHATSAPP_VARS.filter((name) => e[name] !== undefined);
  if (
    e.WHATSAPP_PROVIDER === 'meta' &&
    whatsappSet.length > 0 &&
    whatsappSet.length < WHATSAPP_VARS.length
  ) {
    throw new ConfigError(WHATSAPP_VARS.filter((name) => e[name] === undefined));
  }

  if (e.WHATSAPP_PROVIDER === 'dialog360') {
    const missing = (['DIALOG360_API_KEY', 'DIALOG360_WEBHOOK_TOKEN'] as const).filter(
      (name) => !e[name],
    );
    if (missing.length) throw new ConfigError(missing);
  }

  return {
    whatsappProvider: e.WHATSAPP_PROVIDER,
    dialog360:
      e.DIALOG360_API_KEY && e.DIALOG360_WEBHOOK_TOKEN
        ? { apiKey: e.DIALOG360_API_KEY, webhookToken: e.DIALOG360_WEBHOOK_TOKEN }
        : null,
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    logLevel: e.LOG_LEVEL ?? (e.NODE_ENV === 'test' ? 'silent' : 'info'),
    appBaseUrl: e.APP_BASE_URL.replace(/\/+$/, ''),
    databaseUrl: e.DATABASE_URL,
    databaseUrlTest: e.DATABASE_URL_TEST,
    encryptionKey: e.ENCRYPTION_KEY,
    geminiApiKeys: collectGeminiKeys(env),
    groqApiKey: e.GROQ_API_KEY,
    whatsapp:
      whatsappSet.length === WHATSAPP_VARS.length
        ? {
            apiVersion: e.WHATSAPP_API_VERSION,
            accessToken: e.WHATSAPP_ACCESS_TOKEN as string,
            phoneNumberId: e.WHATSAPP_PHONE_NUMBER_ID as string,
            appSecret: e.WHATSAPP_APP_SECRET as string,
            verifyToken: e.WHATSAPP_VERIFY_TOKEN as string,
          }
        : null,
    simulatorEnabled: e.SIMULATOR_ENABLED ?? e.NODE_ENV !== 'production',
  };
}

let cached: Config | undefined;

export function getConfig(): Config {
  cached ??= loadConfig(process.env);
  return cached;
}
