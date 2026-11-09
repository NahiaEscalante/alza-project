import { type AnyColumn, and, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { consents, users } from '../db/schema.js';
import type { JobScope } from './types.js';

/** `<user id column> IN scope` when the run is scoped; nothing otherwise. */
export function userScope(column: AnyColumn, scope?: JobScope): SQL | undefined {
  return scope?.userIds ? inArray(column, [...scope.userIds]) : undefined;
}

/**
 * Users the 12:00 job works for: not deleted, onboarding complete (RF-ON-06) and whose latest
 * consent answer is «Acepto» (RF-ON-02, 14.1). Ordered by id so runs are deterministic.
 */
export async function listActiveUserIds(db: Db, scope?: JobScope): Promise<string[]> {
  const latestConsentAccepted = sql`(
    select ${consents.accepted} from ${consents}
    where ${consents.userId} = ${users.id}
    order by ${consents.createdAt} desc
    limit 1
  ) is true`;
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        isNull(users.deletedAt),
        eq(users.onboardingStatus, 'complete'),
        latestConsentAccepted,
        userScope(users.id, scope),
      ),
    )
    .orderBy(users.id);
  return rows.map((row) => row.id);
}
