/**
 * RF-AD-04 / 14.4: «cada acción queda registrada con quién la hizo». Every panel action that
 * changes something (and every login and logout) writes one `admin_audit_log` row: who, what,
 * on which row, when. `detail` carries ids, counts and outcomes only: never message text,
 * amounts, names, phones or redemption codes.
 */
import { desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { adminAuditLog, adminUsers } from '../db/schema.js';
import type { DbOrTx } from '../ledger/types.js';

export const ADMIN_ACTIONS = [
  'auth.login',
  'auth.logout',
  'inbound_message.retry',
  'inbound_message.retry_all',
  'redemption.approve',
  'redemption.reject',
  'alert.review',
  'job.close_finalize',
  'job.antifraud_scan',
  'broadcast.technical_issue',
] as const;
export type AdminAction = (typeof ADMIN_ACTIONS)[number];

export type AuditTargetType = 'admin_user' | 'inbound_message' | 'redemption' | 'alert' | 'job';

/** Only plain values: ids, counts, dates, codes. */
export type AuditDetail = Record<
  string,
  string | number | boolean | null | readonly string[] | Record<string, string | number>
>;

export interface AuditEntryInput {
  adminUserId: string;
  action: AdminAction;
  targetType?: AuditTargetType;
  targetId?: string | null;
  detail?: AuditDetail;
  at: Date;
}

export async function recordAdminAction(db: DbOrTx, entry: AuditEntryInput): Promise<void> {
  await db.insert(adminAuditLog).values({
    adminUserId: entry.adminUserId,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    detail: entry.detail ?? null,
    createdAt: entry.at,
  });
}

export interface AuditLogItem {
  id: string;
  at: string;
  admin: { id: string; username: string; name: string };
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: unknown;
}

export async function listAuditLog(db: Db, options: { limit?: number } = {}) {
  const rows = await db
    .select({
      id: adminAuditLog.id,
      at: adminAuditLog.createdAt,
      adminId: adminUsers.id,
      username: adminUsers.email,
      adminName: adminUsers.name,
      action: adminAuditLog.action,
      targetType: adminAuditLog.targetType,
      targetId: adminAuditLog.targetId,
      detail: adminAuditLog.detail,
    })
    .from(adminAuditLog)
    .innerJoin(adminUsers, eq(adminUsers.id, adminAuditLog.adminUserId))
    .orderBy(desc(adminAuditLog.createdAt), desc(adminAuditLog.id))
    .limit(options.limit ?? 100);
  return rows.map(
    (row): AuditLogItem => ({
      id: row.id,
      at: row.at.toISOString(),
      admin: { id: row.adminId, username: row.username, name: row.adminName },
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      detail: row.detail,
    }),
  );
}
