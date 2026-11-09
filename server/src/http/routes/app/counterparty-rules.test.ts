import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestDb, hasTestDb } from '../../../../test/db.js';
import { counterpartyRules } from '../../../db/schema.js';
import { decideCategory, MINUTE_MS, normalizeName } from '../../../domain/index.js';
import { voidEntry } from '../../../ledger/index.js';
import {
  addEntry,
  Browser,
  createTestApi,
  createTestUser,
  signedInBrowser,
  TestClock,
} from './test-support.js';

describe.skipIf(!hasTestDb)('web counterparty rules API (RF-WP-08, PR14)', () => {
  const { pool, db } = createTestDb();
  afterAll(() => pool.end());

  const CARLOS = 'Carlos R.';
  const CARLOS_KEY = normalizeName(CARLOS);

  /** Follows real time, so a PIN verified «now» is fresh; `advance` makes it stale. */
  class RealClock extends TestClock {
    offset = 0;
    override now = (): Date => new Date(Date.now() + this.offset);
    override advance(ms: number): void {
      this.offset += ms;
    }
  }

  async function setup() {
    const clock = new RealClock(new Date());
    const app = createTestApi(db, clock);
    const user = await createTestUser(db);
    const phone = await signedInBrowser(app, db, user.id, clock.now());
    return { clock, app, user, phone };
  }

  const markPersonal = (userId: string, counterparty = CARLOS) =>
    addEntry(db, userId, {
      category: 'personal',
      counterparty,
      label: 'self_reported',
      source: 'web',
      operationAt: null,
    });

  async function offers(phone: Browser) {
    const res = await phone.get('/api/counterparty-rules');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    return res.json();
  }

  it('offers the rule after the 3rd «personal» mark, with the 11.3 question', async () => {
    const { user, phone } = await setup();
    await markPersonal(user.id);
    await markPersonal(user.id);
    // Neither sales nor outgoing personal payments nor removed marks count.
    await addEntry(db, user.id, { counterparty: CARLOS, operationAt: null });
    await addEntry(db, user.id, {
      direction: 'out',
      category: 'personal',
      counterparty: CARLOS,
      operationAt: null,
    });
    const removed = await markPersonal(user.id);
    await voidEntry(db, {
      userId: user.id,
      entryId: removed.id,
      actor: { kind: 'user', channel: 'web' },
      now: new Date(),
    });
    expect((await offers(phone)).offers).toEqual([]);

    await markPersonal(user.id);
    const body = await offers(phone);
    expect(body.offers).toEqual([
      expect.objectContaining({
        counterpartyKey: CARLOS_KEY,
        counterparty: CARLOS,
        personalMarks: 3,
        question: '¿Quieres que los Yapes de Carlos R. no cuenten como venta?',
      }),
    ]);
    expect(body.rules).toEqual([]);
  });

  it('accepting needs the PIN, then stores an active rule the pipeline will apply', async () => {
    const { clock, user, phone } = await setup();
    for (let i = 0; i < 3; i++) await markPersonal(user.id);

    clock.advance(11 * MINUTE_MS);
    const stale = await phone.post('/api/counterparty-rules/accept', {
      counterpartyKey: CARLOS_KEY,
    });
    expect(stale.status).toBe(403);
    expect((await stale.json()).error).toBe('pin_required');

    clock.offset = 0;
    const fresh = await signedInBrowser(createTestApi(db, clock), db, user.id, clock.now());
    const res = await fresh.post('/api/counterparty-rules/accept', { counterpartyKey: CARLOS_KEY });
    expect(res.status).toBe(200);
    expect((await res.json()).message).toBe(
      'Listo. Desde ahora, los pagos de Carlos R. no cuentan como venta.',
    );

    const body = await offers(fresh);
    expect(body.offers).toEqual([]);
    expect(body.rules).toEqual([
      expect.objectContaining({ counterpartyKey: CARLOS_KEY, counterparty: CARLOS }),
    ]);

    const [rule] = await db
      .select()
      .from(counterpartyRules)
      .where(and(eq(counterpartyRules.userId, user.id), eq(counterpartyRules.direction, 'in')));
    expect(rule).toMatchObject({ category: 'personal', source: 'accepted', active: true });
    if (!rule) throw new Error('no rule');
    expect(
      decideCategory({ direction: 'in', counterpartyNormalized: CARLOS_KEY, rules: [rule] })
        .category,
    ).toBe('personal');
  });

  it('declining needs no PIN and only 3 new marks ask again', async () => {
    const { clock, user, phone } = await setup();
    for (let i = 0; i < 3; i++) await markPersonal(user.id);
    clock.advance(11 * MINUTE_MS);

    const res = await phone.post('/api/counterparty-rules/decline', {
      counterpartyKey: CARLOS_KEY,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).message).toBe(
      'Listo. Los pagos de Carlos R. siguen contando como venta.',
    );
    expect((await offers(phone)).offers).toEqual([]);

    await markPersonal(user.id);
    await markPersonal(user.id);
    expect((await offers(phone)).offers).toEqual([]);
    await markPersonal(user.id);
    expect((await offers(phone)).offers).toEqual([
      expect.objectContaining({ counterpartyKey: CARLOS_KEY, personalMarks: 3 }),
    ]);
  });

  it('turning the rule off needs the PIN and does not ask again right away', async () => {
    const { user, phone } = await setup();
    for (let i = 0; i < 3; i++) await markPersonal(user.id);
    await phone.post('/api/counterparty-rules/accept', { counterpartyKey: CARLOS_KEY });

    const res = await phone.post('/api/counterparty-rules/deactivate', {
      counterpartyKey: CARLOS_KEY,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).message).toBe(
      'Listo. Desde ahora, los pagos de Carlos R. vuelven a contar como venta.',
    );
    const body = await offers(phone);
    expect(body.rules).toEqual([]);
    expect(body.offers).toEqual([]);
    const [rule] = await db
      .select()
      .from(counterpartyRules)
      .where(eq(counterpartyRules.userId, user.id));
    expect(rule?.active).toBe(false);

    const again = await phone.post('/api/counterparty-rules/deactivate', {
      counterpartyKey: CARLOS_KEY,
    });
    expect(again.status).toBe(404);
  });

  it('answers only her own offers (14.4) and needs a session', async () => {
    const { app, clock, user } = await setup();
    for (let i = 0; i < 3; i++) await markPersonal(user.id);

    const other = await createTestUser(db);
    const otherPhone = await signedInBrowser(app, db, other.id, clock.now());
    expect((await offers(otherPhone)).offers).toEqual([]);
    const res = await otherPhone.post('/api/counterparty-rules/accept', {
      counterpartyKey: CARLOS_KEY,
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('no_offer');

    const anonymous = new Browser(app);
    expect((await anonymous.get('/api/counterparty-rules')).status).toBe(401);
    const bad = await otherPhone.post('/api/counterparty-rules/decline', { counterpartyKey: '' });
    expect(bad.status).toBe(400);
  });
});
