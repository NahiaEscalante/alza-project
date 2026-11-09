/**
 * The 7 «días tipo» of `docs/ALZA_INSUMOS_PENDIENTES.md` (section 4), end to end: her messages go
 * through the webhook and the pipeline, the close goes out with the 5-minute job (or «cierre»),
 * she answers, and the day ends with its level and points. Fixed clock, fake AI, simulated channel.
 */
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, hasTestDb } from '../../../test/db.js';
import { ensureRewardsCatalog } from '../../account/index.js';
import { clarifications, ledgerEntries, streaks, type User, users } from '../../db/schema.js';
import { computeIndicators, limaInstant } from '../../domain/index.js';
import { finalizeDay } from '../../jobs/finalize-closes.js';
import { cashSale, createOnboardedUser, receiptExtraction } from '../../pipeline/test-support.js';
import { createCloseHarness, dayTotal, type FakeCloseReply } from './test-support.js';

const TUE = '2026-11-10';
const WED = '2026-11-11';
const SAT = '2026-11-14';
const SUN = '2026-11-15';

type H = ReturnType<typeof createCloseHarness>;

describe.skipIf(!hasTestDb)('días tipo (insumos, sección 4)', () => {
  const { pool, db } = createTestDb();
  beforeAll(() => ensureRewardsCatalog(db));
  afterAll(() => pool.end());

  const entriesOf = (userId: string) =>
    db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.userId, userId))
      .orderBy(asc(ledgerEntries.createdAt));
  const liveEntriesOf = async (userId: string, day: string) =>
    (await entriesOf(userId)).filter(
      (e) => e.businessDay === day && (e.status === 'confirmed' || e.status === 'pending'),
    );

  function screenshot(h: H, key: string, amount: string | null, at: Date, extra = {}) {
    h.reader.set(
      key,
      receiptExtraction({
        amount,
        counterparty: 'Rosa Quispe',
        occurredAt: at.toISOString(),
        ...extra,
      }),
    );
  }

  /** Her answer: interpreted as `close_reply`, then by the close-reply model. */
  async function reply(h: H, user: User, text: string, interpretation: FakeCloseReply) {
    h.ai.text(text, { intent: 'close_reply' });
    h.closeAi.reply(text, interpretation);
    await h.sendText(user.phoneE164, text);
    await h.drain();
  }

  const lastText = (h: H, user: User) => h.textOf(h.outbound(user.phoneE164).at(-1) as never);

  it('1 · día normal, cierre completo', async () => {
    const h = createCloseHarness(db, { start: limaInstant(TUE, 8) });
    const user = await createOnboardedUser(db);
    h.clock.setLima(TUE, 9);
    screenshot(h, 'd1:a', '25.00', limaInstant(TUE, 8, 50), { operationNumber: '51000001' });
    screenshot(h, 'd1:b', '13.50', limaInstant(TUE, 8, 55), {
      operationNumber: '51000002',
      counterparty: 'Luis Rojas',
    });
    screenshot(h, 'd1:out', '150.00', limaInstant(TUE, 14), {
      header: 'yape_sent',
      counterparty: 'Distribuidora Sur',
      operationNumber: '51000003',
    });
    h.ai.text('vendí 5 soles de pan', cashSale('5.00'));
    h.ai.text('pagué 150 de mercadería al distribuidor', {
      intent: 'other',
    });
    await h.sendImage(user.phoneE164, 'd1:a');
    await h.sendImage(user.phoneE164, 'd1:b');
    await h.sendText(user.phoneE164, 'vendí 5 soles de pan');
    h.clock.setLima(TUE, 14, 1);
    await h.sendImage(user.phoneE164, 'd1:out');
    await h.drain();
    // Silent during the day (D04).
    expect(h.outbound(user.phoneE164)).toEqual([]);

    h.clock.setLima(TUE, 21);
    await h.runSender([user.id]);
    const close = lastText(h, user);
    expect(close).toContain('Entró: S/ 43,50 (Yape y Plin S/ 38,50, efectivo S/ 5)');
    // «¡Yapeaste!» sale (D36): without a known type it is «por clasificar» with a web doubt (PR15).
    expect(close).toMatch(/Salió: S\/ 150 \((mercadería|por clasificar) S\/ 150\)/);
    expect(close).toContain('Tu caja debería tener S/ 5 más que en la mañana. ¿Cuadra?');

    const doubts = await db.select().from(clarifications).where(eq(clarifications.userId, user.id));
    const cashNumber = doubts.filter((d) => d.status === 'in_message').length + 1;
    const answers = doubts
      .filter((d) => d.status === 'in_message')
      .map((d) => ({
        number: d.messageNumber as number,
        resolved: true,
        value: { category: 'inventory' as const },
      }));
    await reply(h, user, 'todo bien, cuadra', {
      answers: [
        ...answers,
        { number: cashNumber, resolved: true, value: { cash_check: 'balanced' } },
      ],
    });
    expect(await h.closeOf(user.id, TUE)).toMatchObject({
      level: 'complete',
      cashCheck: 'balanced',
    });
    expect(lastText(h, user)).toMatch(/^✅ Martes cerrado completo\.\n\+10 ⭐ · Tienes 10\./);

    // 12:00 of Wednesday (Fase 6): +10 points, streak 1.
    const outcome = await finalizeDay(db, user.id, TUE, limaInstant(WED, 12));
    expect(outcome).toMatchObject({ level: 'complete', points: 10, streakDays: 1 });
  });

  it('2 · día con duplicados y una captura ilegible', async () => {
    const h = createCloseHarness(db, { start: limaInstant(TUE, 8) });
    const user = await createOnboardedUser(db);
    h.clock.setLima(TUE, 10);
    screenshot(h, 'd2:rosa', '15.00', limaInstant(TUE, 9, 58), { operationNumber: '52000001' });
    // Two S/ 2 from the same child, no operation number, one minute apart (case 3).
    screenshot(h, 'd2:nino1', '2.00', limaInstant(TUE, 9, 10), {
      counterparty: 'Luis Niño',
      operationNumber: null,
    });
    screenshot(h, 'd2:nino2', '2.00', limaInstant(TUE, 9, 11), {
      counterparty: 'Luis Niño',
      operationNumber: null,
    });
    screenshot(h, 'd2:blur', null, limaInstant(TUE, 11, 42));
    await h.sendImage(user.phoneE164, 'd2:rosa');
    // The same file again (case 1): exact duplicate, no doubt.
    await h.sendImage(user.phoneE164, 'd2:rosa');
    await h.sendImage(user.phoneE164, 'd2:nino1');
    await h.sendImage(user.phoneE164, 'd2:nino2');
    h.clock.setLima(TUE, 11, 43);
    await h.sendImage(user.phoneE164, 'd2:blur');
    await h.drain();

    h.clock.setLima(TUE, 21);
    await h.runSender([user.id]);
    const close = lastText(h, user);
    expect(close).toContain('Entró: S/ 17 (Yape y Plin S/ 17, efectivo S/ 0)');
    expect(close).toContain(
      '1️⃣ Mandaste dos Yapes de S/ 2 de Luis Niño a las 9:11 a. m. ¿Fueron dos pagos?',
    );
    expect(close).toContain('2️⃣ Una captura de las 11:42 a. m. no se lee bien. ¿De cuánto era?');
    expect(close).toContain('3️⃣ Tu caja debería tener lo mismo que en la mañana. ¿Cuadra?');

    await reply(h, user, '1 fueron dos, 2 son 8 soles, 3 sí', {
      answers: [
        { number: 1, resolved: true, value: { is_duplicate: false } },
        { number: 2, resolved: true, value: { amount: '8.00' } },
        { number: 3, resolved: true, value: { cash_check: 'balanced' } },
      ],
    });
    const live = await liveEntriesOf(user.id, TUE);
    expect(computeIndicators(live).digitalSalesCents).toBe(2_700);
    expect(live.every((e) => e.status === 'confirmed')).toBe(true);
    expect(await h.closeOf(user.id, TUE)).toMatchObject({ level: 'complete' });
    expect(lastText(h, user)).toMatch(/cerrado completo/);
  });

  it('3 · la caja no cuadra y ella explica', async () => {
    const h = createCloseHarness(db, { start: limaInstant(TUE, 8) });
    const user = await createOnboardedUser(db);
    h.clock.setLima(TUE, 10);
    h.ai.text('vendí 80 de abarrotes', cashSale('80.00', 'abarrotes'));
    h.ai.text('vendí 34 de gaseosas', cashSale('34.00', 'gaseosas'));
    await h.sendText(user.phoneE164, 'vendí 80 de abarrotes');
    await h.sendText(user.phoneE164, 'vendí 34 de gaseosas');
    await h.drain();
    h.clock.setLima(TUE, 21);
    await h.runSender([user.id]);
    expect(lastText(h, user)).toContain(
      'Tu caja debería tener S/ 114 más que en la mañana. ¿Cuadra?',
    );

    h.clock.setLima(TUE, 21, 3);
    await reply(h, user, 'no, saqué 30 para la casa y pagué 20 del gas', {
      answers: [{ number: 1, resolved: true, value: { cash_check: 'not_balanced' } }],
      new_entries: [
        {
          amount: '30.00',
          payment_method: 'cash',
          direction: 'out',
          category: 'household',
          description: 'casa',
        },
        {
          amount: '20.00',
          payment_method: 'cash',
          direction: 'out',
          category: 'expense',
          description: 'gas',
        },
      ],
    });
    const added = (await entriesOf(user.id)).filter((e) => e.source === 'close_reply');
    expect(added.map((e) => [e.amountCents, e.category, e.label])).toEqual([
      [3_000, 'household', 'self_reported'],
      [2_000, 'expense', 'self_reported'],
    ]);
    expect(await h.closeOf(user.id, TUE)).toMatchObject({
      cashCheck: 'adjusted',
      level: 'complete',
    });
    const indicators = computeIndicators(await liveEntriesOf(user.id, TUE));
    expect(indicators).toMatchObject({ inCents: 11_400, outCents: 5_000, leftCents: 6_400 });
  });

  it('4 · día sin respuesta: sin cierre, usa comodín', async () => {
    const h = createCloseHarness(db, { start: limaInstant(TUE, 8) });
    const user = await createOnboardedUser(db);
    h.clock.setLima(TUE, 10);
    h.ai.text('vendí 12 de pan', cashSale('12.00'));
    await h.sendText(user.phoneE164, 'vendí 12 de pan');
    await h.drain();
    h.clock.setLima(TUE, 21);
    await h.runSender([user.id]);
    expect(h.outbound(user.phoneE164).map((m) => m.catalogId)).toEqual(['WA-10']);
    expect(await h.closeOf(user.id, TUE)).toMatchObject({
      status: 'sent',
      repliedAt: null,
      level: null,
    });

    const outcome = await finalizeDay(db, user.id, TUE, limaInstant(WED, 12));
    expect(outcome).toMatchObject({ level: 'no_close', points: 0, freezeUsed: true });
    const [streak] = await db.select().from(streaks).where(eq(streaks.userId, user.id));
    expect(streak?.freezesUsed).toBe(1);
    // ALZA never chases her: nothing else was sent.
    expect(h.outbound(user.phoneE164)).toHaveLength(1);
  });

  it('5 · un mensaje llega después del cierre (case 21 before her reply, PR03 after it)', async () => {
    const h = createCloseHarness(db, { start: limaInstant(TUE, 8) });
    const user = await createOnboardedUser(db);
    h.clock.setLima(TUE, 10);
    h.ai.text('vendí 20 de pan', cashSale('20.00'));
    await h.sendText(user.phoneE164, 'vendí 20 de pan');
    await h.drain();
    h.clock.setLima(TUE, 21);
    await h.runSender([user.id]);

    // Case 21: an audio of 20:59 arriving at 21:05, before her reply: joins the close.
    h.clock.setLima(TUE, 21, 5);
    h.ai.audio('audio:late', { text: 'vendí 6 de gaseosa' });
    h.ai.text('vendí 6 de gaseosa', cashSale('6.00', 'gaseosa'));
    await h.sendAudio(user.phoneE164, 'audio:late');
    await h.drain();
    h.clock.setLima(TUE, 21, 10);
    await reply(h, user, 'sí cuadra', {
      answers: [{ number: 1, resolved: true, value: { cash_check: 'balanced' } }],
    });
    expect(await h.closeOf(user.id, TUE)).toMatchObject({ level: 'complete' });

    // PR03: a screenshot of Tuesday after the reply → silent adjustment flagged.
    h.clock.setLima(TUE, 21, 40);
    screenshot(h, 'd5:late', '18.00', limaInstant(TUE, 21, 35), { operationNumber: '55000001' });
    await h.sendImage(user.phoneE164, 'd5:late');
    await h.drain();
    const before = h.outbound(user.phoneE164).length;
    const tuesday = await liveEntriesOf(user.id, TUE);
    expect(tuesday.map((e) => [e.amountCents, e.afterClose])).toEqual([
      [2_000, false],
      [600, false],
      [1_800, true],
    ]);
    expect(await h.closeOf(user.id, TUE)).toMatchObject({ level: 'complete' });

    // Wednesday's close mentions it in one line; nothing was sent in between.
    h.clock.setLima(WED, 9);
    h.ai.text('vendí 9 de leche', cashSale('9.00', 'leche'));
    await h.sendText(user.phoneE164, 'vendí 9 de leche');
    await h.drain();
    expect(h.outbound(user.phoneE164)).toHaveLength(before);
    h.clock.setLima(WED, 21);
    await h.runSender([user.id]);
    const close = lastText(h, user);
    expect(close).toContain('📒 Tu cierre del miércoles 11');
    expect(close).toContain('Agregaste S/ 18 al martes 10 después de su cierre.');
    expect(close).not.toContain('S/ 6 al');
  });

  it('6 · un total en efectivo mayor a lo anotado (PR09, case 26)', async () => {
    const h = createCloseHarness(db, { start: limaInstant(TUE, 8) });
    const user = await createOnboardedUser(db);
    h.clock.setLima(TUE, 10);
    h.ai.text('vendí 50 de arroz', cashSale('50.00', 'arroz'));
    h.ai.text('vendí 45 de azúcar', cashSale('45.00', 'azúcar'));
    h.ai.text('hoy vendí 200 en efectivo', dayTotal('200.00', 'cash'));
    h.ai.text('vendí 5 de pan', cashSale('5.00'));
    await h.sendText(user.phoneE164, 'vendí 50 de arroz');
    await h.sendText(user.phoneE164, 'vendí 45 de azúcar');
    h.clock.setLima(TUE, 19);
    await h.sendText(user.phoneE164, 'hoy vendí 200 en efectivo');
    h.clock.setLima(TUE, 19, 30);
    await h.sendText(user.phoneE164, 'vendí 5 de pan');
    await h.drain();

    h.clock.setLima(TUE, 21);
    await h.runSender([user.id]);
    const close = lastText(h, user);
    expect(close).toContain('Entró: S/ 205 (Yape y Plin S/ 0, efectivo S/ 205)');
    expect(close).toContain(
      'Ojo: anotaste S/ 95 en efectivo pero dijiste que vendiste S/ 200. Registré S/ 105 más. Si no es así, dímelo en tu respuesta.',
    );
    // The line is not a doubt: only the cash question.
    expect(close).not.toContain('Tengo');
    expect(close).toContain('Tu caja debería tener S/ 205 más que en la mañana. ¿Cuadra?');
    expect((await h.closeOf(user.id, TUE))?.composition).toMatchObject({
      notices: ['unitemized_cash'],
    });

    await reply(h, user, 'sí', {
      answers: [{ number: 1, resolved: true, value: { cash_check: 'balanced' } }],
    });
    expect(await h.closeOf(user.id, TUE)).toMatchObject({ level: 'complete' });
  });

  it('7 · noche con ventas después de medianoche (D12: corte a las 4:00)', async () => {
    const h = createCloseHarness(db, { start: limaInstant(SAT, 20) });
    const user = await createOnboardedUser(db);
    await db.update(users).set({ closeTime: '01:00' }).where(eq(users.id, user.id));
    const fresh = { ...user, closeTime: '01:00:00' };
    h.ai.text('vendí 10 de cerveza', cashSale('10.00', 'cerveza'));
    h.ai.text('vendí 5 de cigarros', cashSale('5.00', 'cigarros'));
    h.ai.text('vendí 7 de pan', cashSale('7.00'));
    h.clock.setLima(SAT, 22);
    await h.sendText(user.phoneE164, 'vendí 10 de cerveza');
    // 00:30 of the Sunday calendar date still belongs to Saturday (case 31).
    h.clock.setLima(SUN, 0, 30);
    await h.sendText(user.phoneE164, 'vendí 5 de cigarros');
    await h.drain();

    h.clock.setLima(SUN, 0, 55);
    expect((await h.runSender([fresh.id])).sent).toBe(0);
    h.clock.setLima(SUN, 1, 0);
    expect((await h.runSender([fresh.id])).sent).toBe(1);
    const close = lastText(h, user);
    expect(close).toContain('📒 Tu cierre del sábado 14');
    expect(close).toContain('Entró: S/ 15 (Yape y Plin S/ 0, efectivo S/ 15)');
    expect(close).not.toContain('📅 Tu semana');

    h.clock.setLima(SUN, 1, 10);
    await reply(h, user, 'sí', {
      answers: [{ number: 1, resolved: true, value: { cash_check: 'balanced' } }],
    });
    expect(lastText(h, user)).toMatch(/^✅ Sábado cerrado completo\./);

    // 04:10 is already Sunday's business day.
    h.clock.setLima(SUN, 4, 10);
    await h.sendText(user.phoneE164, 'vendí 7 de pan');
    await h.drain();
    expect((await liveEntriesOf(user.id, SAT)).map((e) => e.amountCents)).toEqual([1_000, 500]);
    expect((await liveEntriesOf(user.id, SUN)).map((e) => e.amountCents)).toEqual([700]);
    expect(
      await db
        .select()
        .from(clarifications)
        .where(and(eq(clarifications.userId, user.id))),
    ).toEqual([]);
  });
});
