import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger, serializeError } from './logger.js';

function capture() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  const logger = createLogger({ level: 'info', destination });
  return { logger, output: () => lines.join('') };
}

describe('logger redaction (RNF-09)', () => {
  it('hides message content, amounts, names, phones, tokens and PINs at any depth', () => {
    const { logger, output } = capture();
    logger.info(
      {
        userId: 'user-1',
        waMessageId: 'wamid.1',
        text: 'vendí 3.50 de pan',
        from: '51999888777',
        pin: '482913',
        entry: { amountCents: 1250, counterparty: 'Ana Torres', name: 'Marta' },
        operations: [{ amount: '12.50', counterparty: 'Ana T.' }],
        req: { headers: { authorization: 'Bearer abc', cookie: 'sid=xyz' } },
        link: { token: 'secret-token' },
      },
      'processed',
    );
    const out = output();
    for (const leaked of [
      'vendí',
      '51999888777',
      '482913',
      '1250',
      'Ana Torres',
      'Marta',
      '12.50',
      'Ana T.',
      'Bearer abc',
      'sid=xyz',
      'secret-token',
    ]) {
      expect(out).not.toContain(leaked);
    }
    expect(out).toContain('user-1');
    expect(out).toContain('wamid.1');
    expect(out).toContain('[redacted]');
  });

  it('hides the Meta signature header', () => {
    const { logger, output } = capture();
    logger.info({ req: { headers: { 'x-hub-signature-256': 'sha256=deadbeef' } } }, 'webhook');
    expect(output()).not.toContain('deadbeef');
  });
});

describe('serializeError', () => {
  it('drops pg error detail (row values) and keeps the constraint', () => {
    const err = Object.assign(new Error('duplicate key value violates unique constraint "x"'), {
      code: '23505',
      constraint: 'users_phone_e164_unique',
      detail: 'Key (phone_e164)=(+51999888777) already exists.',
    });
    const out = serializeError(err);
    expect(JSON.stringify(out)).not.toContain('51999888777');
    expect(out).toMatchObject({ code: '23505', constraint: 'users_phone_e164_unique' });
  });

  it('hides drizzle query params (amounts, names), also when nested as cause', () => {
    class DrizzleQueryError extends Error {
      query = 'insert into "ledger_entries" ("amount_cents", "counterparty") values ($1, $2)';
      params = [1250, 'Ana Torres'];
      constructor() {
        super('Failed query: insert ...\nparams: 1250,Ana Torres');
        this.name = 'DrizzleQueryError';
      }
    }
    const wrapped = new Error('could not record', { cause: new DrizzleQueryError() });
    const text = JSON.stringify(serializeError(wrapped));
    expect(text).not.toContain('Ana Torres');
    expect(text).not.toContain('1250');
    expect(text).toContain('ledger_entries');
  });

  it('hides SyntaxError messages, which quote the parsed input', () => {
    let error: unknown;
    try {
      JSON.parse('hola Marta, vendí 20');
    } catch (err) {
      error = err;
    }
    const text = JSON.stringify(serializeError(error));
    expect(text).not.toContain('Marta');
    expect(text).toContain('SyntaxError');
  });

  it('is used for `err` in log lines', () => {
    const { logger, output } = capture();
    logger.error({ err: Object.assign(new Error('boom'), { detail: 'Key (pin)=(123456)' }) }, 'x');
    expect(output()).toContain('boom');
    expect(output()).not.toContain('123456');
  });
});
