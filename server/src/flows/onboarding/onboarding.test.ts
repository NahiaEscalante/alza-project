import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestDb, hasTestDb } from '../../../test/db.js';
import {
  accessLinks,
  alerts,
  consents,
  extractions,
  inboundMessages,
  ledgerEntries,
  mediaFiles,
} from '../../db/schema.js';
import { BUTTONS } from '../../messages/catalog.js';
import {
  cashSale,
  createOnboardedUser,
  randomPhone,
  receiptExtraction,
} from '../../pipeline/test-support.js';
import { CONSENT_TEXT_VERSION, RESUME_AFTER_MS } from './onboarding.js';
import {
  backdateOutbound,
  bodyOf,
  createFlowHarness,
  type FlowHarness,
  outboundTypes,
  TEST_BASE_URL,
  userRow,
} from './test-support.js';

describe.skipIf(!hasTestDb)('onboarding (4.3, RF-ON-01..08, HU-01)', () => {
  const { pool, db } = createTestDb();
  afterAll(() => pool.end());

  const inboundOf = (userId: string) =>
    db.select().from(inboundMessages).where(eq(inboundMessages.userId, userId));
  const entriesOf = (userId: string) =>
    db.select().from(ledgerEntries).where(eq(ledgerEntries.userId, userId));

  /** Hola → Acepto → negocio → titular: she is at the close time question. */
  async function upToCloseTime(h: FlowHarness, phone: string, holder = 'Marta Quispe') {
    await h.say(phone, 'Hola ALZA');
    await h.tap(phone, BUTTONS.consentAccept);
    await h.say(phone, 'Bodega Marta');
    await h.say(phone, holder);
  }

  async function onboard(h: FlowHarness, phone: string, holder = 'Marta Quispe') {
    await upToCloseTime(h, phone, holder);
    await h.tap(phone, BUTTONS.close21);
  }

  it('HU-01.1: an unknown number that says «Hola» gets the welcome with «Acepto» / «No, gracias»', async () => {
    const h = createFlowHarness(db);
    const phone = randomPhone();
    await h.say(phone, 'Hola ALZA');

    const user = await userRow(db, phone);
    expect(user?.onboardingStatus).toBe('awaiting_consent');
    const said = h.said(phone);
    expect(said.map((m) => m.catalogId)).toEqual(['WA-01']);
    const welcome = said[0]?.content;
    expect(welcome?.type).toBe('buttons');
    if (welcome?.type !== 'buttons') throw new Error('expected buttons');
    expect(welcome.buttons.map((b) => b.title)).toEqual(['Acepto', 'No, gracias']);
    expect(welcome.body).toContain(`Detalles: ${TEST_BASE_URL}/privacidad. ¿Aceptas?`);
    // Nothing she wrote is kept before consent (RF-ON-02).
    expect((await inboundOf(user?.id ?? '')).map((m) => [m.text, m.status])).toEqual([
      [null, 'discarded_no_consent'],
    ]);
  });

  it('HU-01.2: «No, gracias» keeps only her number and the refusal; writing again asks again', async () => {
    const h = createFlowHarness(db);
    const phone = randomPhone();
    await h.say(phone, 'Hola, soy de la Bodega Rosa');
    await h.tap(phone, BUTTONS.consentDecline);

    const user = await userRow(db, phone);
    if (!user) throw new Error('no user');
    expect(h.said(phone).map((m) => m.catalogId)).toEqual(['WA-01', 'WA-02']);
    expect(bodyOf(h.said(phone)[1]?.content)).toBe(
      'Entendido, no guardaré nada. Si cambias de opinión, escríbeme.',
    );
    expect(user).toMatchObject({
      onboardingStatus: 'declined',
      businessName: null,
      accountHolderName: null,
      accountHolderNormalized: null,
      closeTime: null,
    });
    const rows = await db.select().from(consents).where(eq(consents.userId, user.id));
    expect(rows).toEqual([
      expect.objectContaining({ accepted: false, textVersion: CONSENT_TEXT_VERSION }),
    ]);
    expect(
      (await inboundOf(user.id)).every((m) => m.text === null || m.type === 'interactive'),
    ).toBe(true);
    expect(await entriesOf(user.id)).toEqual([]);

    // A second tap is not answered twice.
    await h.tap(phone, BUTTONS.consentDecline);
    expect(h.said(phone).map((m) => m.catalogId)).toEqual(['WA-01', 'WA-02']);

    // «Si cambias de opinión, escríbeme».
    await h.say(phone, 'hola de nuevo');
    expect(h.said(phone).map((m) => m.catalogId)).toEqual(['WA-01', 'WA-02', 'WA-01']);
    expect((await userRow(db, phone))?.onboardingStatus).toBe('awaiting_consent');
    await h.tap(phone, BUTTONS.consentAccept);
    expect((await userRow(db, phone))?.onboardingStatus).toBe('business_name');
  });

  it('HU-01.3: a screenshot before «Acepto» is not processed and nothing of it is kept', async () => {
    const h = createFlowHarness(db);
    const phone = randomPhone();
    h.reader.set('img:before', receiptExtraction({ amount: '12.50' }));
    await h.image(phone, 'img:before');

    const user = await userRow(db, phone);
    if (!user) throw new Error('no user');
    expect(h.reader.calls).toBe(0);
    expect(h.storage.blobs.size).toBe(0);
    const [message] = await inboundOf(user.id);
    expect(message).toMatchObject({
      type: 'image',
      status: 'discarded_no_consent',
      text: null,
      waMediaId: null,
    });
    expect(await db.select().from(mediaFiles).where(eq(mediaFiles.userId, user.id))).toEqual([]);
    expect(
      await db
        .select()
        .from(extractions)
        .where(eq(extractions.inboundMessageId, message?.id ?? '')),
    ).toEqual([]);
    expect(await entriesOf(user.id)).toEqual([]);
    // She still gets the welcome (her first message), only once in a row.
    await h.image(phone, 'img:before-2');
    expect(h.said(phone).map((m) => m.catalogId)).toEqual(['WA-01']);
  });

  it('HU-01.4: «Acepto» + the 3 answers → the habit message with a 1-hour activation link', async () => {
    const h = createFlowHarness(db);
    const phone = randomPhone();
    await h.say(phone, 'Hola ALZA');
    const before = Date.now();
    await h.tap(phone, BUTTONS.consentAccept);
    const user = await userRow(db, phone);
    if (!user) throw new Error('no user');
    const [consent] = await db.select().from(consents).where(eq(consents.userId, user.id));
    // RF-ON-03: date, time and text version.
    expect(consent).toMatchObject({ accepted: true, textVersion: CONSENT_TEXT_VERSION });
    expect(consent?.createdAt.getTime()).toBeGreaterThanOrEqual(before - 1_000);

    await h.say(phone, 'Bodega Marta');
    await h.say(phone, 'MARTA QUISPE Huamán');
    const closeQuestion = h.said(phone).at(-1)?.content;
    if (closeQuestion?.type !== 'buttons') throw new Error('expected buttons');
    expect(closeQuestion.buttons.map((b) => b.title)).toEqual(['8 pm', '9 pm', '10 pm']);
    await h.tap(phone, BUTTONS.close21);

    expect(h.said(phone).map((m) => m.catalogId)).toEqual([
      'WA-01',
      'WA-03',
      'WA-04',
      'WA-05',
      'WA-06',
    ]);
    const habit = bodyOf(h.said(phone).at(-1)?.content);
    expect(habit.startsWith('¡Listo, Marta! Así funciona:')).toBe(true);
    expect(habit).toContain('A las 9 p. m. te mando tu resumen del día.');
    const url = /\(este enlace dura 1 hora\): (\S+)$/.exec(habit)?.[1];
    expect(url?.startsWith(`${TEST_BASE_URL}/app/activar/`)).toBe(true);

    const done = await userRow(db, phone);
    expect(done).toMatchObject({
      onboardingStatus: 'complete',
      businessName: 'Bodega Marta',
      accountHolderName: 'MARTA QUISPE Huamán',
      accountHolderNormalized: 'marta quispe huaman',
      closeTime: '21:00:00',
    });
    const [link] = await db
      .select()
      .from(accessLinks)
      .where(and(eq(accessLinks.userId, user.id), eq(accessLinks.type, 'activation')));
    expect((link?.expiresAt.getTime() ?? 0) - (link?.createdAt.getTime() ?? 0)).toBe(3_600_000);
    expect(link?.usedAt).toBeNull();
  });

  it('WA-05 free text: «9:30 pm» is accepted; «3 am» is later than 2:00 and asked again', async () => {
    const h = createFlowHarness(db);
    const phone = randomPhone();
    await upToCloseTime(h, phone);
    await h.say(phone, 'cierro como a las 3 am');
    expect(
      h
        .said(phone)
        .map((m) => m.catalogId)
        .slice(-2),
    ).toEqual(['WA-05', 'WA-05']);
    expect((await userRow(db, phone))?.onboardingStatus).toBe('close_time');

    await h.say(phone, '9:30 pm');
    expect((await userRow(db, phone))?.closeTime).toBe('21:30:00');
    expect(bodyOf(h.said(phone).at(-1)?.content)).toContain('A las 9:30 p. m. te mando');
  });

  it('RF-ON-06: half-way, her next message after a while resumes the pending question', async () => {
    const h = createFlowHarness(db);
    const phone = randomPhone();
    await h.say(phone, 'Hola ALZA');
    await h.tap(phone, BUTTONS.consentAccept);
    const user = await userRow(db, phone);
    if (!user) throw new Error('no user');
    // She left yesterday at the business name question.
    await backdateOutbound(db, user.id, 'WA-03', new Date(Date.now() - RESUME_AFTER_MS - 60_000));

    await h.say(phone, 'vendí 5 de pan');
    expect((await userRow(db, phone))?.businessName).toBeNull();
    expect(h.said(phone).map((m) => m.catalogId)).toEqual(['WA-01', 'WA-03', 'WA-03']);

    // Small talk is never a business name.
    await h.say(phone, 'Hola ALZA');
    expect(
      h
        .said(phone)
        .map((m) => m.catalogId)
        .at(-1),
    ).toBe('WA-03');
    expect((await userRow(db, phone))?.businessName).toBeNull();

    await h.say(phone, 'Se llama Bodega Rosa');
    expect(await userRow(db, phone)).toMatchObject({
      businessName: 'Bodega Rosa',
      onboardingStatus: 'account_holder',
    });
    expect(
      h
        .said(phone)
        .map((m) => m.catalogId)
        .at(-1),
    ).toBe('WA-04');
  });

  it('RF-ON-02: what she wrote before «Acepto» is never used as an answer', async () => {
    const h = createFlowHarness(db);
    const phone = randomPhone();
    await h.say(phone, 'Bodega Marta');
    await h.tap(phone, BUTTONS.consentAccept);
    const user = await userRow(db, phone);
    expect(user?.businessName).toBeNull();
    expect(h.said(phone).map((m) => m.catalogId)).toEqual(['WA-01', 'WA-03']);
    // A double tap on «Acepto» does not repeat the question she has right above.
    await h.tap(phone, BUTTONS.consentAccept);
    expect(h.said(phone).map((m) => m.catalogId)).toEqual(['WA-01', 'WA-03']);
    expect(
      await db
        .select()
        .from(consents)
        .where(eq(consents.userId, user?.id ?? '')),
    ).toHaveLength(1);
  });

  it('after «Acepto», a screenshot mid-onboarding is recorded and the question repeated once', async () => {
    const h = createFlowHarness(db);
    const phone = randomPhone();
    await h.say(phone, 'Hola ALZA');
    await h.tap(phone, BUTTONS.consentAccept);
    const user = await userRow(db, phone);
    if (!user) throw new Error('no user');
    await backdateOutbound(db, user.id, 'WA-03', new Date(Date.now() - 20 * 60_000));
    h.reader.set('img:mid', receiptExtraction({ amount: '8.00', operationNumber: '11110001' }));
    h.reader.set('img:mid2', receiptExtraction({ amount: '9.00', operationNumber: '11110002' }));
    await h.image(phone, 'img:mid');
    await h.image(phone, 'img:mid2');

    expect((await entriesOf(user.id)).map((e) => e.amountCents).sort()).toEqual([800, 900]);
    // WA-03 once more (not twice), and no WA-07 during the onboarding.
    expect(h.said(phone).map((m) => m.catalogId)).toEqual(['WA-01', 'WA-03', 'WA-03']);
  });

  it('13.4, case 22: a holder another account already declared raises an alert', async () => {
    const h = createFlowHarness(db);
    const holder = `Rosa Huamán ${Math.random().toString(36).slice(2, 8)}`;
    await createOnboardedUser(db, { holder });
    const phone = randomPhone();
    await onboard(h, phone, holder);
    const user = await userRow(db, phone);
    const rows = await db
      .select()
      .from(alerts)
      .where(eq(alerts.userId, user?.id ?? ''));
    expect(rows.map((a) => [a.type, a.status])).toEqual([['duplicate_account_holder', 'open']]);
    // The alert keeps ids and a hash, never the name.
    expect(JSON.stringify(rows[0]?.detail)).not.toContain('Rosa');
    expect(user?.onboardingStatus).toBe('complete');
  });

  it('PR01, D41: only the first screenshot read after the onboarding is confirmed (WA-07)', async () => {
    const h = createFlowHarness(db);
    const phone = randomPhone();
    await onboard(h, phone);
    const user = await userRow(db, phone);
    if (!user) throw new Error('no user');
    h.reader.set('img:blurry', receiptExtraction({ amount: null }));
    h.reader.set(
      'img:plin',
      receiptExtraction({
        amount: '30.00',
        header: 'plin_sent',
        paymentMethod: 'plin',
        visibleHolder: 'Marta Quispe',
        counterparty: 'Distribuidora Lima',
        operationNumber: '22220001',
      }),
    );
    h.reader.set('img:yape', receiptExtraction({ amount: '12.50', operationNumber: '22220002' }));

    await h.image(phone, 'img:blurry');
    expect(
      h
        .said(phone)
        .map((m) => m.catalogId)
        .at(-1),
    ).toBe('WA-06');
    await h.image(phone, 'img:plin');
    expect(bodyOf(h.said(phone).at(-1)?.content)).toBe(
      '✅ Así lo anoté: pago por Plin de S/30. Desde ahora, en silencio hasta tu cierre.',
    );
    await h.image(phone, 'img:yape');
    expect((await outboundTypes(db, user.id)).filter((t) => t === 'WA-07')).toHaveLength(1);
  });

  it('PR01: «venta por Yape de S/12,50»; text and audio sales stay silent (D04)', async () => {
    const h = createFlowHarness(db);
    const user = await createOnboardedUser(db);
    h.ai.text('vendí 5 de pan', cashSale('5.00'));
    h.ai.audio('audio:pan', { text: 'vendí 3.50 de pan' });
    h.ai.text('vendí 3.50 de pan', cashSale('3.50'));
    await h.say(user.phoneE164, 'vendí 5 de pan');
    await h.sendAudio(user.phoneE164, 'audio:pan');
    await h.drain();
    expect(await outboundTypes(db, user.id)).toEqual([]);

    h.reader.set('img:first', receiptExtraction({ amount: '12.50', operationNumber: '33330001' }));
    h.reader.set('img:second', receiptExtraction({ amount: '2.00', operationNumber: '33330002' }));
    await h.image(user.phoneE164, 'img:first');
    await h.image(user.phoneE164, 'img:second');
    await h.image(user.phoneE164, 'img:first');
    expect(h.said(user.phoneE164).map((m) => [m.catalogId, bodyOf(m.content)])).toEqual([
      [
        'WA-07',
        '✅ Así lo anoté: venta por Yape de S/12,50. Desde ahora, en silencio hasta tu cierre.',
      ],
    ]);
    expect((await entriesOf(user.id)).length).toBe(4);
  });
});
