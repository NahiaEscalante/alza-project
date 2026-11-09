/**
 * D28 / RF-CI-11 / case 30: after 5 wrong PINs, the next close carries one line. Stored as an
 * `alerts` row of type `pin_lockout` (also visible to the team in the panel), with
 * `detail.closeNotice` = `pending` until the close composer (Fase 5) shows it and calls
 * `markSecurityNoticesShown`. Several lockouts before a close still give a single line.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { type AlertType, alerts } from '../db/schema.js';
import type { DbOrTx } from '../ledger/types.js';

export const PIN_LOCKOUT_ALERT: AlertType = 'pin_lockout';

/** The close line (WA-10, D28). */
export const SECURITY_NOTICE_TEXT =
  'Alguien intentó entrar a tu web con un PIN incorrecto. Si no fuiste tú, cambia tu PIN.';

export async function recordPinLockoutNotice(
  db: DbOrTx,
  userId: string,
  now: Date,
  lockedUntil: Date | null,
): Promise<void> {
  await db.insert(alerts).values({
    userId,
    type: PIN_LOCKOUT_ALERT,
    status: 'open',
    detail: {
      closeNotice: 'pending',
      at: now.toISOString(),
      lockedUntil: lockedUntil?.toISOString() ?? null,
    },
    createdAt: now,
  });
}

const pendingNotice = (userId: string) =>
  and(
    eq(alerts.userId, userId),
    eq(alerts.type, PIN_LOCKOUT_ALERT),
    sql`${alerts.detail}->>'closeNotice' = 'pending'`,
  );

/** For the close composer: include `SECURITY_NOTICE_TEXT`? */
export async function hasPendingSecurityNotice(db: Db, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: alerts.id })
    .from(alerts)
    .where(pendingNotice(userId))
    .limit(1);
  return rows.length > 0;
}

/** After the close with the line was sent. */
export async function markSecurityNoticesShown(
  db: DbOrTx,
  userId: string,
  now: Date,
): Promise<number> {
  const rows = await db
    .update(alerts)
    .set({
      detail: sql`coalesce(${alerts.detail}, '{}'::jsonb) || jsonb_build_object('closeNotice', 'shown', 'shownAt', ${now.toISOString()}::text)`,
    })
    .where(pendingNotice(userId))
    .returning({ id: alerts.id });
  return rows.length;
}
