import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, expectPgError, hasTestDb } from '../../test/db.js';
import {
  counterpartyRules,
  dailyCloses,
  inboundMessages,
  ledgerEntries,
  mediaFiles,
  type NewLedgerEntry,
  users,
} from './schema.js';

const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';

/** Constraints from spec 9.1 that protect idempotency and the ledger. */
describe.skipIf(!hasTestDb)('schema constraints', () => {
  const { pool, db } = createTestDb();
  let userId: string;

  beforeAll(async () => {
    const [user] = await db
      .insert(users)
      .values({ phoneE164: `+519${Math.floor(Math.random() * 1e8)}` })
      .returning({ id: users.id });
    userId = user?.id ?? '';
  });
  afterAll(() => pool.end());

  const entry = (overrides: Partial<NewLedgerEntry> = {}): NewLedgerEntry => ({
    userId,
    businessDay: '2026-11-08',
    amountCents: 1250,
    direction: 'in',
    paymentMethod: 'yape',
    category: 'sale',
    label: 'screenshot',
    status: 'confirmed',
    source: 'screenshot',
    createdBy: 'system',
    ...overrides,
  });

  it('defaults a new user to onboarding status «new» with summary image on', async () => {
    const [user] = await db
      .insert(users)
      .values({ phoneE164: `+518${Math.floor(Math.random() * 1e8)}` })
      .returning();
    expect(user).toMatchObject({ onboardingStatus: 'new', summaryImage: true, deletedAt: null });
  });

  it('processes each WhatsApp message once: wa_message_id is unique', async () => {
    const message = {
      waMessageId: `wamid.${randomUUID()}`,
      userId,
      type: 'text' as const,
      receivedAt: new Date(),
    };
    await db.insert(inboundMessages).values(message);
    expect(await expectPgError(() => db.insert(inboundMessages).values(message))).toBe(
      UNIQUE_VIOLATION,
    );
  });

  it('stores a file once per user and SHA-256', async () => {
    const file = {
      userId,
      sha256: randomUUID(),
      mimeType: 'image/jpeg',
      storageKey: `media/${userId}/${randomUUID()}`,
      deleteAfter: new Date(),
    };
    await db.insert(mediaFiles).values(file);
    expect(
      await expectPgError(() =>
        db.insert(mediaFiles).values({ ...file, storageKey: `${file.storageKey}-2` }),
      ),
    ).toBe(UNIQUE_VIOLATION);
  });

  it('rejects amounts that are not positive cents', async () => {
    for (const amountCents of [0, -100]) {
      expect(
        await expectPgError(() => db.insert(ledgerEntries).values(entry({ amountCents }))),
      ).toBe(CHECK_VIOLATION);
    }
  });

  it('rejects enum values outside the vocabulary', async () => {
    const bad = entry({ paymentMethod: 'efectivo' as never });
    expect(await expectPgError(() => db.insert(ledgerEntries).values(bad))).toBe(CHECK_VIOLATION);
  });

  it('allows one live entry per operation number and payment method (11.4)', async () => {
    const operationNumber = randomUUID().slice(0, 8);
    const [first] = await db
      .insert(ledgerEntries)
      .values(entry({ operationNumber }))
      .returning({ id: ledgerEntries.id });

    // Same number, still live → rejected (confirmed or pending).
    for (const status of ['confirmed', 'pending'] as const) {
      expect(
        await expectPgError(() =>
          db.insert(ledgerEntries).values(entry({ operationNumber, status })),
        ),
      ).toBe(UNIQUE_VIOLATION);
    }
    // Same number on another payment method, or kept as duplicate/voided/superseded → allowed.
    await db.insert(ledgerEntries).values(entry({ operationNumber, paymentMethod: 'plin' }));
    await db.insert(ledgerEntries).values(entry({ operationNumber, status: 'duplicate' }));
    await db
      .insert(ledgerEntries)
      .values(entry({ operationNumber, status: 'superseded', replacesEntryId: first?.id }));
    // Entries without an operation number never collide.
    await db.insert(ledgerEntries).values([entry(), entry()]);
  });

  it('keeps one close per user and business day', async () => {
    const close = { userId, businessDay: '2026-11-07' };
    await db.insert(dailyCloses).values(close);
    expect(await expectPgError(() => db.insert(dailyCloses).values(close))).toBe(UNIQUE_VIOLATION);
  });

  it('keeps one counterparty rule per counterparty and direction', async () => {
    const rule = {
      userId,
      counterpartyNormalized: 'ana torres',
      direction: 'out' as const,
      category: 'inventory' as const,
      source: 'memory' as const,
    };
    await db.insert(counterpartyRules).values(rule);
    await db.insert(counterpartyRules).values({ ...rule, direction: 'in', category: 'personal' });
    expect(await expectPgError(() => db.insert(counterpartyRules).values(rule))).toBe(
      UNIQUE_VIOLATION,
    );
  });
});
