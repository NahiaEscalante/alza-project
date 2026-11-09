/**
 * Web links (14.3, D13, RF-WA-01/03/07/08). Only the token hash is stored.
 *
 * - Activation: 1 hour, single use (consumed when the PIN is created). Issuing a new one expires
 *   the earlier unused ones («olvidé mi PIN» twice → only the last link works).
 * - Access: 7 days, multi-use; on its own it never allows sensitive actions. One per close (WA-10)
 *   or per «web» (WA-13).
 *
 * Fase 4 calls `createActivationLink` (WA-06, WA-14) and `createAccessLink` (WA-10, WA-13).
 */
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  type AccessLink,
  type AccessLinkType,
  accessLinks,
  type User,
  users,
} from '../db/schema.js';
import { DAY_MS, HOUR_MS } from '../domain/index.js';
import { type DbOrTx, inTransaction } from '../ledger/types.js';
import { generateToken, hashToken, isWellFormedToken } from './tokens.js';

export const ACTIVATION_LINK_TTL_MS = HOUR_MS;
export const ACCESS_LINK_TTL_MS = 7 * DAY_MS;

/** Web routes the links open (wouter, `web/`). */
export const ACTIVATION_PATH = '/app/activar/';
export const ACCESS_PATH = '/app/entrar/';

export interface IssuedLink {
  linkId: string;
  /** Raw token: goes only inside the URL sent to her; never logged or stored. */
  token: string;
  url: string;
  expiresAt: Date;
}

export interface LinkOptions {
  /** `config.appBaseUrl`, e.g. `https://alza.up.railway.app` (no trailing slash). */
  baseUrl: string;
  now?: Date;
}

async function issue(
  db: DbOrTx,
  userId: string,
  type: AccessLinkType,
  options: LinkOptions,
): Promise<IssuedLink> {
  const now = options.now ?? new Date();
  const token = generateToken();
  const expiresAt = new Date(
    now.getTime() + (type === 'activation' ? ACTIVATION_LINK_TTL_MS : ACCESS_LINK_TTL_MS),
  );
  const link = await inTransaction(db, async (tx) => {
    if (type === 'activation') {
      await tx
        .update(accessLinks)
        .set({ expiresAt: now })
        .where(
          and(
            eq(accessLinks.userId, userId),
            eq(accessLinks.type, 'activation'),
            isNull(accessLinks.usedAt),
            gt(accessLinks.expiresAt, now),
          ),
        );
    }
    const [row] = await tx
      .insert(accessLinks)
      .values({ userId, tokenHash: hashToken(token), type, expiresAt, createdAt: now })
      .returning({ id: accessLinks.id });
    if (!row) throw new Error('insert returned no row');
    return row;
  });
  const base = options.baseUrl.replace(/\/+$/, '');
  const path = type === 'activation' ? ACTIVATION_PATH : ACCESS_PATH;
  return { linkId: link.id, token, url: `${base}${path}${token}`, expiresAt };
}

/** «Crea tu PIN» link (1 hour, single use). */
export function createActivationLink(
  db: DbOrTx,
  userId: string,
  options: LinkOptions,
): Promise<IssuedLink> {
  return issue(db, userId, 'activation', options);
}

/** «Ver todo (vale 7 días)» link. */
export function createAccessLink(
  db: DbOrTx,
  userId: string,
  options: LinkOptions,
): Promise<IssuedLink> {
  return issue(db, userId, 'access', options);
}

export type LinkLookup =
  | { ok: true; link: AccessLink; user: User }
  | { ok: false; reason: 'invalid' | 'expired' | 'used' };

/** Finds a link by its raw token. Deleted accounts have no valid links. */
export async function findLink(
  db: DbOrTx,
  token: unknown,
  type: AccessLinkType,
  now: Date,
): Promise<LinkLookup> {
  if (!isWellFormedToken(token)) return { ok: false, reason: 'invalid' };
  const [row] = await (db as Db)
    .select({ link: accessLinks, user: users })
    .from(accessLinks)
    .innerJoin(users, eq(users.id, accessLinks.userId))
    .where(
      and(
        eq(accessLinks.tokenHash, hashToken(token)),
        eq(accessLinks.type, type),
        isNull(users.deletedAt),
      ),
    );
  if (!row) return { ok: false, reason: 'invalid' };
  if (type === 'activation' && row.link.usedAt !== null) return { ok: false, reason: 'used' };
  if (row.link.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: 'expired' };
  return { ok: true, link: row.link, user: row.user };
}

/** Marks an activation link used, atomically; false if it was used or expired meanwhile. */
export async function consumeActivationLink(
  db: DbOrTx,
  linkId: string,
  now: Date,
): Promise<boolean> {
  const rows = await db
    .update(accessLinks)
    .set({ usedAt: now })
    .where(
      and(
        eq(accessLinks.id, linkId),
        eq(accessLinks.type, 'activation'),
        isNull(accessLinks.usedAt),
        gt(accessLinks.expiresAt, now),
      ),
    )
    .returning({ id: accessLinks.id });
  return rows.length === 1;
}
