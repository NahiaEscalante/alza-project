/**
 * RF-WP-08 (PR14, 11.3, case 25): after she marks the same incoming counterparty as «personal» 3
 * times, the web asks «¿Quieres que los Yapes de {contraparte} no cuenten como venta?». The rule
 * applies only if she accepts (to the payments that arrive later, through `decideCategory`) and she
 * can turn it off whenever she wants. Past records never change here.
 *
 * Her answer lives in `counterparty_rules` (direction `in`, category `personal`, source
 * `accepted`): `active` means accepted; inactive means declined or turned off. After an answer,
 * only marks made later count toward a new offer, so the same marks never ask twice.
 *
 * | Route                                     | Body                |
 * |-------------------------------------------|---------------------|
 * | GET  /counterparty-rules                  |                     |
 * | POST /counterparty-rules/accept 🔒        | { counterpartyKey } |
 * | POST /counterparty-rules/decline          | { counterpartyKey } |
 * | POST /counterparty-rules/deactivate 🔒    | { counterpartyKey } |
 *
 * `counterpartyKey` is the normalized name (`counterparty_normalized`) the GET returns.
 */
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import type { AuthEnv } from '../../../auth/index.js';
import type { Db } from '../../../db/client.js';
import {
  type CounterpartyRule,
  counterpartyRules,
  ledgerEntries,
  type PaymentMethod,
} from '../../../db/schema.js';
import { PERSONAL_RULE_OFFER_MARKS, shouldOfferPersonalRule } from '../../../domain/index.js';
import type { RouteDeps } from './deps.js';
import { jsonBodyLimit, noStore, notFound, readJson } from './http.js';

const LIVE = ['confirmed', 'pending'] as const;

const keyBody = z.object({ counterpartyKey: z.string().trim().min(1).max(200) });

/** «los Yapes de…», as in 11.3; other methods get their own word. */
const METHOD_PLURAL: Record<PaymentMethod, string> = {
  yape: 'Yapes',
  plin: 'Plin',
  bank_transfer: 'pagos',
  cash: 'pagos',
  unknown: 'pagos',
};

export const COUNTERPARTY_RULE_MESSAGES = {
  no_offer: 'Esta pregunta ya no está pendiente.',
  accepted: (name: string) => `Listo. Desde ahora, los pagos de ${name} no cuentan como venta.`,
  declined: (name: string) => `Listo. Los pagos de ${name} siguen contando como venta.`,
  deactivated: (name: string) =>
    `Listo. Desde ahora, los pagos de ${name} vuelven a contar como venta.`,
} as const;

export interface PersonalRuleOffer {
  counterpartyKey: string;
  /** As she sees it in her records (latest spelling). */
  counterparty: string;
  personalMarks: number;
  question: string;
  hint: string;
}

export interface PersonalRuleView {
  counterpartyKey: string;
  counterparty: string;
  since: string;
}

/** Her decision on the incoming «personal» rule for that counterparty, if any. */
const isActivePersonalRule = (rule: CounterpartyRule | undefined): boolean =>
  rule?.active === true && rule.source === 'accepted' && rule.category === 'personal';

async function loadState(db: Db, userId: string) {
  const [marks, rules] = await Promise.all([
    db
      .select({
        key: ledgerEntries.counterpartyNormalized,
        counterparty: ledgerEntries.counterparty,
        paymentMethod: ledgerEntries.paymentMethod,
        createdAt: ledgerEntries.createdAt,
      })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.userId, userId),
          eq(ledgerEntries.direction, 'in'),
          eq(ledgerEntries.category, 'personal'),
          inArray(ledgerEntries.status, LIVE),
          isNotNull(ledgerEntries.counterpartyNormalized),
        ),
      )
      .orderBy(desc(ledgerEntries.createdAt)),
    db
      .select()
      .from(counterpartyRules)
      .where(and(eq(counterpartyRules.userId, userId), eq(counterpartyRules.direction, 'in'))),
  ]);
  return { marks, rules: new Map(rules.map((rule) => [rule.counterpartyNormalized, rule])) };
}

export async function listPersonalRuleOffers(db: Db, userId: string): Promise<PersonalRuleOffer[]> {
  const { marks, rules } = await loadState(db, userId);
  const byKey = new Map<string, typeof marks>();
  for (const mark of marks) {
    const key = mark.key as string;
    const rule = rules.get(key);
    // After her answer, only later marks count toward asking again.
    if (rule && mark.createdAt.getTime() <= rule.updatedAt.getTime()) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), mark]);
  }
  const offers: PersonalRuleOffer[] = [];
  for (const [key, list] of byKey) {
    const hasActiveRule = isActivePersonalRule(rules.get(key));
    if (!shouldOfferPersonalRule({ personalMarks: list.length, hasActiveRule })) continue;
    const latest = list[0] as (typeof list)[number];
    const name = latest.counterparty ?? key;
    offers.push({
      counterpartyKey: key,
      counterparty: name,
      personalMarks: list.length,
      question: `¿Quieres que los ${METHOD_PLURAL[latest.paymentMethod]} de ${name} no cuenten como venta?`,
      hint: `Marcaste ${list.length} pagos de ${name} como personales. Si aceptas, los que lleguen desde ahora no contarán como venta. Puedes cambiarlo en Ajustes.`,
    });
  }
  return offers;
}

