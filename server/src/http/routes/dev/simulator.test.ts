import { afterAll, describe, expect, it } from 'vitest';
import { createTestDb, hasTestDb } from '../../../../test/db.js';
import {
  cashSale,
  createHarness,
  randomPhone,
  receiptExtraction,
} from '../../../pipeline/test-support.js';
import { simulatorPhone } from './simulator.js';

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

describe('simulatorPhone', () => {
  it('accepts Peruvian mobiles and E.164', () => {
    expect(simulatorPhone('987 654 321')).toBe('+51987654321');
    expect(simulatorPhone('51987654321')).toBe('+51987654321');
    expect(simulatorPhone('+5491112345678')).toBe('+5491112345678');
    expect(simulatorPhone('123')).toBeNull();
  });
});

describe.skipIf(!hasTestDb)('/dev/simulador', () => {
  const { pool, db } = createTestDb();
  afterAll(() => pool.end());

  it('serves the self-contained page', async () => {
    const h = createHarness(db);
    const res = await h.app.request('/dev/simulador');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Simulador de WhatsApp');
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+stylesheet/);
  });

  it('creates a test user, sends a text and a dataset screenshot through the webhook, shows ticks and the ledger', async () => {
    const h = createHarness(db);
    const phone = randomPhone();
    const created = await h.app.request(
      '/dev/simulador/api/users',
      json({ phone, holderName: 'Marta Quispe' }),
    );
    expect(created.status).toBe(201);

    h.ai.text('vendí 5 de pan', cashSale('5.00'));
    const sent = await h.app.request(
      '/dev/simulador/api/send',
      json({ phone, kind: 'text', text: 'vendí 5 de pan' }),
    );
    expect(sent.status).toBe(200);
    const { waMessageId } = (await sent.json()) as { waMessageId: string };

    const datasets = (await (await h.app.request('/dev/simulador/api/datasets')).json()) as {
      images: string[];
      audios: string[];
    };
    const yape = datasets.images.find((path) => path.startsWith('yape-imgs/'));
    expect(yape).toBeDefined();
    expect(datasets.audios.length).toBeGreaterThan(0);
    // The fake reader answers by file content; give the dataset file a reading.
    const file = await h.app.request(
      `/dev/simulador/api/dataset-file?path=${encodeURIComponent(yape ?? '')}`,
    );
    expect(file.status).toBe(200);
    h.reader.set(
      Buffer.from(await file.arrayBuffer()).toString('utf8'),
      receiptExtraction({ amount: '2.00', operationNumber: '32811444' }),
    );
    const image = await h.app.request(
      '/dev/simulador/api/send',
      json({ phone, kind: 'image', datasetPath: yape }),
    );
    expect(image.status).toBe(200);

    await h.drain();
    const conversation = (await (
      await h.app.request(`/dev/simulador/api/conversation?phone=${encodeURIComponent(phone)}`)
    ).json()) as { events: { waMessageId: string; tick: string; direction: string }[] };
    expect(conversation.events).toHaveLength(2);
    expect(conversation.events.every((e) => e.direction === 'inbound' && e.tick === 'read')).toBe(
      true,
    );
    expect(conversation.events[0]?.waMessageId).toBe(waMessageId);

    const ledger = (await (
      await h.app.request(`/dev/simulador/api/ledger?phone=${encodeURIComponent(phone)}`)
    ).json()) as {
      entries: { amount: string; label: string; status: string }[];
      messages: { status: string }[];
    };
    expect(ledger.entries.map((e) => [e.amount, e.label, e.status]).sort()).toEqual([
      ['S/ 2', 'screenshot', 'confirmed'],
      ['S/ 5', 'self_reported', 'confirmed'],
    ]);
    expect(ledger.messages.map((m) => m.status)).toEqual(['recorded', 'recorded']);
  });

  it('button replies travel as interactive messages; dataset paths cannot escape the folders', async () => {
    const h = createHarness(db);
    const phone = randomPhone();
    const res = await h.app.request(
      '/dev/simulador/api/send',
      json({ phone, kind: 'button', buttonId: 'consent:accept', buttonTitle: 'Acepto' }),
    );
    expect(res.status).toBe(200);
    await h.drain();
    expect(h.hookCalls).toMatchObject([
      { hook: 'onboarding', event: { message: { buttonReplyId: 'consent:accept' } } },
    ]);

    for (const path of ['../.env', 'texts/../../.env', 'eval-runs/x.json', '/etc/passwd']) {
      const file = await h.app.request(
        `/dev/simulador/api/dataset-file?path=${encodeURIComponent(path)}`,
      );
      expect(file.status).toBe(404);
      const send = await h.app.request(
        '/dev/simulador/api/send',
        json({ phone, kind: 'image', datasetPath: path }),
      );
      expect(send.status).toBe(404);
    }
  });
});
