/**
 * Meta Cloud API webhook payload (10.1): parsing what arrives and building it (the simulator posts
 * exactly this format through the same webhook).
 *
 * Only the four types ALZA handles are kept (`text`, `image`, `audio`, `interactive` button
 * replies). Delivery `statuses`, reactions, stickers, videos and documents are acknowledged and
 * ignored (case 14). Profile names in `contacts` are never read (minimization, 14.2).
 */
import { z } from 'zod';
import type { InboundMessageType } from '../db/schema.js';

/** One of her messages, normalized. */
export interface IncomingMessage {
  waMessageId: string;
  /** E.164 (`+51987654321`). */
  from: string;
  /** Meta's timestamp (when she sent it), clamped to the server clock. */
  sentAt: Date;
  type: InboundMessageType;
  /**
   * text: the body · image: the caption · interactive: the button reply **id** (a code chosen by
   * the catalog, e.g. `consent:accept`) · audio: null.
   */
  text: string | null;
  media: { id: string; mimeType: string; sha256: string | null } | null;
  buttonReply: { id: string; title: string } | null;
  /** `context.id`: the message she replied to with WhatsApp's «responder». */
  replyToWaMessageId: string | null;
}

const mediaSchema = z.object({
  id: z.string().min(1).max(256),
  mime_type: z.string().min(1).max(100),
  sha256: z.string().max(128).optional(),
  caption: z.string().max(4_096).optional(),
});

const messageSchema = z
  .object({
    id: z.string().min(1).max(256),
    from: z.string().regex(/^\d{8,15}$/),
    timestamp: z.string().regex(/^\d{1,12}$/),
    type: z.string(),
    text: z.object({ body: z.string().max(4_096) }).optional(),
    image: mediaSchema.optional(),
    audio: mediaSchema.optional(),
    interactive: z
      .object({
        type: z.string(),
        button_reply: z.object({ id: z.string().max(256), title: z.string().max(40) }).optional(),
        list_reply: z.object({ id: z.string().max(256), title: z.string().max(40) }).optional(),
      })
      .optional(),
    context: z.object({ id: z.string().max(256).optional() }).optional(),
  })
  .loose();

const payloadSchema = z.object({
  entry: z
    .array(
      z.object({
        changes: z
          .array(
            z.object({
              value: z
                .object({ messages: z.array(z.unknown()).optional() })
                .loose()
                .optional(),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
});

/** A sent-at more than this ahead of the server is not trusted. */
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

export interface ParsedWebhook {
  messages: IncomingMessage[];
  /** Messages of a type ALZA does not handle, or malformed (counted, never logged). */
  ignored: number;
  /** wa ids of ignored messages, so the webhook can still mark them as read (D04). */
  ignoredIds: string[];
}

/** Returns null when the body is not a Meta webhook payload at all. */
export function parseWebhookPayload(body: unknown, now: Date): ParsedWebhook | null {
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) return null;
  const messages: IncomingMessage[] = [];
  const ignoredIds: string[] = [];
  let ignored = 0;
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      for (const raw of change.value?.messages ?? []) {
        const message = toIncoming(raw, now);
        if (message) {
          messages.push(message);
        } else {
          ignored += 1;
          const id = (raw as { id?: unknown })?.id;
          if (typeof id === 'string' && id.length <= 256) ignoredIds.push(id);
        }
      }
    }
  }
  return { messages, ignored, ignoredIds };
}

function toIncoming(raw: unknown, now: Date): IncomingMessage | null {
  const parsed = messageSchema.safeParse(raw);
  if (!parsed.success) return null;
  const m = parsed.data;
  const seconds = Number(m.timestamp);
  const sentAtMs = seconds * 1000;
  const sentAt =
    Number.isFinite(sentAtMs) && sentAtMs > 0 && sentAtMs <= now.getTime() + MAX_CLOCK_SKEW_MS
      ? new Date(Math.min(sentAtMs, now.getTime()))
      : now;
  const base = {
    waMessageId: m.id,
    from: `+${m.from}`,
    sentAt,
    replyToWaMessageId: m.context?.id ?? null,
    buttonReply: null,
    media: null,
  };

  switch (m.type) {
    case 'text':
      if (!m.text) return null;
      return { ...base, type: 'text', text: m.text.body };
    case 'image':
    case 'audio': {
      const media = m.type === 'image' ? m.image : m.audio;
      if (!media) return null;
      return {
        ...base,
        type: m.type,
        text: m.type === 'image' ? (media.caption ?? null) : null,
        media: { id: media.id, mimeType: media.mime_type, sha256: media.sha256 ?? null },
      };
    }
    case 'interactive': {
      const reply = m.interactive?.button_reply ?? m.interactive?.list_reply;
      if (!reply) return null;
      return { ...base, type: 'interactive', text: reply.id, buttonReply: reply };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Building payloads (simulator, tests)
// ---------------------------------------------------------------------------

export type OutgoingWebhookMessage =
  | { type: 'text'; body: string }
  | { type: 'image'; mediaId: string; mimeType: string; sha256: string; caption?: string }
  | { type: 'audio'; mediaId: string; mimeType: string; sha256: string }
  | { type: 'interactive'; buttonId: string; buttonTitle: string };

export interface BuildPayloadInput {
  waMessageId: string;
  /** E.164 or bare digits. */
  from: string;
  sentAt: Date;
  message: OutgoingWebhookMessage;
  replyToWaMessageId?: string | null;
  /** Business phone number id (metadata). */
  phoneNumberId?: string;
}

/** A webhook body exactly as Meta sends it for one message. */
export function buildWebhookPayload(input: BuildPayloadInput): Record<string, unknown> {
  const digits = input.from.replace(/^\+/, '');
  const m = input.message;
  const message: Record<string, unknown> = {
    from: digits,
    id: input.waMessageId,
    timestamp: String(Math.floor(input.sentAt.getTime() / 1000)),
    type: m.type,
  };
  if (input.replyToWaMessageId) {
    message.context = { from: input.phoneNumberId ?? 'simulator', id: input.replyToWaMessageId };
  }
  if (m.type === 'text') message.text = { body: m.body };
  if (m.type === 'image') {
    message.image = {
      id: m.mediaId,
      mime_type: m.mimeType,
      sha256: m.sha256,
      ...(m.caption ? { caption: m.caption } : {}),
    };
  }
  if (m.type === 'audio') {
    message.audio = { id: m.mediaId, mime_type: m.mimeType, sha256: m.sha256, voice: true };
  }
  if (m.type === 'interactive') {
    message.interactive = {
      type: 'button_reply',
      button_reply: { id: m.buttonId, title: m.buttonTitle },
    };
  }
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'simulator',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: 'ALZA',
                phone_number_id: input.phoneNumberId ?? 'simulator',
              },
              messages: [message],
            },
          },
        ],
      },
    ],
  };
}