async function displayNames(db: Db, userId: string, keys: string[]): Promise<Map<string, string>> {
  if (keys.length === 0) return new Map();
  const rows = await db
    .select({ key: ledgerEntries.counterpartyNormalized, name: ledgerEntries.counterparty })
    .from(ledgerEntries)
    .where(
      and(eq(ledgerEntries.userId, userId), inArray(ledgerEntries.counterpartyNormalized, keys)),
    )
    .orderBy(desc(ledgerEntries.createdAt));
  const names = new Map<string, string>();
  for (const row of rows) {
    if (row.key && row.name && !names.has(row.key)) names.set(row.key, row.name);
  }
  return names;
}

export async function listPersonalRules(db: Db, userId: string): Promise<PersonalRuleView[]> {
  const { rules } = await loadState(db, userId);
  const active = [...rules.values()].filter(isActivePersonalRule);
  const names = await displayNames(
    db,
    userId,
    active.map((rule) => rule.counterpartyNormalized),
  );
  return active
    .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
    .map((rule) => ({
      counterpartyKey: rule.counterpartyNormalized,
      counterparty: names.get(rule.counterpartyNormalized) ?? rule.counterpartyNormalized,
      since: rule.updatedAt.toISOString(),
    }));
}

/**
 * Stamped with the database clock, like the entries' `created_at` it is compared with (the app and
 * the database may run on different machines).
 */
async function saveDecision(
  db: Db,
  userId: string,
  counterpartyKey: string,
  active: boolean,
): Promise<void> {
  const now = sql`now()`;
  await db
    .insert(counterpartyRules)
    .values({
      userId,
      counterpartyNormalized: counterpartyKey,
      direction: 'in',
      category: 'personal',
      source: 'accepted',
      active,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        counterpartyRules.userId,
        counterpartyRules.counterpartyNormalized,
        counterpartyRules.direction,
      ],
      set: { category: 'personal', source: 'accepted', active, updatedAt: now },
    });
}

export function registerCounterpartyRuleRoutes(router: Hono<AuthEnv>, deps: RouteDeps): void {
  const { db, requireSession, requireRecentPin } = deps;
  router.use('/counterparty-rules', noStore);
  router.use('/counterparty-rules/*', noStore);

  router.get('/counterparty-rules', requireSession, async (c) => {
    const { userId } = c.var.session;
    const [offers, rules] = await Promise.all([
      listPersonalRuleOffers(db, userId),
      listPersonalRules(db, userId),
    ]);
    return c.json({ offers, rules, offerMarks: PERSONAL_RULE_OFFER_MARKS });
  });

  const answer = (accept: boolean) => async (c: Context<AuthEnv>) => {
    const body = await readJson(c, keyBody);
    if (!body.ok) return body.response;
    const { userId } = c.var.session;
    const offer = (await listPersonalRuleOffers(db, userId)).find(
      (candidate) => candidate.counterpartyKey === body.data.counterpartyKey,
    );
    if (!offer) {
      return c.json({ error: 'no_offer', message: COUNTERPARTY_RULE_MESSAGES.no_offer }, 409);
    }
    await saveDecision(db, userId, offer.counterpartyKey, accept);
    const message = accept
      ? COUNTERPARTY_RULE_MESSAGES.accepted(offer.counterparty)
      : COUNTERPARTY_RULE_MESSAGES.declined(offer.counterparty);
    return c.json({ status: 'ok', message });
  };

  router.post(
    '/counterparty-rules/accept',
    requireSession,
    requireRecentPin,
    jsonBodyLimit,
    answer(true),
  );
  // Saying no changes nothing in her records: no PIN.
  router.post('/counterparty-rules/decline', requireSession, jsonBodyLimit, answer(false));

  router.post(
    '/counterparty-rules/deactivate',
    requireSession,
    requireRecentPin,
    jsonBodyLimit,
    async (c) => {
      const body = await readJson(c, keyBody);
      if (!body.ok) return body.response;
      const { userId } = c.var.session;
      const rule = (await listPersonalRules(db, userId)).find(
        (candidate) => candidate.counterpartyKey === body.data.counterpartyKey,
      );
      if (!rule) return notFound(c);
      await saveDecision(db, userId, rule.counterpartyKey, false);
      return c.json({
        status: 'ok',
        message: COUNTERPARTY_RULE_MESSAGES.deactivated(rule.counterparty),
      });
    },
  );
}
