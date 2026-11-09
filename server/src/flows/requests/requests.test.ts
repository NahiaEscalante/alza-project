import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestDb, hasTestDb } from '../../../test/db.js';
import { anonymousPhone } from '../../account/index.js';
import {
  accessLinks,
  inboundMessages,
  ledgerEntries,
  outboundMessages,
  pins,
  users,
} from '../../db/schema.js';
import { BUTTONS } from '../../messages/catalog.js';
import {
  cashSale,
  createOnboardedUser,
  receiptExtraction,
  silentLogger,
} from '../../pipeline/test-support.js';
import {
  backdateOutbound,
  bodyOf,
  createFlowHarness,
  outboundTypes,
  TEST_BASE_URL,
} from '../onboarding/test-support.js';
import { broadcastTechnicalIssue } from './broadcast.js';

describe.skipIf(!hasTestDb)('exceptions to the silence (D05, D27, D28)', () => {
  const { pool, db } = createTestDb();
  afterAll(() => pool.end());

  const linksOf = (userId: string, type: 'activation' | 'access') =>
    db
      .select()
      .from(accessLinks)
      .where(and(eq(accessLinks.userId, userId), eq(accessLinks.type, type)));

  it('case 15: «web» answers WA-13 with her 7-day link', async () => {
    const h = createFlowHarness(db);
    const user = await createOnboardedUser(db);
    await db.insert(pins).values({ userId: user.id, pinHash: 'test-hash' });
    h.ai.text('web', { intent: 'request', request: 'web_link' });
    await h.say(user.phoneE164, 'web');

    const said = h.said(user.phoneE164);
    expect(said.map((m) => m.catalogId)).toEqual(['WA-13']);
    const url = /: (\S+)$/.exec(bodyOf(said[0]?.content))?.[1] ?? '';
    expect(bodyOf(said[0]?.content).startsWith('Aquí tienes tu enlace (vale 7 días): ')).toBe(true);
    expect(url.startsWith(`${TEST_BASE_URL}/app/entrar/`)).toBe(true);
    const [link] = await linksOf(user.id, 'access');
    expect((link?.expiresAt.getTime() ?? 0) - (link?.createdAt.getTime() ?? 0)).toBe(
      7 * 24 * 3_600_000,
    );
  });

  it('case 15 without a PIN yet: «web» sends the 1-hour activation link (WA-14)', async () => {
    const h = createFlowHarness(db);
    const user = await createOnboardedUser(db);
    h.ai.text('web', { intent: 'request', request: 'web_link' });
    await h.say(user.phoneE164, 'web');
    const said = h.said(user.phoneE164);
    expect(said.map((m) => m.catalogId)).toEqual(['WA-14']);
    expect(bodyOf(said[0]?.content)).toContain(`${TEST_BASE_URL}/app/activar/`);
    expect(await linksOf(user.id, 'access')).toEqual([]);
  });

  it('case 16: «olvidé mi PIN» → WA-14 with a new 1-hour activation link; older ones stop', async () => {
    const h = createFlowHarness(db);
    const user = await createOnboardedUser(db);
    await db.insert(pins).values({ userId: user.id, pinHash: 'test-hash' });
    h.ai.text('olvidé mi PIN', { intent: 'request', request: 'forgot_pin' });
    await h.say(user.phoneE164, 'olvidé mi PIN');
    await h.say(user.phoneE164, 'olvidé mi PIN');

    const said = h.said(user.phoneE164);
    expect(said.map((m) => m.catalogId)).toEqual(['WA-14', 'WA-14']);
    expect(bodyOf(said[1]?.content)).toMatch(
      /^Para crear un PIN nuevo, entra aquí \(vale 1 hora\): https:\/\/alza\.test\/app\/activar\/\S+$/,
    );
    const links = await linksOf(user.id, 'activation');
    const live = links.filter((link) => link.expiresAt.getTime() > Date.now());
    expect(links).toHaveLength(2);
    expect(live).toHaveLength(1);
  });

  it('case 17, HU-15: «borra mis datos» asks with buttons; «Cancelar» keeps everything', async () => {
    const h = createFlowHarness(db);
    const user = await createOnboardedUser(db);
    h.ai.text('borra mis datos', { intent: 'request', request: 'delete_data' });
    await h.say(user.phoneE164, 'borra mis datos');
    const question = h.said(user.phoneE164)[0];
    expect(question?.catalogId).toBe('WA-15');
    if (question?.content.type !== 'buttons') throw new Error('expected buttons');
    expect(question.content.buttons.map((b) => b.title)).toEqual(['Sí, borrar todo', 'Cancelar']);

    await h.tap(user.phoneE164, BUTTONS.deleteCancel);
    expect(h.said(user.phoneE164)).toHaveLength(1);
    const [still] = await db.select().from(users).where(eq(users.id, user.id));
    expect(still?.deletedAt).toBeNull();
  });

  it('HU-15, RF-PV-01: «Sí, borrar todo» → WA-16 first, then everything is deleted at once', async () => {
    const h = createFlowHarness(db);
    const user = await createOnboardedUser(db);
    h.ai.text('vendí 5 de pan', cashSale('5.00'));
    h.ai.text('borra mis datos', { intent: 'request', request: 'delete_data' });
    await h.say(user.phoneE164, 'vendí 5 de pan');
    await h.say(user.phoneE164, 'borra mis datos');
    await h.tap(user.phoneE164, BUTTONS.deleteConfirm);

    // She got the notice on her phone before the number was anonymized.
    expect(h.said(user.phoneE164).map((m) => [m.catalogId, bodyOf(m.content)])).toEqual([
      ['WA-15', '¿Seguro? Esto borra tu historial, tus puntos y tu cuenta. No se puede deshacer.'],
      ['WA-16', 'Listo, borré tus datos. Gracias por usar ALZA.'],
    ]);
    const [gone] = await db.select().from(users).where(eq(users.id, user.id));
    expect(gone).toMatchObject({
      phoneE164: anonymousPhone(user.id),
      businessName: null,
      accountHolderName: null,
    });
    expect(gone?.deletedAt).not.toBeNull();
    for (const table of [ledgerEntries, inboundMessages, outboundMessages]) {
      expect(await db.select().from(table).where(eq(table.userId, user.id))).toEqual([]);
    }

    // Writing again from the same phone starts from zero, as a new number.
    await h.say(user.phoneE164, 'Hola');
    expect(h.said(user.phoneE164).at(-1)?.catalogId).toBe('WA-01');
  });

  it('a delete confirmation without a WA-15 deletes nothing', async () => {
    const h = createFlowHarness(db);
    const user = await createOnboardedUser(db);
    await h.tap(user.phoneE164, BUTTONS.deleteConfirm);
    const [still] = await db.select().from(users).where(eq(users.id, user.id));
    expect(still?.deletedAt).toBeNull();
    expect(h.said(user.phoneE164)).toEqual([]);
  });

  it('case 27: «sin imagen» / «con imagen» change the preference without an answer', async () => {
    const h = createFlowHarness(db);
    const user = await createOnboardedUser(db);
    h.ai.text('sin imagen', { intent: 'request', request: 'text_only' });
    h.ai.text('con imagen', { intent: 'request', request: 'with_image' });
    const summaryImage = async () =>
      (await db.select().from(users).where(eq(users.id, user.id)))[0]?.summaryImage;

    await h.say(user.phoneE164, 'sin imagen');
    expect(await summaryImage()).toBe(false);
    await h.say(user.phoneE164, 'con imagen');
    expect(await summaryImage()).toBe(true);
    expect(await outboundTypes(db, user.id)).toEqual([]);
  });

  it('case 28: the third unreadable screenshot in a row brings WA-19, once a day', async () => {
    const h = createFlowHarness(db);
    const user = await createOnboardedUser(db);
    for (const key of ['u1', 'u2', 'u3', 'u4', 'u5']) {
      h.reader.set(`img:${key}`, receiptExtraction({ amount: null }));
    }
    for (const key of ['u1', 'u2', 'u3', 'u4', 'u5']) await h.image(user.phoneE164, `img:${key}`);
    expect(h.said(user.phoneE164).map((m) => [m.catalogId, bodyOf(m.content)])).toEqual([
      [
        'WA-19',
        'Tus últimas capturas no se leen bien. Tómalas completas desde tu app de Yape o Plin, sin recortar el monto.',
      ],
    ]);
  });

  it('case 29: danger gets one WA-20 and nothing more that day', async () => {
    const h = createFlowHarness(db);
    const user = await createOnboardedUser(db);
    const threat = 'me están amenazando para que pague un cupo';
    h.ai.text(threat, { intent: 'danger' });
    h.ai.text('me volvieron a llamar', { intent: 'danger' });
    await h.say(user.phoneE164, threat);
    await h.say(user.phoneE164, 'me volvieron a llamar');
    expect(h.said(user.phoneE164).map((m) => [m.catalogId, bodyOf(m.content)])).toEqual([
      [
        'WA-20',
        'No puedo ayudarte con esto en tiempo real. Si estás en peligro, llama al 105. Si sufres violencia, la Línea 100 te orienta gratis.',
      ],
    ]);
    // Next business day: one again if needed.
    await backdateOutbound(db, user.id, 'WA-20', new Date(Date.now() - 30 * 3_600_000));
    await h.say(user.phoneE164, threat);
    expect(await outboundTypes(db, user.id)).toEqual(['WA-20', 'WA-20']);
  });

  it('case 14: greetings and normal records get no answer', async () => {
    const h = createFlowHarness(db);
    const user = await createOnboardedUser(db);
    h.ai.text('hola', { intent: 'other' });
    h.ai.text('vendí 2 de gaseosa', cashSale('2.00', 'gaseosa'));
    await h.say(user.phoneE164, 'hola');
    await h.say(user.phoneE164, 'vendí 2 de gaseosa');
    expect(await outboundTypes(db, user.id)).toEqual([]);
  });

  it('WA-17: once per user per incident, only inside the 24 h window', async () => {
    const h = createFlowHarness(db);
    const startedAt = new Date(Date.now() - 60_000);
    const waiting = await createOnboardedUser(db);
    const outside = await createOnboardedUser(db);
    h.ai.text('vendí 1 de pan', 'unavailable');
    await h.say(waiting.phoneE164, 'vendí 1 de pan');
    await h.say(outside.phoneE164, 'vendí 1 de pan');
    await db
      .update(users)
      .set({ lastMessageAt: new Date(Date.now() - 25 * 3_600_000) })
      .where(eq(users.id, outside.id));

    const deps = {
      db,
      channel: h.channel,
      storage: h.storage,
      logger: silentLogger,
      appBaseUrl: TEST_BASE_URL,
    };
    const first = await broadcastTechnicalIssue(deps, {
      startedAt,
      userIds: [waiting.id, outside.id],
    });
    expect(first).toEqual({ sent: 1, skipped: 1, failed: 0 });
    expect(bodyOf(h.said(waiting.phoneE164).at(-1)?.content)).toBe(
      'Estamos con un problema técnico. Tus mensajes están guardados y los voy a procesar apenas se resuelva.',
    );
    const again = await broadcastTechnicalIssue(deps, {
      startedAt,
      userIds: [waiting.id, outside.id],
    });
    expect(again).toEqual({ sent: 0, skipped: 2, failed: 0 });
    expect(await outboundTypes(db, waiting.id)).toEqual(['WA-17']);

    // Default recipients: everyone with a message still waiting since the incident started.
    // A recording channel keeps other test files' users out of the simulator and the outbox.
    const third = await createOnboardedUser(db);
    await h.say(third.phoneE164, 'vendí 1 de pan');
    const sentTo: string[] = [];
    const recording = {
      ...h.channel,
      sendText: async (ctx: { userId: string }) => {
        sentTo.push(ctx.userId);
        return { waMessageId: 'wamid.test', outboundMessageId: 'none' };
      },
    } as unknown as typeof h.channel;
    await broadcastTechnicalIssue({ ...deps, channel: recording }, { startedAt });
    expect(sentTo).toContain(third.id);
    expect(sentTo).not.toContain(waiting.id);
    expect(sentTo).not.toContain(outside.id);
  });
});
