/**
 * Receiving (RF-IN-01..03, 10.1): what the webhook does for each of her messages, fast (< 2 s).
 *
 * 1. Find her by phone, or create the user (RF-ON-01: onboarding `new`; Fase 4 greets her).
 * 2. Insert into `inbound_messages`; `wa_message_id` is unique, so a repeated delivery stops here
 *    (RF-IN-02). A repeat of a message still `received` is enqueued again (idempotent job id), in
 *    case the first delivery failed between the insert and the enqueue.
 * 3. Enqueue the processing job, then mark it as read (blue ticks, RF-IN-03, D04).
 *
 * Content is stored as it arrives; the worker erases it if she has not consented (RF-ON-02).
 */
import { eq, sql } from 'drizzle-orm';
import type { IncomingMessage } from '../channel/meta-payload.js';
import { inboundMessages, users } from '../db/schema.js';
import type { ReceiveDeps } from './deps.js';

export type ReceiveOutcome = 'accepted' | 'duplicate' | 'requeued';

/** Max time spent marking as read inside the webhook request. */
const MARK_AS_READ_TIMEOUT_MS = 1_000;

async function findOrCreateUser(deps: ReceiveDeps, phoneE164: string): Promise<string> {
  const [existing] = await deps.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.phoneE164, phoneE164));
  if (existing) return existing.id;
  await deps.db
    .insert(users)
    .values({ phoneE164, onboardingStatus: 'new', createdAt: deps.now() })
    .onConflictDoNothing({ target: users.phoneE164 });
  const [created] = await deps.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.phoneE164, phoneE164));
  if (!created) throw new Error('user insert returned no row');
  return created.id;
}

export async function markAsReadQuietly(deps: ReceiveDeps, waMessageId: string): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      deps.channel.markAsRead(waMessageId),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, MARK_AS_READ_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    deps.logger.warn({ err, waMessageId }, 'mark as read failed');
  } finally {
    clearTimeout(timer);
  }
}

export async function receiveMessage(
  deps: ReceiveDeps,
  message: IncomingMessage,
): Promise<{ outcome: ReceiveOutcome; inboundMessageId: string; userId: string }> {
  const userId = await findOrCreateUser(deps, message.from);
  const [inserted] = await deps.db
    .insert(inboundMessages)
    .values({
      waMessageId: message.waMessageId,
      userId,
      type: message.type,
      text: message.text,
      replyToWaMessageId: message.replyToWaMessageId,
      receivedAt: message.sentAt,
      status: 'received',
      waMediaId: message.media?.id ?? null,
    })
    .onConflictDoNothing({ target: inboundMessages.waMessageId })
    .returning({ id: inboundMessages.id });

  if (!inserted) {
    const [existing] = await deps.db
      .select({
        id: inboundMessages.id,
        userId: inboundMessages.userId,
        status: inboundMessages.status,
      })
      .from(inboundMessages)
      .where(eq(inboundMessages.waMessageId, message.waMessageId));
    if (!existing) throw new Error('inbound message vanished');
    if (existing.status === 'received') {
      await deps.queue.enqueue({ inboundMessageId: existing.id, userId: existing.userId });
      return { outcome: 'requeued', inboundMessageId: existing.id, userId: existing.userId };
    }
    return { outcome: 'duplicate', inboundMessageId: existing.id, userId: existing.userId };
  }

  // 24 h service window (users.last_message_at), only moving forward.
  await deps.db
    .update(users)
    .set({
      lastMessageAt: sql`greatest(${users.lastMessageAt}, ${message.sentAt.toISOString()}::timestamptz)`,
    })
    .where(eq(users.id, userId));

  await deps.queue.enqueue({ inboundMessageId: inserted.id, userId });
  await markAsReadQuietly(deps, message.waMessageId);
  deps.logger.info(
    { inboundMessageId: inserted.id, userId, waMessageId: message.waMessageId },
    'inbound message received',
  );
  return { outcome: 'accepted', inboundMessageId: inserted.id, userId };
}
