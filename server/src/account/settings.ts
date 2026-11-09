/**
 * Ajustes (RF-WP-09, RF-WP-10): summary with image or «solo texto» (D27) and up to 2 additional
 * Yape/Plin account holders (D31, enforced here). Hiding amounts is a per-phone view preference
 * kept in the browser only (D51): the server does not store it.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { checkHolderConflict } from '../antifraud/holder-conflict.js';
import type { Db } from '../db/client.js';
import { accountHolders, users } from '../db/schema.js';
import { MAX_ADDITIONAL_HOLDERS, normalizeName } from '../domain/index.js';
import { inTransaction } from '../ledger/types.js';

export const HOLDER_NAME_MAX = 80;

export const SETTINGS_MESSAGES = {
  too_many_holders: `Puedes agregar hasta ${MAX_ADDITIONAL_HOLDERS} titulares más.`,
  duplicate_holder: 'Ese titular ya está registrado.',
  invalid_holder: 'Escribe el nombre como aparece en Yape o Plin.',
} as const;

export type SettingsErrorCode = keyof typeof SETTINGS_MESSAGES;

export class SettingsError extends Error {
  readonly code: SettingsErrorCode;
  constructor(code: SettingsErrorCode) {
    super(SETTINGS_MESSAGES[code]);
    this.name = 'SettingsError';
    this.code = code;
  }
}

export interface SettingsView {
  businessName: string | null;
  accountHolderName: string | null;
  /** «21:00», Lima. */
  closeTime: string | null;
  summaryImage: boolean;
  additionalHolders: { id: string; name: string }[];
  maxAdditionalHolders: number;
}

export async function getSettings(db: Db, userId: string): Promise<SettingsView | null> {
  const [[user], holders] = await Promise.all([
    db.select().from(users).where(eq(users.id, userId)),
    db
      .select({ id: accountHolders.id, name: accountHolders.name })
      .from(accountHolders)
      .where(eq(accountHolders.userId, userId))
      .orderBy(asc(accountHolders.createdAt)),
  ]);
  if (!user) return null;
  return {
    businessName: user.businessName,
    accountHolderName: user.accountHolderName,
    closeTime: user.closeTime ? user.closeTime.slice(0, 5) : null,
    summaryImage: user.summaryImage,
    additionalHolders: holders,
    maxAdditionalHolders: MAX_ADDITIONAL_HOLDERS,
  };
}

const cleanName = (value: string) => value.replace(/\s+/g, ' ').trim();

export interface SettingsPatch {
  summaryImage?: boolean;
  /** The full list after the change (replaces the current one). */
  additionalHolders?: string[];
}

export async function updateSettings(
  db: Db,
  userId: string,
  patch: SettingsPatch,
  options: { now?: Date } = {},
): Promise<SettingsView> {
  await inTransaction(db, async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
    if (!user) throw new Error('user not found');

    if (patch.summaryImage !== undefined) {
      await tx.update(users).set({ summaryImage: patch.summaryImage }).where(eq(users.id, userId));
    }

    if (patch.additionalHolders !== undefined) {
      const wanted = new Map<string, string>();
      for (const raw of patch.additionalHolders) {
        const name = cleanName(raw);
        const normalized = normalizeName(name);
        if (name.length < 2 || name.length > HOLDER_NAME_MAX || normalized === '') {
          throw new SettingsError('invalid_holder');
        }
        if (normalized === user.accountHolderNormalized || wanted.has(normalized)) {
          throw new SettingsError('duplicate_holder');
        }
        wanted.set(normalized, name);
      }
      if (wanted.size > MAX_ADDITIONAL_HOLDERS) throw new SettingsError('too_many_holders');

      const current = await tx
        .select()
        .from(accountHolders)
        .where(eq(accountHolders.userId, userId));
      const removed = current.filter((holder) => !wanted.has(holder.nameNormalized));
      if (removed.length > 0) {
        await tx.delete(accountHolders).where(
          and(
            eq(accountHolders.userId, userId),
            inArray(
              accountHolders.id,
              removed.map((holder) => holder.id),
            ),
          ),
        );
      }
      const kept = new Set(current.map((holder) => holder.nameNormalized));
      const added = [...wanted].filter(([normalized]) => !kept.has(normalized));
      if (added.length > 0) {
        await tx
          .insert(accountHolders)
          .values(added.map(([nameNormalized, name]) => ({ userId, name, nameNormalized })));
        // 13.4 / case 22: a holder another account already has only raises an alert (and her
        // points wait for the review); saving it is never blocked.
        for (const [nameNormalized] of added) {
          await checkHolderConflict(tx, userId, nameNormalized, { now: options.now });
        }
      }
    }
  });
  return (await getSettings(db, userId)) as SettingsView;
}
