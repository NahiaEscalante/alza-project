import { describe, expect, it } from 'vitest';
import { ConfigError, collectGeminiKeys, loadConfig } from './config.js';

const KEY = Buffer.alloc(32, 7).toString('base64');
const BASE = {
  DATABASE_URL: 'postgres://u:p@localhost:5433/alza',
  ENCRYPTION_KEY: KEY,
};

function configError(env: Record<string, string | undefined>): ConfigError {
  try {
    loadConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) return err;
    throw err;
  }
  throw new Error('expected ConfigError');
}

describe('loadConfig', () => {
  it('boots with only the database URL and encryption key (no AI keys)', () => {
    const config = loadConfig(BASE);
    expect(config).toMatchObject({
      nodeEnv: 'development',
      port: 3000,
      logLevel: 'info',
      appBaseUrl: 'http://localhost:5173',
      databaseUrl: BASE.DATABASE_URL,
      geminiApiKeys: [],
      groqApiKey: undefined,
      whatsapp: null,
      simulatorEnabled: true,
    });
    expect(config.encryptionKey).toHaveLength(32);
  });

  it('parses explicit values', () => {
    const config = loadConfig({
      ...BASE,
      NODE_ENV: 'production',
      PORT: '8080',
      LOG_LEVEL: 'warn',
      APP_BASE_URL: 'https://alza.example/',
      GROQ_API_KEY: 'groq',
      SIMULATOR_ENABLED: '1',
    });
    expect(config).toMatchObject({
      nodeEnv: 'production',
      port: 8080,
      logLevel: 'warn',
      appBaseUrl: 'https://alza.example',
      groqApiKey: 'groq',
      simulatorEnabled: true,
    });
  });

  it('turns the simulator off by default in production and logs silently in tests', () => {
    expect(loadConfig({ ...BASE, NODE_ENV: 'production' }).simulatorEnabled).toBe(false);
    expect(loadConfig({ ...BASE, NODE_ENV: 'test' }).logLevel).toBe('silent');
  });

  it('treats empty strings as unset', () => {
    const config = loadConfig({ ...BASE, GROQ_API_KEY: '', PORT: '', WHATSAPP_APP_SECRET: ' ' });
    expect(config.groqApiKey).toBeUndefined();
    expect(config.port).toBe(3000);
    expect(config.whatsapp).toBeNull();
  });

  it('lists missing or invalid variable names without their values', () => {
    const err = configError({ ENCRYPTION_KEY: 'c2hvcnQ=', PORT: 'abc' });
    expect(err.variables.sort()).toEqual(['DATABASE_URL', 'ENCRYPTION_KEY', 'PORT']);
    expect(err.message).not.toContain('c2hvcnQ=');
  });

  it('requires a 32-byte base64 encryption key', () => {
    expect(
      configError({ ...BASE, ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }).variables,
    ).toEqual(['ENCRYPTION_KEY']);
    expect(configError({ ...BASE, ENCRYPTION_KEY: 'not base64!' }).variables).toEqual([
      'ENCRYPTION_KEY',
    ]);
  });

  it('rejects a database URL that is not postgres', () => {
    expect(configError({ ...BASE, DATABASE_URL: 'mysql://x' }).variables).toEqual(['DATABASE_URL']);
  });

  it('rejects malformed Meta API versions and phone number ids without exposing values', () => {
    expect(configError({ ...BASE, WHATSAPP_API_VERSION: 'invalid-version' }).variables).toContain(
      'WHATSAPP_API_VERSION',
    );
    expect(configError({ ...BASE, WHATSAPP_PHONE_NUMBER_ID: '../private' }).variables).toContain(
      'WHATSAPP_PHONE_NUMBER_ID',
    );
  });

  it('requires sandbox credentials only when 360dialog is explicitly selected', () => {
    expect(loadConfig({ ...BASE, DIALOG360_API_KEY: 'key' }).dialog360).toBeNull();
    expect(configError({ ...BASE, WHATSAPP_PROVIDER: 'dialog360' }).variables).toEqual([
      'DIALOG360_API_KEY',
      'DIALOG360_WEBHOOK_TOKEN',
    ]);
    const config = loadConfig({
      ...BASE,
      WHATSAPP_PROVIDER: 'dialog360',
      DIALOG360_API_KEY: 'key',
      DIALOG360_WEBHOOK_TOKEN: 'x'.repeat(64),
      WHATSAPP_ACCESS_TOKEN: 'old-partial-meta',
    });
    expect(config.dialog360?.apiKey).toBe('key');
    expect(config.whatsappProvider).toBe('dialog360');
  });

  it('needs all four WhatsApp variables or none', () => {
    const err = configError({ ...BASE, WHATSAPP_ACCESS_TOKEN: 't', WHATSAPP_APP_SECRET: 's' });
    expect(err.variables).toEqual(['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_VERIFY_TOKEN']);

    const config = loadConfig({
      ...BASE,
      WHATSAPP_ACCESS_TOKEN: 't',
      WHATSAPP_PHONE_NUMBER_ID: '123',
      WHATSAPP_APP_SECRET: 's',
      WHATSAPP_VERIFY_TOKEN: 'v',
    });
    expect(config.whatsapp).toEqual({
      apiVersion: 'v25.0',
      accessToken: 't',
      phoneNumberId: '123',
      appSecret: 's',
      verifyToken: 'v',
    });
  });
});

describe('collectGeminiKeys', () => {
  it('collects GEMINI_API_KEY and GEMINI_API_KEY_1..N in numeric order, deduplicated', () => {
    const keys = collectGeminiKeys({
      GEMINI_API_KEY_10: 'k10',
      GEMINI_API_KEY_2: 'k2',
      GEMINI_API_KEY_1: 'k1',
      GEMINI_API_KEY: 'k0',
      GEMINI_API_KEY_3: 'k1',
      GEMINI_KEY_NAME_1: 'not a key',
      GEMINI_PROJECT_ID_1: 'not a key',
    });
    expect(keys).toEqual(['k0', 'k1', 'k2', 'k10']);
  });

  it('is exposed on the config', () => {
    const config = loadConfig({ ...BASE, GEMINI_API_KEY_1: 'a', GEMINI_API_KEY_2: 'b' });
    expect(config.geminiApiKeys).toEqual(['a', 'b']);
  });
});
