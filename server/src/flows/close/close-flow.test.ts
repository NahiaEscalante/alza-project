import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, hasTestDb } from '../../../test/db.js';
import { ensureRewardsCatalog } from '../../account/index.js';
import { screenshotExtractionSchema } from '../../ai/schemas.js';
import { recordPinLockoutNotice } from '../../auth/index.js';
import {
  clarifications,
  dailyCloses,
  extractions,
  inboundMessages,
  ledgerEntries,
  type User,
  users,
} from '../../db/schema.js';
import { computeIndicators, limaInstant } from '../../domain/index.js';
import { createClarification, createEntry, getDayEntries } from '../../ledger/index.js';
import { cashSale, createOnboardedUser, receiptExtraction } from '../../pipeline/test-support.js';
import { toFlowMessage } from '../../pipeline/worker.js';
import { weekForClose } from './data.js';
import { applyCloseReply } from './reply.js';
import { createCloseHarness, dayTotal, TEST_BASE_URL } from './test-support.js';

const TUE = '2026-11-10';
const WED = '2026-11-11';
const SUN = '2026-11-15';
const SYSTEM = { kind: 'system', channel: 'pipeline' } as const;

describe.skipIf(!hasTestDb)('close flow (Fase 5)', () => {
  const { pool, db } = createTestDb();
  beforeAll(() => ensureRewardsCatalog(db));
  afterAll(() => pool.end());

  const entriesOf = (userId: string) =>
    db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.userId, userId))
      .orderBy(asc(ledgerEntries.createdAt));
  const doubtsOf = (userId: string) =>
    db
      .select()
      .from(clarifications)
      .where(eq(clarifications.userId, userId))
      .orderBy(asc(clarifications.createdAt));

  /** Two Yape screenshots and «vendí 5 soles de pan» on Tuesday. */
  async function normalDay(h: ReturnType<typeof createCloseHarness>, user: User) {
    h.clock.setLima(TUE, 9);
    h.reader
      .set(
        'img:rosa',
        receiptExtraction({
          amount: '20.00',
          counterparty: 'Rosa Quispe',
          occurredAt: limaInstant(TUE, 8, 55).toISOString(),
          operationNumber: '10000001',
        }),
      )
      .set(
        'img:juan',
        receiptExtraction({
          amount: '12.50',
          counterparty: 'Juan Pérez',
          occurredAt: limaInstant(TUE, 8, 58).toISOString(),
          operationNumber: '10000002',
        }),
      );
    h.ai.text('vendí 5 soles de pan', cashSale('5.00'));
    await h.sendImage(user.phoneE164, 'img:rosa');
    await h.sendImage(user.phoneE164, 'img:juan');
    await h.sendText(user.phoneE164, 'vendí 5 soles de pan');
    await h.drain();
  }

  // -------------------------------------------------------------------------------------------
  // HU-06
  // -------------------------------------------------------------------------------------------

  it('HU-06 (1): at her close time one message: image + caption with entró, salió, cash question last, example and 7-day link', async () => {
    const h = createCloseHarness(db, { start: limaInstant(TUE, 8) });
    const user = await createOnboardedUser(db);
    await normalDay(h, user);

    h.clock.setLima(TUE, 20, 55);
    expect((await h.runSender([user.id])).sent).toBe(0);
    h.clock.setLima(TUE, 21, 0);
    expect((await h.runSender([user.id])).sent).toBe(1);
    // Idempotent: the next tick sends nothing.
    h.clock.setLima(TUE, 21, 5);
    expect((await h.runSender([user.id])).sent).toBe(0);

    const out = h.outbound(user.phoneE164);
    expect(out).toHaveLength(1);
    const [close] = out;
    expect(close?.catalogId).toBe('WA-10');
    expect(close?.content.type).toBe('image');
    const text = h.textOf(close as NonNullable<typeof close>);
    expect(text.length).toBeLessThanOrEqual(1024);
    expect(text).toMatch(/^📒 Tu cierre del martes 10\n/);
    expect(text).toContain('Entró: S/ 37,50 (Yape y Plin S/ 32,50, efectivo S/ 5)');
    expect(text).toContain('Salió: S/ 0');
    expect(text).toContain('Tu caja debería tener S/ 5 más que en la mañana. ¿Cuadra?');
    expect(text).toContain('Respóndeme en un solo mensaje o audio, por ejemplo:');
    expect(text).toMatch(/Ver todo \(vale 7 días\): https:\/\/alza\.test\/app\/entrar\/\S+$/);
    expect(text.toLowerCase()).not.toContain('ganancia');

    const row = await h.closeOf(user.id, TUE);
    expect(row).toMatchObject({
      status: 'sent',
      expectedCashChangeCents: 500,
      closeWaMessageId: close?.waMessageId,
      composition: { format: 'image', summaryImage: true, imageFailed: false, doubtsInMessage: 0 },
    });
  });

  it('HU-06 (2): she did not write in the last 24 hours → nothing (RF-CI-02)', async () => {
    const h = createCloseHarness(db, { start: limaInstant(TUE, 21, 0) });
    const user = await createOnboardedUser(db);
    await createEntry(
      db,
      {
        userId: user.id,
        businessDay: TUE,
        amountCents: 1_000,
        direction: 'in',
        paymentMethod: 'cash',
        category: 'sale',
        label: 'self_reported',
        source: 'web',
      },
      SYSTEM,
    );
    await db
      .update(users)
      .set({ lastMessageAt: limaInstant('2026-11-09', 20, 30) })
      .where(eq(users.id, user.id));
    expect(await h.runSender([user.id])).toMatchObject({ sent: 0 });
    expect(h.outbound(user.phoneE164)).toEqual([]);
    expect(await h.closeOf(user.id, TUE)).toBeUndefined();
  });

  it('PR16: a day with no entry and no doubt gets no close, even inside the window', async () => {
    const h = createCloseHarness(db, { start: limaInstant(TUE, 10) });
    const user = await createOnboardedUser(db);
    await h.sendText(user.phoneE164, 'hola');
    await h.drain();
    h.clock.setLima(TUE, 21, 0);
    expect((await h.runSender([user.id])).sent).toBe(0);
    expect(h.outbound(user.phoneE164)).toEqual([]);
    expect(await h.closeOf(user.id, TUE)).toBeUndefined();
  });

  it('HU-06 (3): on Sunday the close carries the weekly block (D38, PR02)', async () => {
    const h = createCloseHarness(db, { start: limaInstant(SUN, 9) });
    const user = await createOnboardedUser(db);
    for (const [day, cents] of [
      ['2026-11-09', 10_000],
      ['2026-11-12', 5_000],
    ] as const) {
      await createEntry(
        db,
        {
          userId: user.id,
          businessDay: day,
          amountCents: cents,
          direction: 'in',
          paymentMethod: 'cash',
          category: 'sale',
          label: 'self_reported',
          source: 'text',
        },
        SYSTEM,
      );
      await db.insert(dailyCloses).values({
        userId: user.id,
        businessDay: day,
        status: 'final',
        level: 'complete',
        sentAt: limaInstant(day, 21),
        repliedAt: limaInstant(day, 21, 10),
        finalAt: limaInstant(day, 23),
        composition: {
          format: 'image',
          summaryImage: true,
          imageFailed: false,
          weeklySummaryWeek: null,
          doubtsInMessage: 0,
          webCount: 0,
          notices: [],
        },
      });
    }
    h.ai.text('vendí 30 de gaseosas', cashSale('30.00', 'gaseosas'));
    await h.sendText(user.phoneE164, 'vendí 30 de gaseosas');
    await h.drain();

    // «Sin cierre» counts from her first day only (Mon and Thu complete; Sunday not final yet).
    const fromMonday = await weekForClose(db, user.id, SUN, '2026-11-09');
    expect(fromMonday?.summary).toMatchObject({ completeCount: 2, noCloseCount: 4 });
    const fromThursday = await weekForClose(db, user.id, SUN, '2026-11-12');
    expect(fromThursday?.summary.noCloseCount).toBe(2);

    h.clock.setLima(SUN, 21, 0);
    await h.runSender([user.id]);
    const text = h.textOf(h.outbound(user.phoneE164)[0] as never);
    expect(text).toContain(
      '📅 Tu semana: entró S/ 180, salió S/ 0, te quedó S/ 180, 2 cierres completos.\nEsta semana no comparo porque faltaron cierres completos.\nVer todo (vale 7 días):',
    );
    expect((await h.closeOf(user.id, SUN))?.composition).toMatchObject({
      weeklySummaryWeek: '2026-11-09',
    });

    // The first close after a Sunday without close carries that week (D11, 11.11).
    const h2 = createCloseHarness(db, { start: limaInstant('2026-11-17', 9) });
    const other = await createOnboardedUser(db);
    await db.insert(dailyCloses).values({
      userId: other.id,
      businessDay: '2026-11-08',
      status: 'final',
      level: 'complete',
      sentAt: limaInstant('2026-11-08', 21),
      finalAt: limaInstant('2026-11-09', 12),
      composition: {
        format: 'image',
        summaryImage: true,
        imageFailed: false,
        weeklySummaryWeek: '2026-11-02',
        doubtsInMessage: 0,
        webCount: 0,
        notices: [],
      },
    });
    h2.ai.text('vendí 8 de pan', cashSale('8.00'));
    await h2.sendText(other.phoneE164, 'vendí 8 de pan');
    await h2.drain();
    h2.clock.setLima('2026-11-17', 21, 0);
    await h2.runSender([other.id]);
    expect(h2.textOf(h2.outbound(other.phoneE164)[0] as never)).toContain('📅 Tu semana:');
    expect((await h2.closeOf(other.id, '2026-11-17'))?.composition).toMatchObject({
      weeklySummaryWeek: '2026-11-09',
    });
  });

  // -------------------------------------------------------------------------------------------
  // «cierre» (RF-CI-03, D39, D49, D54)
  // -------------------------------------------------------------------------------------------

  it('«cierre»: empty day → WA-21 (D39); with records → WA-10 now; again → WA-22, also once answered (D54)', async () => {
    const h = createCloseHarness(db, { start: limaInstant(TUE, 10) });
    const user = await createOnboardedUser(db);
    h.ai.text('cierre', { intent: 'close_now' });
    await h.sendText(user.phoneE164, 'cierre');
    await h.drain();
    expect(h.outbound(user.phoneE164).map((m) => m.catalogId)).toEqual(['WA-21']);
    expect(h.textOf(h.outbound(user.phoneE164)[0] as never)).toBe(
      'Hoy todavía no tengo nada anotado. Cuando me mandes tus capturas o ventas, te armo tu cierre.',
    );
    expect(await h.closeOf(user.id, TUE)).toBeUndefined();

    h.ai.text('vendí 5 soles de pan', cashSale('5.00'));
    await h.sendText(user.phoneE164, 'vendí 5 soles de pan');
    h.clock.setLima(TUE, 15);
    await h.sendText(user.phoneE164, 'cierre');
    await h.drain();
    expect(h.outbound(user.phoneE164).map((m) => m.catalogId)).toEqual(['WA-21', 'WA-10']);

    h.clock.setLima(TUE, 15, 5);
    await h.sendText(user.phoneE164, 'cierre');
    await h.drain();
    expect(h.outbound(user.phoneE164).at(-1)).toMatchObject({ catalogId: 'WA-22' });
    expect(h.textOf(h.outbound(user.phoneE164).at(-1) as never)).toBe(
      'Tu cierre de hoy está más arriba 👆',
    );

    // Her close time arrives: already sent, nothing else.
    h.clock.setLima(TUE, 21, 0);
    expect((await h.runSender([user.id])).sent).toBe(0);

    h.ai.text('sí', { intent: 'close_reply' });
    h.closeAi.reply('sí', {
      answers: [{ number: 1, resolved: true, value: { cash_check: 'balanced' } }],
    });
    await h.sendText(user.phoneE164, 'sí');
    await h.drain();
    await h.sendText(user.phoneE164, 'cierre');
    await h.drain();
    expect(h.outbound(user.phoneE164).map((m) => m.catalogId)).toEqual([
      'WA-21',
      'WA-10',
      'WA-22',
      'WA-12',
      'WA-22',
    ]);
  });

  // -------------------------------------------------------------------------------------------
  // HU-07
  // -------------------------------------------------------------------------------------------

  /** Tuesday with an unreadable screenshot and «hoy vendí 150»: 1 total, 2 unreadable, 3 cash. */
  async function dayWithTwoDoubts(h: ReturnType<typeof createCloseHarness>, user: User) {
    h.clock.setLima(TUE, 11, 42);
    h.reader.set(
      'img:blur',
      receiptExtraction({ amount: null, occurredAt: limaInstant(TUE, 11, 40).toISOString() }),
    );
    h.ai.text('vendí 5 soles de pan', cashSale('5.00'));
    h.ai.text('hoy vendí 150', dayTotal('150.00', 'unknown'));
    await h.sendImage(user.phoneE164, 'img:blur');
    await h.sendText(user.phoneE164, 'vendí 5 soles de pan');
    h.clock.setLima(TUE, 20);
    await h.sendText(user.phoneE164, 'hoy vendí 150');
    await h.drain();
    h.clock.setLima(TUE, 21, 0);
    await h.runSender([user.id]);
  }

  it('HU-07 (1): «1 solo efectivo, 2 son 12, 3 sí» resolves everything → complete, WA-12 with points', async () => {
    const h = createCloseHarness(db, { start: limaInstant(TUE, 8) });
    const user = await createOnboardedUser(db);
    await dayWithTwoDoubts(h, user);
    const caption = h.textOf(h.outbound(user.phoneE164)[0] as never);
    expect(caption).toContain('Tengo 3 dudas:');
    expect(caption).toContain('1️⃣ Dijiste «hoy vendí 150». ¿Es todo el día o solo efectivo?');
    expect(caption).toContain('2️⃣ Una captura de las 11:40 a. m. no se lee bien. ¿De cuánto era?');
    expect(caption).toContain('3️⃣ Tu caja debería tener S/ 5 más que en la mañana. ¿Cuadra?');
    expect(caption).toContain('por ejemplo: «1 solo efectivo, 2 son 12 soles, 3 sí».');
    const doubts = await doubtsOf(user.id);
    expect(doubts.map((d) => [d.type, d.status, d.messageNumber])).toEqual([
      ['unreadable', 'in_message', 2],
      ['ambiguous_total', 'in_message', 1],
    ]);

    const reply = '1 solo efectivo, 2 son 12, 3 sí';
    h.clock.setLima(TUE, 21, 3);
    h.ai.text(reply, { intent: 'close_reply' });
    h.closeAi.reply(reply, {
      answers: [
        { number: 1, resolved: true, value: { scope: 'day_total', payment_method: 'cash' } },
        { number: 2, resolved: true, value: { amount: '12.00' } },
        { number: 3, resolved: true, value: { cash_check: 'balanced' } },
      ],
    });
    await h.sendText(user.phoneE164, reply);
    await h.drain();

    expect(h.closeAi.calls[0]?.questions.map((q) => [q.number, q.type])).toEqual([
      [1, 'ambiguous_total'],
      [2, 'unreadable'],
      [3, 'cash_check'],
    ]);
    const entries = await entriesOf(user.id);
    expect(
      entries.map((e) => [e.amountCents, e.paymentMethod, e.label, e.source, e.afterClose]),
    ).toEqual([
      [500, 'cash', 'self_reported', 'text', false],
      // PR09 via «solo efectivo»: 150 − 5.
      [14_500, 'cash', 'unitemized', 'close_reply', false],
      [1_200, 'yape', 'self_reported', 'close_reply', false],
    ]);
    expect((await doubtsOf(user.id)).every((d) => d.status === 'resolved')).toBe(true);
    const close = await h.closeOf(user.id, TUE);
    expect(close).toMatchObject({ status: 'replied', level: 'complete', cashCheck: 'balanced' });
    expect(close?.repliedAt?.toISOString()).toBe(limaInstant(TUE, 21, 3).toISOString());

    const last = h.outbound(user.phoneE164).at(-1);
    expect(last?.catalogId).toBe('WA-12');
    expect(h.textOf(last as never)).toMatch(
      /^✅ Martes cerrado completo\.\n\+10 ⭐ · Tienes 10\. Te faltan \d+ para .+\.$/,
    );
    expect(h.outbound(user.phoneE164)).toHaveLength(2);
  });

  it('D66: an unreadable screenshot answered in the close keeps its app, never «sin detalle»', async () => {
    const h = createCloseHarness(db, { start: limaInstant(TUE, 8) });
    const user = await createOnboardedUser(db);
    h.clock.setLima(TUE, 10);
    // The reader saw the Plin header but not the method or the amount.
    h.reader.set(
      'img:plin-blur',
      screenshotExtractionSchema.parse({
        content_type: 'individual_receipt',
        legible: false,
        operations: [
          {
            amount: null,
            payment_method: 'unknown',
            receipt_header: 'plin_received',
            holder_role: 'unknown',
            occurred_at: limaInstant(TUE, 9, 50).toISOString(),
          },
        ],
      }),
    );
    // Nothing at all could be read from this one.
    h.reader.set(
      'img:nothing',
      screenshotExtractionSchema.parse({
        content_type: 'individual_receipt',
        legible: false,
        operations: [],
      }),
    );
    await h.sendImage(user.phoneE164, 'img:plin-blur');
    h.clock.setLima(TUE, 10, 5);
    await h.sendImage(user.phoneE164, 'img:nothing');
    await h.drain();
    const doubts = await doubtsOf(user.id);
    expect(
      doubts.map((d) => [d.type, (d.detail as { paymentMethod?: string }).paymentMethod]),
    ).toEqual([
      ['unreadable', 'plin'],
      ['unreadable', undefined],
    ]);

    h.clock.setLima(TUE, 21, 0);
    await h.runSender([user.id]);
    const numbered = await doubtsOf(user.id);
    const plinNumber = numbered[0]?.messageNumber;
    const otherNumber = numbered[1]?.messageNumber;
    if (!plinNumber || !otherNumber) throw new Error('both doubts should be in the message');
    const reply = 'la de plin 15, la otra 8 por yape, la caja sí';
    h.ai.text(reply, { intent: 'close_reply' });
    h.closeAi.reply(reply, {
      answers: [
        // She names Yape for the first one too: the screenshot's Plin stays (evidence wins).
        { number: plinNumber, resolved: true, value: { amount: '15.00', payment_method: 'yape' } },
        { number: otherNumber, resolved: true, value: { amount: '8.00', payment_method: 'yape' } },
        { number: 3, resolved: true, value: { cash_check: 'balanced' } },
      ],
    });
    h.clock.setLima(TUE, 21, 4);
    await h.sendText(user.phoneE164, reply);
    await h.drain();

    const entries = await entriesOf(user.id);
    expect(entries.map((e) => [e.amountCents, e.paymentMethod, e.label, e.status])).toEqual([
      [1_500, 'plin', 'self_reported', 'confirmed'],
      [800, 'yape', 'self_reported', 'confirmed'],
    ]);
    expect(computeIndicators(entries)).toMatchObject({
      digitalSalesCents: 2_300,
      unknownMethodSalesCents: 0,
    });
  });

  it('HU-07 (2): «1 solo efectivo, 3 sí» → WA-11 only for 2; two rounds without it → partial', async () => {
    const h = createCloseHarness(db, { start: limaInstant(TUE, 8) });
    const user = await createOnboardedUser(db);
    await dayWithTwoDoubts(h, user);

    const send = async (text: string, answers: object[]) => {
      h.ai.text(text, { intent: 'close_reply' });
      h.closeAi.reply(text, { answers: answers as never });
      await h.sendText(user.phoneE164, text);
      await h.drain();
    };
    h.clock.setLima(TUE, 21, 5);
    await send('1 solo efectivo, 3 sí', [
      { number: 1, resolved: true, value: { payment_method: 'cash', scope: 'day_total' } },
      { number: 3, resolved: true, value: { cash_check: 'balanced' } },
    ]);
    let out = h.outbound(user.phoneE164);
    expect(out.at(-1)?.catalogId).toBe('WA-11');
    expect(h.textOf(out.at(-1) as never)).toBe(
      'No entendí el punto 2: una captura de las 11:40 a. m. no se lee bien. ¿De cuánto era? ¿Me lo dices de nuevo?',
    );
    expect(await h.closeOf(user.id, TUE)).toMatchObject({
      status: 'awaiting_clarification',
      clarificationRounds: 1,
      level: 'partial',
      cashCheck: 'balanced',
    });

    h.clock.setLima(TUE, 21, 8);
    await send('ya te dije', []);
    // Only the point asked again goes to the model.
    expect(h.closeAi.calls.at(-1)?.questions.map((q) => q.number)).toEqual([2]);
    out = h.outbound(user.phoneE164);
    expect(out.map((m) => m.catalogId)).toEqual(['WA-10', 'WA-11', 'WA-11']);

    h.clock.setLima(TUE, 21, 9);
    await send('no me acuerdo', [{ number: 2, resolved: false, value: {} }]);
    out = h.outbound(user.phoneE164);
    expect(out.map((m) => m.catalogId)).toEqual(['WA-10', 'WA-11', 'WA-11', 'WA-12']);
    expect(h.textOf(out.at(-1) as never)).toMatch(/^✅ Martes cerrado a medias\.\n\+4 ⭐/);
    expect(await h.closeOf(user.id, TUE)).toMatchObject({
      status: 'replied',
      level: 'partial',
      clarificationRounds: 2,
    });
  });

  it('HU-07 (3): «no, saqué 40 para la casa» → cash out S/ 40 household «Lo contaste tú», cash adjusted, complete', async () => {
    const h = createCloseHarness(db, { start: limaInstant(TUE, 8) });
    const user = await createOnboardedUser(db);
    await normalDay(h, user);
    h.clock.setLima(TUE, 21, 0);
    await h.runSender([user.id]);
    const closeId = h.outbound(user.phoneE164)[0]?.waMessageId as string;

    const reply = 'no, saqué 40 para la casa';
    h.closeAi.reply(reply, {
      answers: [{ number: 1, resolved: true, value: { cash_check: 'not_balanced' } }],
      new_entries: [
        {
          amount: '40.00',
          payment_method: 'cash',
          direction: 'out',
          category: 'household',
          description: 'para la casa',
        },
      ],
    });
    h.clock.setLima(TUE, 21, 2);
    // WhatsApp «responder» on the close: no text interpretation needed.
    await h.sendText(user.phoneE164, reply, { replyTo: closeId });
    await h.drain();
    expect(h.ai.calls.filter((c) => c.input === reply)).toEqual([]);

    const added = (await entriesOf(user.id)).at(-1);
    expect(added).toMatchObject({
      amountCents: 4_000,
      direction: 'out',
      paymentMethod: 'cash',
      category: 'household',
      label: 'self_reported',
      source: 'close_reply',
      status: 'confirmed',
    });
    expect(await h.closeOf(user.id, TUE)).toMatchObject({
      level: 'complete',
      cashCheck: 'adjusted',
    });
    expect(h.outbound(user.phoneE164).at(-1)?.catalogId).toBe('WA-12');
  });

  it('HU-07 (4): «no sé» about the cash → partial and «Caja sin revisar»', async () => {
    const h = createCloseHarness(db, { start: limaInstant(TUE, 8) });
    const user = await createOnboardedUser(db);
    await normalDay(h, user);
    h.clock.setLima(TUE, 21, 0);
    await h.runSender([user.id]);
    h.ai.text('no sé', { intent: 'close_reply' });
    h.closeAi.reply('no sé', {
      answers: [{ number: 1, resolved: true, value: { cash_check: 'unsure' } }],
    });
    h.clock.setLima(TUE, 21, 4);
    await h.sendText(user.phoneE164, 'no sé');
    await h.drain();
    expect(await h.closeOf(user.id, TUE)).toMatchObject({ level: 'partial', cashCheck: 'unsure' });
    const view = await getDayEntries(db, user.id, TUE, h.clock.now());
    expect(view.day.cashUnreviewed).toBe(true);
    expect(view.day.tags).toContain('Caja sin revisar');
    expect(h.textOf(h.outbound(user.phoneE164).at(-1) as never)).toMatch(/cerrado a medias/);
  });

  it('a retried reply job is applied once (FlowHooks idempotency); the model is asked once', async () => {
    const h = createCloseHarness(db, { start: limaInstant(TUE, 8) });
    const user = await createOnboardedUser(db);
    await normalDay(h, user);
    h.clock.setLima(TUE, 21, 0);
    await h.runSender([user.id]);
    const reply = 'no, saqué 40 para la casa';
    h.ai.text(reply, { intent: 'close_reply' });
    h.closeAi.reply(reply, {
      answers: [{ number: 1, resolved: true, value: { cash_check: 'not_balanced' } }],
      new_entries: [
        { amount: '40.00', payment_method: 'cash', direction: 'out', category: 'household' },
      ],
    });
    h.clock.setLima(TUE, 21, 2);
    const waMessageId = await h.sendText(user.phoneE164, reply);
    await h.drain();

    // The same hand-off again, as a retried job would do it.
    const [message] = await db
      .select()
      .from(inboundMessages)
      .where(eq(inboundMessages.waMessageId, waMessageId));
    if (!message) throw new Error('no inbound message');
    await applyCloseReply(h.closeDeps, {
      user,
      message: toFlowMessage(message),
      text: reply,
      businessDay: TUE,
      timing: 'on_time',
      via: 'intent',
    });
    expect((await entriesOf(user.id)).filter((e) => e.source === 'close_reply')).toHaveLength(1);
    expect(h.outbound(user.phoneE164).filter((m) => m.catalogId === 'WA-12')).toHaveLength(1);
    expect(h.closeAi.calls).toHaveLength(1);
    const saved = await db
      .select()
      .from(extractions)
      .where(
        and(
          eq(extractions.inboundMessageId, message.id),
          eq(extractions.function, 'interpret_close_reply'),
        ),
      );
    expect(saved).toHaveLength(1);
  });

  // -------------------------------------------------------------------------------------------
  // Cases 19–20 (late reply), RF-CI-10, D37/D50
  // -------------------------------------------------------------------------------------------

  it('case 20: a reply after 12:00 of the next day is applied, improved level only, WA-18', async () => {
    const h = createCloseHarness(db, { start: limaInstant(TUE, 8) });
    const user = await createOnboardedUser(db);
    await normalDay(h, user);
    h.clock.setLima(TUE, 21, 0);
    await h.runSender([user.id]);
    // The 12:00 job made it final without a reply (Fase 6).
    await db
      .update(dailyCloses)
      .set({
        status: 'final',
        level: 'no_close',
        cashCheck: 'no_answer',
        finalAt: limaInstant(WED, 12),
      })
      .where(and(eq(dailyCloses.userId, user.id), eq(dailyCloses.businessDay, TUE)));

    h.clock.setLima(WED, 12, 30);
    h.ai.text('sí cuadra', { intent: 'close_reply' });
    h.closeAi.reply('sí cuadra', {
      answers: [{ number: 1, resolved: true, value: { cash_check: 'balanced' } }],
    });
    await h.sendText(user.phoneE164, 'sí cuadra');
    await h.drain();
    expect(await h.closeOf(user.id, TUE)).toMatchObject({
      status: 'final',
      level: 'no_close',
      improvedLevel: 'complete',
      cashCheck: 'balanced',
    });
    const last = h.outbound(user.phoneE164).at(-1);
    expect(last?.catalogId).toBe('WA-18');
    expect(h.textOf(last as never)).toBe('Lo anoté. Como pasó la hora, ya no suma puntos.');
  });

  it('case 19: a reply at 11:50 of the next day is on time (WA-12)', async () => {
    const h = createCloseHarness(db, { start: limaInstant(TUE, 8) });
    const user = await createOnboardedUser(db);
    await normalDay(h, user);
    h.clock.setLima(TUE, 21, 0);
    await h.runSender([user.id]);
    h.clock.setLima(WED, 11, 50);
    h.ai.text('cuadra', { intent: 'close_reply' });
    h.closeAi.reply('cuadra', {
      answers: [{ number: 1, resolved: true, value: { cash_check: 'balanced' } }],
    });
    await h.sendText(user.phoneE164, 'cuadra');
    await h.drain();
    expect(await h.closeOf(user.id, TUE)).toMatchObject({ status: 'replied', level: 'complete' });
    expect(h.outbound(user.phoneE164).at(-1)?.catalogId).toBe('WA-12');
  });

  it('RF-CI-10: if the image cannot be made, the close goes as text', async () => {
    const h = createCloseHarness(db, {
      start: limaInstant(TUE, 8),
      renderImage: async () => {
        throw new Error('render down');
      },
    });
    const user = await createOnboardedUser(db);
    await normalDay(h, user);
    h.clock.setLima(TUE, 21, 0);
    await h.runSender([user.id]);
    const [close] = h.outbound(user.phoneE164);
    expect(close?.catalogId).toBe('WA-10');
    expect(close?.content.type).toBe('text');
    expect(h.textOf(close as never)).toContain('📒 Tu cierre del martes 10');
    expect((await h.closeOf(user.id, TUE))?.composition).toMatchObject({
      format: 'text',
      imageFailed: true,
      summaryImage: true,
    });
  });

  /** Seven possible duplicates with very long names (texts ~190 characters each). */
  async function manyDoubts(userId: string) {
    for (let i = 0; i < 7; i++) {
      const entry = await createEntry(
        db,
        {
          userId,
          businessDay: TUE,
          amountCents: 2_000 + i * 100,
          direction: 'in',
          paymentMethod: 'yape',
          category: 'sale',
          label: 'screenshot',
          status: 'pending',
          source: 'screenshot',
          counterparty: `Comercializadora y Distribuidora de Abarrotes del Norte Número ${i} Sociedad Anónima Cerrada`,
          operationAt: limaInstant(TUE, 15, 10 + i),
        },
        SYSTEM,
      );
      await createClarification(db, {
        userId,
        businessDay: TUE,
        type: 'possible_duplicate',
        ledgerEntryId: entry.id,
      });
    }
    await createClarification(db, {
      userId,
      businessDay: TUE,
      type: 'missing_from_list',
      detail: {
        row: {
          amountCents: 900,
          direction: 'in',
          paymentMethod: 'yape',
          counterparty: 'Ana',
          operationNumber: null,
          operationAt: null,
        },
      },
    });
  }

  it('D37/D50: doubts enter while they fit (1,024 with image, 4,096 text only, max 5); the rest go to the web', async () => {
    const h = createCloseHarness(db, { start: limaInstant(TUE, 9) });
    const user = await createOnboardedUser(db);
    await manyDoubts(user.id);
    await db
      .update(users)
      .set({ lastMessageAt: limaInstant(TUE, 9) })
      .where(eq(users.id, user.id));
    h.clock.setLima(TUE, 21, 0);
    await h.runSender([user.id]);
    const caption = h.textOf(h.outbound(user.phoneE164)[0] as never);
    expect(caption.length).toBeLessThanOrEqual(1024);
    const inMessage = (await doubtsOf(user.id)).filter((d) => d.status === 'in_message');
    expect(inMessage.length).toBeGreaterThan(0);
    expect(inMessage.length).toBeLessThan(5);
    // Highest amount first at equal priority (11.8).
    expect(caption).toContain('1️⃣ Mandaste dos Yapes de S/ 26 de Comercializadora');
    const k = 8 - inMessage.length;
    expect(caption).toContain(`Tienes ${k} cosas más por revisar en la web.`);
    expect(caption).toContain(
      `${inMessage.length + 1}️⃣ Tu caja debería tener lo mismo que en la mañana. ¿Cuadra?`,
    );
    expect((await doubtsOf(user.id)).filter((d) => d.status === 'in_web')).toHaveLength(k);

    // Text only (D27, D50): 5 doubts fit in 4,096; the cash question is the 6th.
    const h2 = createCloseHarness(db, { start: limaInstant(TUE, 9) });
    const textUser = await createOnboardedUser(db);
    await db
      .update(users)
      .set({ summaryImage: false, lastMessageAt: limaInstant(TUE, 9) })
      .where(eq(users.id, textUser.id));
    await manyDoubts(textUser.id);
    h2.clock.setLima(TUE, 21, 0);
    await h2.runSender([textUser.id]);
    const [message] = h2.outbound(textUser.phoneE164);
    expect(message?.content.type).toBe('text');
    const body = h2.textOf(message as never);
    expect(body.length).toBeGreaterThan(1024);
    expect(body.length).toBeLessThanOrEqual(4096);
    expect(body).toContain('Tengo 6 dudas:');
    expect(body).toContain('6️⃣ Tu caja debería tener');
    expect(body).toContain('Tienes 3 cosas más por revisar en la web.');
    // D27: the first close after choosing «solo texto» says so.
    expect(body).toContain(
      'Desde hoy tu resumen va solo en texto. Para volver a la imagen, escribe “con imagen”.',
    );
    expect((await h2.closeOf(textUser.id, TUE))?.composition).toMatchObject({
      format: 'text',
      summaryImage: false,
      doubtsInMessage: 5,
    });
  });

  it('D28 and D27 lines appear once: the next close no longer carries them', async () => {
    const h = createCloseHarness(db, { start: limaInstant(TUE, 9) });
    const user = await createOnboardedUser(db);
    await db.update(users).set({ summaryImage: false }).where(eq(users.id, user.id));
    await recordPinLockoutNotice(db, user.id, limaInstant(TUE, 9), null);
    h.ai.text('vendí 5 soles de pan', cashSale('5.00'));
    await h.sendText(user.phoneE164, 'vendí 5 soles de pan');
    await h.drain();
    h.clock.setLima(TUE, 21);
    await h.runSender([user.id]);
    const first = h.textOf(h.outbound(user.phoneE164)[0] as never);
    expect(first).toContain(
      'Alguien intentó entrar a tu web con un PIN incorrecto. Si no fuiste tú, cambia tu PIN.',
    );
    expect(first).toContain('Desde hoy tu resumen va solo en texto.');

    h.clock.setLima(WED, 9);
    await h.sendText(user.phoneE164, 'vendí 5 soles de pan');
    await h.drain();
    h.clock.setLima(WED, 21);
    await h.runSender([user.id]);
    const second = h.textOf(h.outbound(user.phoneE164)[1] as never);
    expect(second).toContain('📒 Tu cierre del miércoles 11');
    expect(second).not.toContain('PIN incorrecto');
    expect(second).not.toContain('solo en texto');
  });

  it('D40: a digital total above the screenshots → «Faltan S/ X en capturas» line, outside the doubts', async () => {
    const h = createCloseHarness(db, { start: limaInstant(TUE, 9) });
    const user = await createOnboardedUser(db);
    h.reader.set(
      'img:60',
      receiptExtraction({
        amount: '60.00',
        counterparty: 'Rosa Quispe',
        occurredAt: limaInstant(TUE, 8, 50).toISOString(),
        operationNumber: '20000001',
      }),
    );
    h.ai.text('hoy me yapearon 100', dayTotal('100.00', 'yape'));
    await h.sendImage(user.phoneE164, 'img:60');
    await h.sendText(user.phoneE164, 'hoy me yapearon 100');
    await h.drain();
    h.clock.setLima(TUE, 21);
    await h.runSender([user.id]);
    const text = h.textOf(h.outbound(user.phoneE164)[0] as never);
    expect(text).toContain(
      'Salió: S/ 0\nFaltan S/ 40 en capturas. Si quieres, manda tu lista de movimientos.\n\nTu caja',
    );
    expect(text).toContain(`${TEST_BASE_URL}/app/entrar/`);
  });
});
