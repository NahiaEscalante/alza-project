import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestDb, hasTestDb } from '../../test/db.js';
import { readScreenshot } from '../ai/read-screenshot.js';
import { screenshotExtractionSchema, textInterpretationSchema } from '../ai/schemas.js';
import {
  clarifications,
  dailyCloses,
  extractions,
  inboundMessages,
  ledgerEntries,
  mediaFiles,
  outboundMessages,
} from '../db/schema.js';
import { businessDayOf, computeIndicators } from '../domain/index.js';
import type { OcrEngine } from '../ocr/engine.js';
import type { OcrLineRead, OcrPage } from '../ocr/types.js';
import { REPO_ROOT } from '../paths.js';
import {
  cashSale,
  createHarness,
  createOnboardedUser,
  randomPhone,
  receiptExtraction,
  userByPhone,
} from './test-support.js';
import { processInboundJob, retryInboundMessage } from './worker.js';

describe.skipIf(!hasTestDb)('message pipeline', () => {
  const { pool, db } = createTestDb();
  afterAll(() => pool.end());

  const entriesOf = (userId: string) =>
    db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.userId, userId))
      .orderBy(asc(ledgerEntries.createdAt), asc(ledgerEntries.amountCents));
  const doubtsOf = (userId: string) =>
    db.select().from(clarifications).where(eq(clarifications.userId, userId));
  const inbound = async (waMessageId: string) => {
    const [row] = await db
      .select()
      .from(inboundMessages)
      .where(eq(inboundMessages.waMessageId, waMessageId));
    if (!row) throw new Error('inbound not found');
    return row;
  };
  const outboundOf = (userId: string) =>
    db.select().from(outboundMessages).where(eq(outboundMessages.userId, userId));

  it('H1: 100 repeated deliveries of one message → 1 inbound message, 1 job, 1 entry', async () => {
    const h = createHarness(db);
    const user = await createOnboardedUser(db);
    h.ai.text('vendí 5 de pan', cashSale('5.00'));
    const waMessageId = `wamid.H1${Date.now()}`;
    const message = { type: 'text' as const, body: 'vendí 5 de pan' };

    const first = await Promise.all(
      Array.from({ length: 50 }, () => h.deliver(user.phoneE164, message, { waMessageId })),
    );
    for (let i = 0; i < 50; i++) await h.deliver(user.phoneE164, message, { waMessageId });
    expect(first.every((r) => r.status === 200)).toBe(true);

    const rows = await db
      .select()
      .from(inboundMessages)
      .where(eq(inboundMessages.waMessageId, waMessageId));
    expect(rows).toHaveLength(1);
    expect(h.queue.jobs).toHaveLength(1);
    await h.drain();
    // The same job delivered again by the queue does nothing.
    const repeat = await processInboundJob(h.deps, {
      inboundMessageId: rows[0]?.id as string,
      retryCount: 0,
    });
    expect(repeat.skipped).toBe(true);

    const entries = await entriesOf(user.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      amountCents: 500,
      paymentMethod: 'cash',
      label: 'self_reported',
    });
    expect(h.ai.calls.filter((c) => c.fn === 'interpret_text')).toHaveLength(1);
  });

  it('RF-ON-02: an unknown number is created, nothing is processed or kept, onboarding gets it', async () => {
    const h = createHarness(db);
    const phone = randomPhone();
    const textId = await h.sendText(phone, 'Hola ALZA');
    const imageId = await h.sendImage(phone, 'img:before-consent');
    await h.drain();

    const user = await userByPhone(db, phone);
    expect(user?.onboardingStatus).toBe('new');
    for (const id of [textId, imageId]) {
      const row = await inbound(id);
      expect(row.status).toBe('discarded_no_consent');
      expect(row.text).toBeNull();
      expect(row.mediaFileId).toBeNull();
    }
    expect(h.reader.calls).toBe(0);
    expect(h.ai.calls).toHaveLength(0);
    expect(h.storage.blobs.size).toBe(0);
    expect(
      await db
        .select()
        .from(mediaFiles)
        .where(eq(mediaFiles.userId, user?.id ?? '')),
    ).toEqual([]);
    expect(await entriesOf(user?.id ?? '')).toEqual([]);
    const onboarding = h.hookCalls.filter((c) => c.hook === 'onboarding');
    expect(onboarding).toHaveLength(2);
    // The hook still sees the words in memory (to greet her), never stored.
    expect(onboarding[0]?.event).toMatchObject({
      consented: false,
      message: { text: 'Hola ALZA' },
    });
  });

  it('HU-02: a legible Yape of S/12,50 → confirmed sale, «con captura», stored encrypted, no reply', async () => {
    const h = createHarness(db);
    const user = await createOnboardedUser(db);
    h.reader.set(
      'img:hu02',
      receiptExtraction({ amount: '12.50', counterparty: 'Ana T.', operationNumber: '00000001' }),
    );
    const id = await h.sendImage(user.phoneE164, 'img:hu02');
    await h.drain();

    const [entry] = await entriesOf(user.id);
    expect(entry).toMatchObject({
      amountCents: 1250,
      direction: 'in',
      paymentMethod: 'yape',
      category: 'sale',
      label: 'screenshot',
      status: 'confirmed',
      source: 'screenshot',
      counterparty: 'Ana T.',
      operationNumber: '00000001',
    });
    const row = await inbound(id);
    expect(row.status).toBe('recorded');
    expect(entry?.inboundMessageId).toBe(row.id);
    // RF-IN-04: file stored with its SHA-256.
    const [file] = await db.select().from(mediaFiles).where(eq(mediaFiles.userId, user.id));
    expect(file?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(h.storage.blobs.get(file?.storageKey ?? '')?.data.toString()).toBe('img:hu02');
    expect(row.mediaFileId).toBe(file?.id);
    // 8.3: the reading is kept.
    const saved = await db
      .select()
      .from(extractions)
      .where(eq(extractions.inboundMessageId, row.id));
    expect(saved).toMatchObject([{ function: 'extract_screenshot', isValid: true }]);
    // D04 + RF-IN-03: read, and silence.
    expect(h.store.tickOf(id)).toBe('read');
    expect(await outboundOf(user.id)).toEqual([]);
    expect(h.store.events(user.phoneE164).filter((e) => e.direction === 'outbound')).toEqual([]);
  });

  it('case 1 / HU-02: the same screenshot twice, or the same operation number, adds nothing', async () => {
    const h = createHarness(db);
    const user = await createOnboardedUser(db);
    h.reader
      .set('img:a', receiptExtraction({ amount: '20.00', operationNumber: '11112222' }))
      .set('img:a-cropped', receiptExtraction({ amount: '20.00', operationNumber: '11112222' }));
    const first = await h.sendImage(user.phoneE164, 'img:a');
    const resent = await h.sendImage(user.phoneE164, 'img:a');
    const cropped = await h.sendImage(user.phoneE164, 'img:a-cropped');
    await h.drain();

    expect(await entriesOf(user.id)).toHaveLength(1);
    expect((await inbound(first)).status).toBe('recorded');
    expect((await inbound(resent)).status).toBe('duplicate');
    expect((await inbound(cropped)).status).toBe('duplicate');
    expect(h.reader.calls).toBe(2); // the exact same file is not even read again
    expect(await doubtsOf(user.id)).toEqual([]);
  });

  it('case 2 / HU-02: two S/2 from the same child with different operation numbers → two sales', async () => {
    const h = createHarness(db);
    const user = await createOnboardedUser(db);
    const at = new Date(Date.now() - 60_000).toISOString();
    h.reader
      .set(
        'img:2a',
        receiptExtraction({
          amount: '2.00',
          counterparty: 'Luis P.',
          operationNumber: '30000001',
          occurredAt: at,
        }),
      )
      .set(
        'img:2b',
        receiptExtraction({
          amount: '2.00',
          counterparty: 'Luis P.',
          operationNumber: '30000002',
          occurredAt: at,
        }),
      );
    await h.sendImage(user.phoneE164, 'img:2a');
    await h.sendImage(user.phoneE164, 'img:2b');
    await h.drain();
    const entries = await entriesOf(user.id);
    expect(entries.map((e) => [e.amountCents, e.status])).toEqual([
      [200, 'confirmed'],
      [200, 'confirmed'],
    ]);
    expect(await doubtsOf(user.id)).toEqual([]);
  });

  it('case 3: same amount and counterparty 1 minute apart without operation number → possible duplicate', async () => {
    const h = createHarness(db);
    const user = await createOnboardedUser(db);
    const t0 = Date.now() - 5 * 60_000;
    h.reader
      .set(
        'img:3a',
        receiptExtraction({
          amount: '20.00',
          counterparty: 'Rosa M.',
          occurredAt: new Date(t0).toISOString(),
        }),
      )
      .set(
        'img:3b',
        receiptExtraction({
          amount: '20.00',
          counterparty: 'Rosa M.',
          occurredAt: new Date(t0 + 60_000).toISOString(),
        }),
      );
    await h.sendImage(user.phoneE164, 'img:3a');
    const second = await h.sendImage(user.phoneE164, 'img:3b');
    await h.drain();
    const entries = await entriesOf(user.id);
    expect(entries.map((e) => e.status)).toEqual(['confirmed', 'pending']);
    const doubts = await doubtsOf(user.id);
    expect(doubts).toMatchObject([
      { type: 'possible_duplicate', ledgerEntryId: entries[1]?.id, priority: 2, status: 'open' },
    ]);
    expect((await inbound(second)).status).toBe('pending');
  });

  it('HU-03: «¡Yapeaste!» goes out; a distributor is merchandise, anyone else «por clasificar» + low doubt (D55)', async () => {
    const h = createHarness(db);
    const user = await createOnboardedUser(db);
    h.reader
      .set(
        'img:dist',
        receiptExtraction({
          amount: '150.00',
          header: 'yape_sent',
          counterparty: 'Distribuidora Sur',
          operationNumber: '40000001',
        }),
      )
      .set(
        'img:juan',
        receiptExtraction({
          amount: '60.00',
          header: 'yape_sent',
          counterparty: 'Juan Pérez',
          operationNumber: '40000002',
        }),
      )
      .set(
        'img:plin',
        receiptExtraction({
          amount: '30.00',
          header: 'plin_sent',
          paymentMethod: 'plin',
          visibleHolder: 'Marta Quispe Huamán',
          counterparty: 'Comercial Andina',
          operationNumber: '5e449e2ba19e771e31dda7bc6',
        }),
      );
    await h.sendImage(user.phoneE164, 'img:dist');
    await h.sendImage(user.phoneE164, 'img:juan');
    await h.sendImage(user.phoneE164, 'img:plin');
    await h.drain();

    const entries = await entriesOf(user.id);
    expect(entries.map((e) => [e.amountCents, e.direction, e.category, e.status])).toEqual([
      [15000, 'out', 'inventory', 'confirmed'],
      [6000, 'out', 'unclassified', 'confirmed'],
      [3000, 'out', 'unclassified', 'confirmed'],
    ]);
    const doubts = await doubtsOf(user.id);
    expect(doubts.map((d) => [d.type, d.priority]).sort()).toEqual([
      ['category', 6],
      ['category', 6],
    ]);
  });

  it('11.2: a payment shown without her name and without a Yape header → pending + direction doubt', async () => {
    const h = createHarness(db);
    const user = await createOnboardedUser(db);
    h.reader.set(
      'img:bbva',
      receiptExtraction({
        amount: '20.00',
        header: 'plin_sent',
        paymentMethod: 'plin',
        counterparty: 'Andres alejandr...',
        operationNumber: '000001636',
      }),
    );
    await h.sendImage(user.phoneE164, 'img:bbva');
    await h.drain();
    const [entry] = await entriesOf(user.id);
    expect(entry).toMatchObject({ status: 'pending', amountCents: 2000 });
    expect(await doubtsOf(user.id)).toMatchObject([
      { type: 'direction', ledgerEntryId: entry?.id },
    ]);
  });

  it('cases 6 and 33: a client phone paying her, and a Yape to an additional holder, are sales', async () => {
    const h = createHarness(db);
    const user = await createOnboardedUser(db, { extraHolders: ['Pedro Rojas'] });
    h.reader
      .set(
        'img:client',
        receiptExtraction({
          amount: '15.00',
          header: 'yape_sent',
          counterparty: 'Marta Q.',
          operationNumber: '50000001',
        }),
      )
      .set(
        'img:husband',
        receiptExtraction({
          amount: '9.00',
          header: 'yape_sent',
          counterparty: 'Pedro R.',
          operationNumber: '50000002',
        }),
      );
    await h.sendImage(user.phoneE164, 'img:client');
    await h.sendImage(user.phoneE164, 'img:husband');
    await h.drain();
    const entries = await entriesOf(user.id);
    expect(entries.map((e) => [e.direction, e.category, e.status])).toEqual([
      ['in', 'sale', 'confirmed'],
      ['in', 'sale', 'confirmed'],
    ]);
  });

  it('D53: a screenshot without a legible date goes to the arrival day, pending, with a «fecha» doubt', async () => {
    const h = createHarness(db);
    const user = await createOnboardedUser(db);
    h.reader.set(
      'img:nodate',
      receiptExtraction({ amount: '8.00', occurredAt: null, operationNumber: '60000001' }),
    );
    const id = await h.sendImage(user.phoneE164, 'img:nodate');
    await h.drain();
    const row = await inbound(id);
    const [entry] = await entriesOf(user.id);
    expect(entry).toMatchObject({ status: 'pending', businessDay: businessDayOf(row.receivedAt) });
    expect(await doubtsOf(user.id)).toMatchObject([{ type: 'date', priority: 5 }]);
  });

  it('HU-05 / case 8: an unreadable screenshot never invents an amount → «ilegible» doubt', async () => {
    const h = createHarness(db);
    const user = await createOnboardedUser(db);
    h.reader.set('img:blur', receiptExtraction({ amount: null, operationNumber: null }));
    const id = await h.sendImage(user.phoneE164, 'img:blur');
    await h.drain();
    expect(await entriesOf(user.id)).toEqual([]);
    const row = await inbound(id);
    expect(row.status).toBe('unreadable');
    expect(await doubtsOf(user.id)).toMatchObject([
      {
        type: 'unreadable',
        priority: 3,
        inboundMessageId: row.id,
        ledgerEntryId: null,
        status: 'open',
      },
    ]);
    expect(await outboundOf(user.id)).toEqual([]);
  });

  it('HU-04: one audio with two cash sales → two «lo contaste tú»; «hoy vendí 150» → ambiguous total', async () => {
    const h = createHarness(db);
    const user = await createOnboardedUser(db);
    h.ai
      .audio('audio:two-sales', { text: 'vendí tres cincuenta de pan y dos soles de gaseosa' })
      .audio('audio:total', { text: 'hoy vendí 150' })
      .text('vendí tres cincuenta de pan y dos soles de gaseosa', {
        intent: 'record',
        operations: [
          { ...cashSale('3.50').operations?.[0], description: 'pan' },
          { ...cashSale('2.00').operations?.[0], description: 'gaseosa' },
        ] as never,
      })
      .text('hoy vendí 150', {
        intent: 'record',
        operations: [
          {
            amount: '150.00',
            amount_alternatives: [],
            direction: 'in',
            payment_method: 'unknown',
            scope: 'day_total',
            suggested_category: 'sale',
            counterparty_name: null,
            description: null,
            confidence: { amount: 0.97, payment_method: 0.2 },
          },
        ],
      });
    const two = await h.sendAudio(user.phoneE164, 'audio:two-sales');
    const total = await h.sendAudio(user.phoneE164, 'audio:total');
    await h.drain();

    const entries = await entriesOf(user.id);
    expect(
      entries.map((e) => [e.amountCents, e.paymentMethod, e.label, e.source, e.status]),
    ).toEqual([
      [200, 'cash', 'self_reported', 'audio', 'confirmed'],
      [350, 'cash', 'self_reported', 'audio', 'confirmed'],
    ]);
    expect((await inbound(two)).status).toBe('recorded');
    expect((await inbound(total)).status).toBe('pending');
    expect(await doubtsOf(user.id)).toMatchObject([
      {
        type: 'ambiguous_total',
        priority: 1,
        detail: { declaredTotalCents: 15000, variant: 'no_method', quote: 'hoy vendí 150' },
      },
    ]);
    const saved = await db
      .select({ fn: extractions.function })
      .from(extractions)
      .where(eq(extractions.inboundMessageId, (await inbound(two)).id));
    expect(saved.map((s) => s.fn).sort()).toEqual(['interpret_text', 'transcribe_audio']);
  });

  it('case 9: «vendí pan» without amount is not recorded → «ilegible» doubt with her words', async () => {
    const h = createHarness(db);
    const user = await createOnboardedUser(db);
    h.ai.text('vendí pan', {
      intent: 'record',
      operations: [
        { ...cashSale('1.00').operations?.[0], amount: null, confidence: { amount: 0 } },
      ] as never,
    });
    const id = await h.sendText(user.phoneE164, 'vendí pan');
    await h.drain();
    expect(await entriesOf(user.id)).toEqual([]);
    expect((await inbound(id)).status).toBe('unreadable');
    expect(await doubtsOf(user.id)).toMatchObject([
      {
        type: 'unreadable',
        detail: { quote: 'vendí pan', direction: 'in', paymentMethod: 'cash' },
      },
    ]);
  });

  it('cases 11, 12 and 26: declared cash totals (PR09)', async () => {
    const h = createHarness(db);
    const user = await createOnboardedUser(db);
    const cashTotal = (amount: string) => ({
      intent: 'record' as const,
      operations: [
        {
          amount,
          amount_alternatives: [],
          direction: 'in' as const,
          payment_method: 'cash' as const,
          scope: 'day_total' as const,
          suggested_category: 'sale' as const,
          counterparty_name: null,
          description: null,
          confidence: { amount: 0.97 },
        },
      ],
    });
    h.ai
      .text('vendí 95', cashSale('95.00'))
      .text('hoy vendí 80 en efectivo', cashTotal('80.00'))
      .text('hoy vendí 200 en efectivo', cashTotal('200.00'))
      .text('vendí 5 de pan', cashSale('5.00'));
    await h.sendText(user.phoneE164, 'vendí 95');
    await h.sendText(user.phoneE164, 'hoy vendí 80 en efectivo');
    await h.sendText(user.phoneE164, 'hoy vendí 200 en efectivo');
    await h.sendText(user.phoneE164, 'vendí 5 de pan');
    await h.drain();

    const entries = await entriesOf(user.id);
    expect(entries.map((e) => [e.amountCents, e.label])).toEqual([
      [9500, 'self_reported'],
      [10500, 'unitemized'],
      [500, 'self_reported'],
    ]);
    expect(await doubtsOf(user.id)).toMatchObject([
      {
        type: 'ambiguous_total',
        detail: { variant: 'cash_below_recorded', declaredTotalCents: 8000, recordedCents: 9500 },
      },
    ]);
  });

  it('case 13: «eso no, eran 52» corrects her last entry; two candidates → a doubt, nothing changed', async () => {
    const h = createHarness(db);
    const user = await createOnboardedUser(db);
    h.ai.text('vendí 5 de pan', cashSale('5.00')).text('eso no, eran 52', {
      intent: 'correct',
      correction: {
        void: false,
        amount: '52.00',
        payment_method: null,
        direction: null,
        suggested_category: null,
      },
    });
    await h.sendText(user.phoneE164, 'vendí 5 de pan');
    await h.drain();
    const correctionId = await h.sendText(user.phoneE164, 'eso no, eran 52');
    await h.drain();

    const entries = await entriesOf(user.id);
    expect(entries.map((e) => [e.amountCents, e.status, e.label])).toEqual([
      [500, 'superseded', 'self_reported'],
      [5200, 'confirmed', 'self_reported'],
    ]);
    expect(entries[1]?.replacesEntryId).toBe(entries[0]?.id);
    expect(entries[1]?.inboundMessageId).toBe((await inbound(correctionId)).id);

    // Ambiguous: her last message created two entries.
    const other = await createOnboardedUser(db);
    h.ai.text('vendí 3.50 de pan y 2 de gaseosa', {
      intent: 'record',
      operations: [cashSale('3.50').operations?.[0], cashSale('2.00').operations?.[0]] as never,
    });
    await h.sendText(other.phoneE164, 'vendí 3.50 de pan y 2 de gaseosa');
    await h.drain();
    const ambiguous = await h.sendText(other.phoneE164, 'eso no, eran 52');
    await h.drain();
    const otherEntries = await entriesOf(other.id);
    expect(otherEntries.map((e) => e.status)).toEqual(['confirmed', 'confirmed']);
    expect((await inbound(ambiguous)).status).toBe('pending');
    expect(await doubtsOf(other.id)).toMatchObject([
      { type: 'unreadable', detail: { quote: 'eso no, eran 52' } },
    ]);
  });

  it('case 13: «no era yape, era plin» and «borra eso» by message (RF-LB-01: nothing deleted)', async () => {
    const h = createHarness(db);
    const user = await createOnboardedUser(db);
    h.ai
      .text('me yapearon 20', {
        intent: 'record',
        operations: [{ ...cashSale('20.00').operations?.[0], payment_method: 'yape' }] as never,
      })
      .text('no era yape, era plin', {
        intent: 'correct',
        correction: {
          void: false,
          amount: null,
          payment_method: 'plin',
          direction: null,
          suggested_category: null,
        },
      })
      .text('borra eso', {
        intent: 'correct',
        correction: {
          void: true,
          amount: null,
          payment_method: null,
          direction: null,
          suggested_category: null,
        },
      });
    await h.sendText(user.phoneE164, 'me yapearon 20');
    await h.drain();
    await h.sendText(user.phoneE164, 'no era yape, era plin');
    await h.drain();
    let entries = await entriesOf(user.id);
    expect(entries.map((e) => [e.paymentMethod, e.status])).toEqual([
      ['yape', 'superseded'],
      ['plin', 'confirmed'],
    ]);
    await h.sendText(user.phoneE164, 'borra eso');
    await h.drain();
    entries = await entriesOf(user.id);
    expect(entries.map((e) => [e.paymentMethod, e.status])).toEqual([
      ['yape', 'superseded'],
      ['plin', 'voided'],
    ]);
  });

  it('11.4: «me yapearon 20 de Rosa» after her screenshot is linked and adds nothing', async () => {
    const h = createHarness(db);
    const user = await createOnboardedUser(db);
    h.reader.set(
      'img:rosa',
      receiptExtraction({
        amount: '20.00',
        counterparty: 'Rosa Mendoza',
        operationNumber: '70000001',
      }),
    );
    h.ai.text('me yapearon 20 de Rosa', {
      intent: 'record',
      operations: [
        { ...cashSale('20.00').operations?.[0], payment_method: 'yape', counterparty_name: 'Rosa' },
      ] as never,
    });
    await h.sendImage(user.phoneE164, 'img:rosa');
    const mention = await h.sendText(user.phoneE164, 'me yapearon 20 de Rosa');
    await h.drain();
    expect(await entriesOf(user.id)).toHaveLength(1);
    expect((await inbound(mention)).status).toBe('duplicate');
  });

  it('RF-IN-05 / case 24: the AI failing every time → retried 3 times, then `failed` with its code', async () => {
    const h = createHarness(db);
    const user = await createOnboardedUser(db);
    h.ai.text('vendí 7', 'unavailable');
    h.reader.set('img:down', 'ai_down');
    const text = await h.sendText(user.phoneE164, 'vendí 7');
    const image = await h.sendImage(user.phoneE164, 'img:down');
    const results = await h.drain();

    expect(results.map((r) => r.status)).toEqual(['failed', 'failed']);
    for (const id of [text, image]) {
      const row = await inbound(id);
      expect(row).toMatchObject({ status: 'failed', errorCode: 'ai_unavailable', attempts: 4 });
    }
    expect(h.reader.calls).toBe(4);
    // A failure never becomes a doubt or an entry.
    expect(await doubtsOf(user.id)).toEqual([]);
    expect(await entriesOf(user.id)).toEqual([]);
    // Every call was kept (invalid).
    const saved = await db
      .select()
      .from(extractions)
      .where(eq(extractions.inboundMessageId, (await inbound(text)).id));
    expect(saved).toHaveLength(4);
    expect(saved.every((s) => !s.isValid)).toBe(true);

    // RF-AD-01: the panel retries it once the AI is back.
    h.ai.text('vendí 7', cashSale('7.00'));
    expect(await retryInboundMessage({ db, queue: h.queue }, (await inbound(text)).id)).toBe(true);
    await h.drain();
    expect((await inbound(text)).status).toBe('recorded');
    expect(await entriesOf(user.id)).toHaveLength(1);
  });

  it('an error that heals before the last retry ends normally (error → processing → recorded)', async () => {
    const h = createHarness(db);
    const user = await createOnboardedUser(db);
    let calls = 0;
    h.ai.interpretText = async () => {
      calls += 1;
      if (calls < 3) return { ok: false, error: 'unavailable', attempts: 1 };
      return {
        ok: true,
        meta: {
          provider: 'groq',
          model: 'm',
          promptVersion: 'p',
          routeId: 'r',
          latencyMs: 1,
          attempts: 1,
        },
        value: textInterpretationSchema.parse(cashSale('4.00')),
      };
    };
    const id = await h.sendText(user.phoneE164, 'vendí 4');
    await h.drain();
    expect(await inbound(id)).toMatchObject({ status: 'recorded', attempts: 3, errorCode: null });
  });

  it('hand-offs: close reply (WhatsApp «responder» and intent), «cierre», requests, danger, buttons', async () => {
    const h = createHarness(db);
    const user = await createOnboardedUser(db);
    const today = businessDayOf(new Date());
    await db.insert(dailyCloses).values({
      userId: user.id,
      businessDay: today,
      status: 'sent',
      sentAt: new Date(Date.now() - 10 * 60_000),
      closeWaMessageId: 'wamid.CLOSE-TODAY',
    });
    h.ai
      .text('1 son 12, 3 sí', { intent: 'close_reply' })
      .text('cierre', { intent: 'close_now' })
      .text('web', { intent: 'request', request: 'web_link' })
      .text('me están amenazando para que pague un cupo', { intent: 'danger' })
      .text('hola', { intent: 'other' });

    const quoted = await h.sendText(user.phoneE164, 'la caja sí cuadra', {
      replyTo: 'wamid.CLOSE-TODAY',
    });
    const reply = await h.sendText(user.phoneE164, '1 son 12, 3 sí');
    await h.sendText(user.phoneE164, 'cierre');
    await h.sendText(user.phoneE164, 'web');
    await h.sendText(user.phoneE164, 'me están amenazando para que pague un cupo');
    const hello = await h.sendText(user.phoneE164, 'hola');
    await h.deliver(user.phoneE164, {
      type: 'interactive',
      buttonId: 'delete:confirm',
      buttonTitle: 'Sí, borrar todo',
    });
    await h.drain();

    expect(h.hookCalls.map((c) => c.hook)).toEqual([
      'closeReply',
      'closeReply',
      'closeNow',
      'request',
      'danger',
      'request',
    ]);
    expect(h.hookCalls[0]?.event).toMatchObject({
      via: 'reply_context',
      businessDay: today,
      timing: 'on_time',
      text: 'la caja sí cuadra',
    });
    expect(h.hookCalls[1]?.event).toMatchObject({ via: 'intent', businessDay: today });
    expect(h.hookCalls[3]?.event).toMatchObject({ request: 'web_link', buttonReplyId: null });
    expect(h.hookCalls[5]?.event).toMatchObject({ request: null, buttonReplyId: 'delete:confirm' });
    // The reply quoted the close: the text model was not even asked.
    expect(h.ai.calls.some((c) => c.input === 'la caja sí cuadra')).toBe(false);
    expect((await inbound(quoted)).status).toBe('request_handled');
    expect((await inbound(reply)).status).toBe('request_handled');
    expect((await inbound(hello)).status).toBe('non_financial');
    expect(await entriesOf(user.id)).toEqual([]);
  });

  it('D28 / case 28: the third unreadable screenshot in a row calls the tip hook, at most once a day', async () => {
    const h = createHarness(db, {
      hooks: {
        unreadableTip: async (event) => {
          // What Fase 4 will do: send WA-19 through the channel.
          await h.channel.sendText(
            { userId: event.user.id, to: event.user.phoneE164, catalogId: 'WA-19' },
            { body: 'Tus últimas capturas no se leen bien.' },
          );
        },
      },
    });
    const user = await createOnboardedUser(db);
    for (const key of ['u1', 'u2', 'u3', 'u4'])
      h.reader.set(`img:${key}`, receiptExtraction({ amount: null }));
    for (const key of ['u1', 'u2', 'u3', 'u4']) await h.sendImage(user.phoneE164, `img:${key}`);
    await h.drain();
    const tips = h.hookCalls.filter((c) => c.hook === 'unreadableTip');
    expect(tips).toHaveLength(1);
    expect(tips[0]?.event).toMatchObject({ consecutiveUnreadable: 3 });
    expect((await outboundOf(user.id)).map((o) => o.type)).toEqual(['WA-19']);
  });

  it('11.10 / D10: an activity list links what is recorded and sends the rest to the web', async () => {
    const h = createHarness(db);
    const user = await createOnboardedUser(db);
    const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
    h.reader.set(
      'img:one',
      receiptExtraction({
        amount: '12.50',
        counterparty: 'Ana T.',
        operationNumber: '80000001',
        occurredAt: at(30),
      }),
    );
    h.reader.set(
      'img:list',
      screenshotExtractionSchema.parse({
        content_type: 'activity_list',
        legible: true,
        operations: [
          {
            amount: '12.50',
            payment_method: 'yape',
            counterparty_name: 'Ana T.',
            holder_role: 'payee',
            occurred_at: at(30),
            operation_number: '80000001',
          },
          {
            amount: '7.00',
            payment_method: 'yape',
            counterparty_name: 'Luis P.',
            holder_role: 'payee',
            occurred_at: at(20),
          },
          {
            amount: '7.00',
            payment_method: 'yape',
            counterparty_name: 'Luis P.',
            holder_role: 'payee',
            occurred_at: at(20),
          },
        ],
      }),
    );
    await h.sendImage(user.phoneE164, 'img:one');
    const list = await h.sendImage(user.phoneE164, 'img:list');
    await h.drain();
    expect(await entriesOf(user.id)).toHaveLength(1);
    expect((await inbound(list)).status).toBe('pending');
    expect(await doubtsOf(user.id)).toMatchObject([
      {
        type: 'missing_from_list',
        status: 'in_web',
        detail: { row: { amountCents: 700, counterparty: 'Luis P.' } },
      },
    ]);
  });

  it('case 5 / PR03: a screenshot of a day whose close was already answered is flagged «después del cierre»', async () => {
    const h = createHarness(db);
    const user = await createOnboardedUser(db);
    const today = businessDayOf(new Date());
    await db.insert(dailyCloses).values({
      userId: user.id,
      businessDay: today,
      status: 'replied',
      sentAt: new Date(Date.now() - 60 * 60_000),
      repliedAt: new Date(Date.now() - 30 * 60_000),
      level: 'complete',
    });
    h.reader.set('img:late', receiptExtraction({ amount: '6.00', operationNumber: '90000001' }));
    await h.sendImage(user.phoneE164, 'img:late');
    await h.drain();
    expect(await entriesOf(user.id)).toMatchObject([
      { afterClose: true, status: 'confirmed', businessDay: today },
    ]);
  });

  it('a real dataset screenshot through readScreenshot (captured OCR): C-001, Yape S/2 → sale on its own day', async () => {
    const fixtures = JSON.parse(
      readFileSync(new URL('../ocr/__fixtures__/screenshots.json', import.meta.url), 'utf8'),
    ) as Record<string, { page: OcrPage; amountLines: OcrLineRead[] }>;
    const fixture = fixtures['C-001'] as { page: OcrPage; amountLines: OcrLineRead[] };
    let line = 0;
    const ocr: OcrEngine = {
      readPage: async () => fixture.page,
      readLine: async () => fixture.amountLines[line++ % fixture.amountLines.length] as OcrLineRead,
      close: async () => undefined,
    };
    const h = createHarness(db);
    h.deps.readScreenshot = (image, now) =>
      readScreenshot(image, {
        ocr,
        ai: { extractScreenshot: async () => ({ ok: false, error: 'no_routes', attempts: 0 }) },
        now: () => now,
      });
    const user = await createOnboardedUser(db);
    const bytes = readFileSync(
      join(REPO_ROOT, 'datasets/yape-imgs/WhatsApp Image 2026-11-08 at 12.39.44 PM.jpeg'),
    );
    const { mediaId, sha256 } = h.store.putMedia(bytes, 'image/jpeg');
    await h.deliver(user.phoneE164, { type: 'image', mediaId, mimeType: 'image/jpeg', sha256 });
    await h.drain();
    expect(await entriesOf(user.id)).toMatchObject([
      {
        amountCents: 200,
        direction: 'in',
        paymentMethod: 'yape',
        label: 'screenshot',
        status: 'confirmed',
        businessDay: '2026-11-04',
        operationNumber: '32811444',
      },
    ]);
  });

  it('a day of messages leaves the expected ledger and indicators, in silence', async () => {
    const h = createHarness(db);
    const user = await createOnboardedUser(db, { holder: 'Marta Quispe' });
    const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
    h.reader
      .set(
        'img:ana',
        receiptExtraction({
          amount: '12.50',
          counterparty: 'Ana T.',
          operationNumber: '10000001',
          occurredAt: at(300),
        }),
      )
      .set(
        'img:rosa',
        receiptExtraction({
          amount: '20.00',
          counterparty: 'Rosa M.',
          operationNumber: '10000002',
          occurredAt: at(240),
        }),
      )
      .set(
        'img:dist',
        receiptExtraction({
          amount: '150.00',
          header: 'yape_sent',
          counterparty: 'Distribuidora Sur',
          operationNumber: '10000003',
          occurredAt: at(200),
        }),
      )
      .set('img:blur', receiptExtraction({ amount: null }))
      .set(
        'img:luis',
        receiptExtraction({
          amount: '7.50',
          counterparty: 'Luis P.',
          operationNumber: '10000004',
          occurredAt: at(60),
        }),
      );
    h.ai
      .audio('audio:sales', { text: 'vendí tres cincuenta de pan y dos de gaseosa' })
      .text('vendí tres cincuenta de pan y dos de gaseosa', {
        intent: 'record',
        operations: [cashSale('3.50').operations?.[0], cashSale('2.00').operations?.[0]] as never,
      })
      .text('vendí 5 de pan', cashSale('5.00'))
      .text('saqué 30 para la casa', {
        intent: 'record',
        operations: [
          {
            ...cashSale('30.00').operations?.[0],
            direction: 'out',
            suggested_category: 'household',
          },
        ] as never,
      })
      .text('hoy vendí 50 en efectivo', {
        intent: 'record',
        operations: [{ ...cashSale('50.00').operations?.[0], scope: 'day_total' }] as never,
      })
      .text('hola 👋', { intent: 'other' });

    await h.sendText(user.phoneE164, 'hola 👋');
    await h.sendImage(user.phoneE164, 'img:ana');
    await h.sendImage(user.phoneE164, 'img:rosa');
    await h.sendImage(user.phoneE164, 'img:rosa'); // forwarded again
    await h.sendText(user.phoneE164, 'vendí 5 de pan');
    await h.sendImage(user.phoneE164, 'img:dist');
    await h.sendAudio(user.phoneE164, 'audio:sales');
    await h.sendImage(user.phoneE164, 'img:blur');
    await h.sendText(user.phoneE164, 'saqué 30 para la casa');
    await h.sendText(user.phoneE164, 'hoy vendí 50 en efectivo');
    await h.sendImage(user.phoneE164, 'img:luis');
    const results = await h.drain();
    expect(results.map((r) => r.status)).toEqual([
      'non_financial',
      'recorded',
      'recorded',
      'duplicate',
      'recorded',
      'recorded',
      'recorded',
      'unreadable',
      'recorded',
      'recorded',
      'recorded',
    ]);

    const entries = await entriesOf(user.id);
    const indicators = computeIndicators(entries);
    // Digital: 12.50 + 20 + 7.50 = 40. Cash: 5 + 3.50 + 2 = 10.50, plus 39.50 «sin detalle»
    // because she said 50 in cash (PR09). Out: 150 merchandise + 30 house.
    expect(indicators).toMatchObject({
      digitalSalesCents: 4000,
      cashSalesCents: 5000,
      inCents: 9000,
      inventoryCents: 15000,
      householdCents: 3000,
      outCents: 18000,
      pendingCents: 0,
    });
    expect(entries.filter((e) => e.label === 'unitemized').map((e) => e.amountCents)).toEqual([
      3950,
    ]);
    expect((await doubtsOf(user.id)).map((d) => d.type)).toEqual(['unreadable']);
    expect(await outboundOf(user.id)).toEqual([]);
    expect(
      h.store.events(user.phoneE164).every((e) => e.direction === 'inbound' && e.tick === 'read'),
    ).toBe(true);
    const failed = await db
      .select()
      .from(inboundMessages)
      .where(and(eq(inboundMessages.userId, user.id), eq(inboundMessages.status, 'failed')));
    expect(failed).toEqual([]);
  });
});
