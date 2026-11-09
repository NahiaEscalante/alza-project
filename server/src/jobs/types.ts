import type { Db } from '../db/client.js';
import type { Logger } from '../lib/logger.js';
import type { BlobStorage } from '../storage/blob-storage.js';

/** What every scheduled task needs (8.4). Dependencies by parameter, the clock included. */
export interface ScheduledJobsDeps {
  db: Db;
  /** Only `delete` is used: originals after 30 days (PR07). */
  storage: Pick<BlobStorage, 'delete'>;
  logger: Logger;
  /** Clock for the cron handlers. Defaults to the real one; the demo can pass a fake one. */
  now?: () => Date;
}

/**
 * Limits a run to some rows (one user from the admin panel, or the rows of a test, since tests
 * share one database). Without a scope a task touches everything. With a scope, user tables are
 * limited to `userIds` and the waitlist to `waitlistIds` (no `waitlistIds` → waitlist untouched).
 */
export interface JobScope {
  userIds?: readonly string[];
  waitlistIds?: readonly string[];
}
