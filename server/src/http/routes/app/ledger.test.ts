import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestDb, hasTestDb } from '../../../../test/db.js';
import {
  clarifications,
  counterpartyRules,
  dailyCloses,
  ledgerEntries,
  ledgerEntryEvents,
  pointsEntries,
} from '../../../db/schema.js';
import { limaInstant } from '../../../domain/index.js';
import { createClarification } from '../../../ledger/index.js';
import {
  addEntry,
  createTestApi,
  createTestUser,
  signedInBrowser,
  TestClock,
  TUESDAY_NIGHT,
} from './test-support.js';

describe.skipIf(!hasTestDb)('web ledger API', () => {
  const { pool, db } = createTestDb();
  afterAll(() => pool.end());

  async function setup() {
    const clock = new TestClock(TUESDAY_NIGHT);
    const app = createTestApi(db, clock);
    const user = await createTestUser(db);
    const phone = await signedInBrowser(app, db, user.id, clock.now());
    return { clock, app, user, phone };
  }

  /** Marta's Tuesday (11.6): entró 412, salió 180, te quedó 232. */
  async function martasTuesday(userId: string) {
    const day = '2026-11-10';
    for (const [amountCents, paymentMethod] of [
      [12_000, 'yape'],
      [9_800, 'yape'],
      [8_000, 'plin'],
    ] as const) {
      await addEntry(db, userId, {
        businessDay: day,
        amountCents,
        paymentMethod,
        operationAt: null,
      });
    }
    await addEntry(db, userId, {
      businessDay: day,
      amountCents: 11_400,
      paymentMethod: 'cash',
      label: 'self_reported',
      source: 'audio',
      counterparty: null,
    });
    await addEntry(db, userId, {
      businessDay: day,
      amountCents: 15_000,
      direction: 'out',
      category: 'inventory',
      counterparty: 'Distribuidora Sur',
    });
    await addEntry(db, userId, {
      businessDay: day,
      amountCents: 3_000,
      direction: 'out',
      paymentMethod: 'cash',
      category: 'household',
      label: 'self_reported',
      source: 'text',
      counterparty: null,
    });
  }

  it('Inicio: week totals from the domain (11.6), bars per day and the pending notice', async () => {
    const { user, phone } = await setup();
    await martasTuesday(user.id);
    const pendingEntry = await addEntry(db, user.id, { amountCents: 2_000, status: 'pending' });
    await createClarification(db, {
      userId: user.id,
      businessDay: '2026-11-10',
      type: 'possible_duplicate',
      ledgerEntryId: pendingEntry.id,
    });

    const res = await phone.get('/api/home');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const home = await res.json();
    expect(home.greeting).toEqual({ firstName: 'Marta', businessName: 'Bodega Sol' });
    expect(home.week).toMatchObject({
      weekStart: '2026-11-09',
      weekEnd: '2026-11-15',
      label: 'Semana del 9 al 15 nov',
      inCents: 41_200,
      outCents: 18_000,
      leftCents: 23_200,
      digitalSalesCents: 29_800,
      cashSalesCents: 11_400,
      pendingCents: 2_000,
    });
    expect(home.week.days).toHaveLength(7);
    expect(home.week.days[1]).toMatchObject({ businessDay: '2026-11-10', isToday: true });
    expect(home.week.days[6].isFuture).toBe(true);
    expect(home.pending).toEqual({ count: 1, notice: 'Tienes 1 cosa por revisar' });
    expect(home.points).toMatchObject({ balance: 0, milestones: [50, 100, 200, 400] });
    expect(JSON.stringify(home)).not.toMatch(/ganancia/i);
  });

  it('Movimientos: days with level and «Caja sin revisar», entries with their tags', async () => {
    const { user, phone } = await setup();
    await addEntry(db, user.id, { businessDay: '2026-11-09', amountCents: 38_000 });
    await db.insert(dailyCloses).values({
      userId: user.id,
      businessDay: '2026-11-09',
      status: 'replied',
      sentAt: limaInstant('2026-11-09', 21, 0),
      repliedAt: limaInstant('2026-11-09', 21, 3),
      cashCheck: 'unsure',
      level: 'partial',
    });
    await addEntry(db, user.id, { amountCents: 1_250 });
    await addEntry(db, user.id, {
      amountCents: 350,
      paymentMethod: 'cash',
      label: 'self_reported',
      source: 'audio',
      counterparty: null,
      operationAt: limaInstant('2026-11-10', 14, 5),
    });
    await addEntry(db, user.id, {
      amountCents: 2_000,
      status: 'pending',
      operationAt: limaInstant('2026-11-10', 16, 0),
    });

    const week = await (await phone.get('/api/days')).json();
    expect(week.from).toBe('2026-11-09');
    expect(week.to).toBe('2026-11-10');
    const [tuesday, monday] = week.days;
    expect(tuesday).toMatchObject({ businessDay: '2026-11-10', level: null, inCents: 1_600 });
    expect(monday).toMatchObject({
      businessDay: '2026-11-09',
      label: 'lunes 9',
      level: 'partial',
      levelText: 'a medias',
      cashUnreviewed: true,
      tags: ['Caja sin revisar'],
      inCents: 38_000,
    });

    const day = await (await phone.get('/api/days/2026-11-10/entries')).json();
    expect(day.canAddEntries).toBe(false);
    expect(day.entries.map((e: { time: string | null }) => e.time)).toEqual([
      '10:42',
      '14:05',
      '16:00',
    ]);
    expect(day.entries[0]).toMatchObject({
      amountCents: 1_250,
      paymentMethodText: 'Yape',
      counterparty: 'Ana Torres',
      labelText: 'Con captura',
      tags: ['Con captura'],
    });
    expect(day.entries[1]).toMatchObject({
      paymentMethodText: 'Efectivo',
      tags: ['Lo contaste tú'],
    });
    expect(day.entries[2]).toMatchObject({ isPending: true, countsInTotals: false });
    expect(day.entries[2].tags).toContain('Por confirmar');

    expect((await phone.get('/api/days/2026-11-11/entries')).status).toBe(400);
    expect((await phone.get('/api/days?from=2026-01-01&to=2026-11-10')).status).toBe(400);
  });

  it('HU-11: correcting S/12 → S/120 supersedes the original; the new one is «Lo contaste tú»', async () => {
    const { user, phone } = await setup();
    const original = await addEntry(db, user.id, {
      amountCents: 1_200,
      operationNumber: String(Date.now()).slice(-8),
    });

    const res = await phone.patch(`/api/entries/${original.id}`, { amountCents: 12_000 });
    expect(res.status).toBe(200);
    const { entry, replacedEntryId } = await res.json();
    expect(replacedEntryId).toBe(original.id);
    expect(entry).toMatchObject({
      amountCents: 12_000,
      label: 'self_reported',
      labelText: 'Lo contaste tú',
      status: 'confirmed',
    });

    const [old] = await db.select().from(ledgerEntries).where(eq(ledgerEntries.id, original.id));
    expect(old?.status).toBe('superseded');
    expect(old?.amountCents).toBe(1_200);
    const [fresh] = await db.select().from(ledgerEntries).where(eq(ledgerEntries.id, entry.id));
    expect(fresh).toMatchObject({
      replacesEntryId: original.id,
      source: 'web',
      createdBy: 'user',
      operationNumber: original.operationNumber,
    });
    expect(fresh?.operationNumber).not.toBeNull();

    const history = await (await phone.get(`/api/entries/${original.id}/history`)).json();
    expect(history.versions.map((v: { id: string }) => v.id)).toEqual([original.id, entry.id]);
    expect(history.versions[0]).toMatchObject({ status: 'superseded', labelText: 'Con captura' });
    const created = history.events.find(
      (e: { entryId: string; event: string }) => e.entryId === entry.id && e.event === 'created',
    );
    expect(created).toMatchObject({ actor: 'user:web' });
    expect(created.detail.changes.amountCents).toEqual({ from: 1_200, to: 12_000 });
    expect(history.events.some((e: { event: string }) => e.event === 'superseded')).toBe(true);

    const day = await (await phone.get('/api/days/2026-11-10/entries')).json();
    expect(day.entries.map((e: { id: string }) => e.id)).toEqual([entry.id]);
    // A superseded row cannot be edited again.
    expect((await phone.patch(`/api/entries/${original.id}`, { amountCents: 500 })).status).toBe(
      409,
    );
  });

  it('changing the type of an outgoing payment remembers it for that counterparty (PR14)', async () => {
    const { user, phone } = await setup();
    const payment = await addEntry(db, user.id, {
      amountCents: 6_000,
      direction: 'out',
      category: 'unclassified',
      counterparty: 'Distribuidora Sur',
    });
    const doubt = await createClarification(db, {
      userId: user.id,
      businessDay: '2026-11-10',
      type: 'category',
      ledgerEntryId: payment.id,
    });
    expect((await phone.patch(`/api/entries/${payment.id}`, { category: 'sale' })).status).toBe(
      400,
    );
    const res = await phone.patch(`/api/entries/${payment.id}`, { category: 'inventory' });
    expect(res.status).toBe(200);

    const rules = await db
      .select()
      .from(counterpartyRules)
      .where(eq(counterpartyRules.userId, user.id));
    expect(rules).toMatchObject([{ direction: 'out', category: 'inventory', source: 'memory' }]);
    const pending = await (await phone.get('/api/pending')).json();
    expect(pending.items.map((item: { id: string }) => item.id)).not.toContain(doubt.id);
  });

  it('«Quitar» voids the entry and drops it from the totals', async () => {
    const { user, phone } = await setup();
    const entry = await addEntry(db, user.id, { amountCents: 10_000 });
    const res = await phone.post(`/api/entries/${entry.id}/void`);
    expect(res.status).toBe(200);
    expect((await res.json()).entry.status).toBe('voided');
    const events = await db
      .select()
      .from(ledgerEntryEvents)
      .where(eq(ledgerEntryEvents.ledgerEntryId, entry.id));
    expect(events.map((e) => e.event).sort()).toEqual(['created', 'voided']);
    const week = await (await phone.get('/api/home')).json();
    expect(week.week.inCents).toBe(0);
  });

  it('adds entries only on past business days (D16)', async () => {
    const { phone } = await setup();
    const base = { amountCents: 500, direction: 'in', paymentMethod: 'cash' };
    for (const businessDay of ['2026-11-10', '2026-11-11']) {
      const res = await phone.post('/api/entries', { ...base, businessDay });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: 'invalid_day',
        message: 'Solo puedes agregar registros en días pasados.',
      });
    }
    const added = await phone.post('/api/entries', { ...base, businessDay: '2026-11-09' });
    expect(added.status).toBe(201);
    expect((await added.json()).entry).toMatchObject({
      businessDay: '2026-11-09',
      category: 'sale',
      labelText: 'Lo contaste tú',
    });
    const out = await phone.post('/api/entries', {
      ...base,
      direction: 'out',
      businessDay: '2026-11-09',
    });
    expect(out.status).toBe(400);
  });

  it('isolation (17.4): another user’s data answers «no encontrado»', async () => {
    const { user, phone } = await setup();
    const other = await createTestUser(db);
    const theirs = await addEntry(db, other.id, { amountCents: 9_900 });
    const theirDoubt = await createClarification(db, {
      userId: other.id,
      businessDay: '2026-11-10',
      type: 'unreadable',
    });
    await addEntry(db, user.id, { amountCents: 100 });

    for (const res of [
      await phone.patch(`/api/entries/${theirs.id}`, { amountCents: 1 }),
      await phone.post(`/api/entries/${theirs.id}/void`),
      await phone.get(`/api/entries/${theirs.id}/history`),
      await phone.post(`/api/pending/${theirDoubt.id}/resolve`, { action: 'dismiss' }),
    ]) {
      expect(res.status).toBe(404);
    }
    const day = await (await phone.get('/api/days/2026-11-10/entries')).json();
    expect(day.entries.map((e: { amountCents: number }) => e.amountCents)).toEqual([100]);
    const pending = await (await phone.get('/api/pending')).json();
    expect(pending.count).toBe(0);
    const [still] = await db.select().from(ledgerEntries).where(eq(ledgerEntries.id, theirs.id));
    expect(still?.status).toBe('confirmed');
    expect((await phone.patch('/api/entries/not-a-uuid', { amountCents: 1 })).status).toBe(404);
  });

  describe('Pendientes', () => {
    it('possible duplicate: question from 11.8 and «Sí, fueron dos» confirms it', async () => {
      const { user, phone } = await setup();
      const second = await addEntry(db, user.id, {
        amountCents: 2_000,
        counterparty: 'Rosa M.',
        status: 'pending',
        operationAt: limaInstant('2026-11-10', 15, 10),
      });
      const doubt = await createClarification(db, {
        userId: user.id,
        businessDay: '2026-11-10',
        type: 'possible_duplicate',
        ledgerEntryId: second.id,
        status: 'in_web',
      });

      const list = await (await phone.get('/api/pending')).json();
      expect(list.count).toBe(1);
      expect(list.items[0]).toMatchObject({
        id: doubt.id,
        dayLabel: 'martes 10',
        question: 'Mandaste dos Yapes de S/ 20 de Rosa M. a las 3:10 p. m. ¿Fueron dos pagos?',
        options: [
          { label: 'Sí, fueron dos', resolution: { action: 'confirm' } },
          { label: 'No, es el mismo', resolution: { action: 'mark_duplicate' } },
        ],
      });

      const res = await phone.post(`/api/pending/${doubt.id}/resolve`, { action: 'confirm' });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        outcome: 'confirmed',
        entry: { status: 'confirmed' },
        pending: { count: 0, notice: null },
      });
      const again = await phone.post(`/api/pending/${doubt.id}/resolve`, { action: 'confirm' });
      expect(again.status).toBe(409);
      const wrong = await createClarification(db, {
        userId: user.id,
        businessDay: '2026-11-10',
        type: 'possible_duplicate',
        ledgerEntryId: second.id,
      });
      expect(
        (await phone.post(`/api/pending/${wrong.id}/resolve`, { action: 'whole_day' })).status,
      ).toBe(400);
    });

    it('missing from the list: «Sí, anótala» records it «Con captura», origin `lista` (11.10)', async () => {
      const { user, phone } = await setup();
      const doubt = await createClarification(db, {
        userId: user.id,
        businessDay: '2026-11-09',
        type: 'missing_from_list',
        detail: {
          row: {
            amountCents: 1_500,
            direction: 'in',
            paymentMethod: 'yape',
            counterparty: 'Ana T.',
            operationNumber: '00123456',
            operationAt: limaInstant('2026-11-09', 16, 20).toISOString(),
          },
        },
      });
      expect(doubt.status).toBe('in_web');
      const list = await (await phone.get('/api/pending')).json();
      expect(list.items[0].question).toBe(
        'En tu lista hay un Yape de S/ 15 de Ana T. a las 4:20 p. m. que no me mandaste. ¿Es una venta?',
      );
      const res = await phone.post(`/api/pending/${doubt.id}/resolve`, { action: 'add_from_list' });
      expect(await res.json()).toMatchObject({
        outcome: 'created',
        entry: { amountCents: 1_500, label: 'screenshot', businessDay: '2026-11-09' },
      });
      const [row] = await db
        .select()
        .from(ledgerEntries)
        .where(and(eq(ledgerEntries.userId, user.id), eq(ledgerEntries.businessDay, '2026-11-09')));
      expect(row).toMatchObject({ source: 'activity_list', operationNumber: '00123456' });
    });

    it('«hoy vendí 200 en efectivo» answered «Solo efectivo» records the difference «sin detalle» (PR09)', async () => {
      const { user, phone } = await setup();
      await addEntry(db, user.id, {
        amountCents: 9_500,
        paymentMethod: 'cash',
        label: 'self_reported',
        source: 'audio',
        counterparty: null,
      });
      const doubt = await createClarification(db, {
        userId: user.id,
        businessDay: '2026-11-10',
        type: 'ambiguous_total',
        detail: { declaredTotalCents: 20_000, quote: 'hoy vendí 200', variant: 'no_method' },
      });
      const list = await (await phone.get('/api/pending')).json();
      expect(list.items[0].question).toBe(
        'Dijiste «hoy vendí 200». ¿Es todo el día o solo efectivo?',
      );
      const res = await phone.post(`/api/pending/${doubt.id}/resolve`, { action: 'cash_only' });
      expect(await res.json()).toMatchObject({
        outcome: 'record_unitemized',
        entry: {
          amountCents: 10_500,
          paymentMethod: 'cash',
          label: 'unitemized',
          labelText: 'Lo contaste tú (sin detalle)',
        },
      });
    });

    it('unreadable: she types the amount; direction doubt: «Pagué mercadería» keeps «Con captura»', async () => {
      const { user, phone } = await setup();
      const unreadable = await createClarification(db, {
        userId: user.id,
        businessDay: '2026-11-10',
        type: 'unreadable',
        detail: { paymentMethod: 'yape', at: limaInstant('2026-11-10', 11, 42).toISOString() },
      });
      const items = (await (await phone.get('/api/pending')).json()).items;
      expect(items[0].question).toBe(
        'Una captura de las 11:42 a. m. no se lee bien. ¿De cuánto era?',
      );
      expect(items[0].options[0]).toMatchObject({ input: 'amount' });
      const typed = await phone.post(`/api/pending/${unreadable.id}/resolve`, {
        action: 'set_amount',
        amountCents: 4_500,
      });
      expect((await typed.json()).entry).toMatchObject({
        amountCents: 4_500,
        paymentMethod: 'yape',
        category: 'sale',
        label: 'self_reported',
      });

      const unsure = await addEntry(db, user.id, { amountCents: 8_000, status: 'pending' });
      const direction = await createClarification(db, {
        userId: user.id,
        businessDay: '2026-11-10',
        type: 'direction',
        ledgerEntryId: unsure.id,
      });
      const res = await phone.post(`/api/pending/${direction.id}/resolve`, {
        action: 'set_direction',
        direction: 'out',
        category: 'inventory',
      });
      expect(await res.json()).toMatchObject({
        outcome: 'replaced',
        entry: {
          direction: 'out',
          category: 'inventory',
          label: 'screenshot',
          status: 'confirmed',
        },
      });
    });

    it('D17: resolving the close doubts after 12:00 improves the level without points', async () => {
      const { user, phone } = await setup();
      const entry = await addEntry(db, user.id, {
        businessDay: '2026-11-08',
        amountCents: 6_000,
        direction: 'out',
        category: 'unclassified',
        counterparty: 'Distribuidora Sur',
      });
      await db.insert(dailyCloses).values({
        userId: user.id,
        businessDay: '2026-11-08',
        status: 'final',
        sentAt: limaInstant('2026-11-08', 21, 0),
        repliedAt: limaInstant('2026-11-08', 21, 5),
        finalAt: limaInstant('2026-11-09', 12, 0),
        cashCheck: 'balanced',
        level: 'partial',
      });
      const doubt = await createClarification(db, {
        userId: user.id,
        businessDay: '2026-11-08',
        type: 'category',
        ledgerEntryId: entry.id,
        status: 'in_web',
      });
      await db
        .update(clarifications)
        .set({ messageNumber: 1 })
        .where(eq(clarifications.id, doubt.id));

      const res = await phone.post(`/api/pending/${doubt.id}/resolve`, {
        action: 'set_category',
        category: 'inventory',
      });
      expect(res.status).toBe(200);
      const [close] = await db.select().from(dailyCloses).where(eq(dailyCloses.userId, user.id));
      expect(close).toMatchObject({ level: 'partial', improvedLevel: 'complete' });
      const points = await db.select().from(pointsEntries).where(eq(pointsEntries.userId, user.id));
      expect(points).toEqual([]);
      const days = await (await phone.get('/api/days?from=2026-11-08&to=2026-11-08')).json();
      expect(days.days[0]).toMatchObject({ level: 'complete', levelText: 'completo' });
    });
  });
});
