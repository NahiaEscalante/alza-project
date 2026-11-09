import { describe, expect, it } from 'vitest';
import { hasTestDb, TEST_DATABASE_URL } from '../../test/db.js';
import { createLogger } from '../lib/logger.js';
import { createBoss, QUEUE_TIMEZONE, scheduleInLima, startBoss, stopBoss } from './boss.js';

describe.skipIf(!hasTestDb)('pg-boss', () => {
  it('starts, schedules in America/Lima and stops', async () => {
    const boss = createBoss(TEST_DATABASE_URL, createLogger({ level: 'silent' }));
    await startBoss(boss);
    try {
      await scheduleInLima(boss, 'test-noon', '0 12 * * *');
      const [schedule] = await boss.getSchedules('test-noon');
      expect(schedule).toMatchObject({
        name: 'test-noon',
        cron: '0 12 * * *',
        timezone: QUEUE_TIMEZONE,
      });
      await boss.unschedule('test-noon');
    } finally {
      await stopBoss(boss, 2_000);
    }
  });
});
