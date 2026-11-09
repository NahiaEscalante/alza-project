/**
 * Account deletion (RF-PV-01, 14.2, 14.6, HU-15): her personal data and files go; only an
 * anonymous record stays that the account existed and was deleted: the `users` row keeps its
 * random id, `created_at` and `deleted_at`, with the phone replaced by `deleted:<id>` and every
 * other personal field emptied (the Telegram chat too, D72). Everything that hangs from her is deleted, including a waitlist
 * signup with the same phone (D52).
 *
 * Idempotent and synchronous (well inside the 48 h). Files first: if the database step fails, a
 * retry finds the account still undeleted and finishes it. Fase 4 («borra mis datos») reuses it
 * and sends WA-16 itself.
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  accessLinks,
  accountHolders,
  alerts,
  chatMessages,
  clarifications,
  consents,
  counterpartyRules,
  dailyCloses,
  inboundMessages,
  ledgerEntries,
  mediaFiles,
  outboundMessages,
  pins,
  pointsEntries,
  proposedActions,
  redemptions,
  reports,
  streaks,
  trustedDevices,
  users,
  waitlistSignups,
} from '../db/schema.js';
import { inTransaction } from '../ledger/types.js';
import type { BlobStorage } from '../storage/blob-storage.js';

export interface DeleteAccountDeps {
  db: Db;
  storage: Pick<BlobStorage, 'delete'>;
}

export type DeleteAccountResult =
  | { status: 'deleted'; filesDeleted: number }
  | { status: 'already_deleted' }
  | { status: 'not_found' };

/** WA-16; also shown in the web when it finishes. */
export const ACCOUNT_DELETED_TEXT = 'Listo, borré tus datos. Gracias por usar ALZA.';

export function anonymousPhone(userId: string): string {
  return `deleted:${userId}`;
}

export async function deleteAccount(
  deps: DeleteAccountDeps,
  userId: string,
  options: { now?: Date } = {},
): Promise<DeleteAccountResult> {
  const { db, storage } = deps;
  const now = options.now ?? new Date();
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return { status: 'not_found' };
  if (user.deletedAt) return { status: 'already_deleted' };

  const [media, userReports] = await Promise.all([
    db.select({ key: mediaFiles.storageKey }).from(mediaFiles).where(eq(mediaFiles.userId, userId)),
    db
      .select({ pdf: reports.pdfStorageKey, xlsx: reports.xlsxStorageKey })
      .from(reports)
      .where(eq(reports.userId, userId)),
  ]);
  const keys = [
    ...media.map((row) => row.key),
    ...userReports.flatMap((row) => [row.pdf, row.xlsx]),
  ].filter((key): key is string => typeof key === 'string' && key !== '');
  let filesDeleted = 0;
  for (const key of new Set(keys)) if (await storage.delete(key)) filesDeleted += 1;

  await inTransaction(db, async (tx) => {
    await tx.delete(waitlistSignups).where(eq(waitlistSignups.phoneE164, user.phoneE164));
    // Children first; ledger_entry_events and extractions go by cascade.
    for (const table of [
      chatMessages,
      proposedActions,
      reports,
      outboundMessages,
      alerts,
      redemptions,
      pointsEntries,
      streaks,
      counterpartyRules,
      pins,
      accessLinks,
      trustedDevices,
      clarifications,
      dailyCloses,
      ledgerEntries,
      inboundMessages,
      mediaFiles,
      accountHolders,
      consents,
    ]) {
      await tx.delete(table).where(eq(table.userId, userId));
    }
    await tx
      .update(users)
      .set({
        phoneE164: anonymousPhone(userId),
        businessName: null,
        accountHolderName: null,
        accountHolderNormalized: null,
        closeTime: null,
        summaryImage: true,
        lastMessageAt: null,
        // D72: the Telegram chat is unlinked; writing again starts a new account.
        telegramChatId: null,
        deletedAt: now,
      })
      .where(eq(users.id, userId));
  });
  return { status: 'deleted', filesDeleted };
}
