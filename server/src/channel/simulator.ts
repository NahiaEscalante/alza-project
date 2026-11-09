/**
 * Simulated WhatsApp channel (D46): same interface and limits as the Meta adapter, but messages
 * live in memory so `/dev/simulador` can show them. Outbound messages are still recorded in
 * `outbound_messages`, like the real adapter will.
 *
 * The store is per process (the HTTP server and the worker run together, `src/index.ts`) and is
 * lost on restart; it is a development tool, never enabled in production by default.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db/client.js';
import {
  assertValidButtons,
  assertValidContext,
  assertValidImage,
  assertValidText,
} from './limits.js';
import { recordOutbound } from './outbound.js';
import {
  type ButtonsMessage,
  type Channel,
  ChannelError,
  type DownloadedMedia,
  type ImageMessage,
  type OutboundContext,
  type ReplyButton,
  type SentMessage,
  type TextMessage,
  type UploadedMedia,
} from './types.js';

export type SimulatorTick = 'sent' | 'delivered' | 'read';

export type SimulatorInboundContent =
  | { type: 'text'; body: string }
  | { type: 'image'; mediaId: string; caption?: string }
  | { type: 'audio'; mediaId: string }
  | { type: 'interactive'; buttonId: string; buttonTitle: string };

export type SimulatorOutboundContent =
  | { type: 'text'; body: string }
  | {
      type: 'buttons';
      body: string;
      buttons: ReplyButton[];
      header?: string;
      footer?: string;
    }
  | { type: 'image'; mediaId: string; caption?: string };

export type SimulatorEvent =
  | {
      direction: 'inbound';
      seq: number;
      at: string;
      waMessageId: string;
      tick: SimulatorTick;
      content: SimulatorInboundContent;
      replyToWaMessageId?: string;
    }
  | {
      direction: 'outbound';
      seq: number;
      at: string;
      waMessageId: string;
      catalogId: string;
      content: SimulatorOutboundContent;
      replyToWaMessageId?: string;
    };

interface StoredMedia {
  bytes: Buffer;
  mimeType: string;
  sha256: string;
}

const MAX_EVENTS_PER_PHONE = 500;
const MAX_MEDIA_ITEMS = 300;

export function newWaMessageId(): string {
  return `wamid.SIM${randomBytes(12).toString('hex').toUpperCase()}`;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** In-memory conversations and media of the simulator. */
export class SimulatorStore {
  readonly #conversations = new Map<string, SimulatorEvent[]>();
  readonly #inboundPhone = new Map<string, string>();
  readonly #media = new Map<string, StoredMedia>();
  #seq = 0;
  readonly #now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.#now = options.now ?? (() => new Date());
  }

  phones(): string[] {
    return [...this.#conversations.keys()];
  }

  events(phone: string, afterSeq = 0): SimulatorEvent[] {
    return (this.#conversations.get(phone) ?? []).filter((event) => event.seq > afterSeq);
  }

  #push(phone: string, event: SimulatorEvent): void {
    const list = this.#conversations.get(phone) ?? [];
    list.push(event);
    if (list.length > MAX_EVENTS_PER_PHONE) list.splice(0, list.length - MAX_EVENTS_PER_PHONE);
    this.#conversations.set(phone, list);
  }

  /** A message she «sends» from the simulator UI (before it reaches the webhook). */
  addInbound(
    phone: string,
    waMessageId: string,
    content: SimulatorInboundContent,
    replyToWaMessageId?: string,
  ): SimulatorEvent {
    const event: SimulatorEvent = {
      direction: 'inbound',
      seq: ++this.#seq,
      at: this.#now().toISOString(),
      waMessageId,
      tick: 'sent',
      content,
      ...(replyToWaMessageId ? { replyToWaMessageId } : {}),
    };
    this.#push(phone, event);
    this.#inboundPhone.set(waMessageId, phone);
    return event;
  }

  addOutbound(
    phone: string,
    waMessageId: string,
    catalogId: string,
    content: SimulatorOutboundContent,
    replyToWaMessageId?: string,
  ): SimulatorEvent {
    const event: SimulatorEvent = {
      direction: 'outbound',
      seq: ++this.#seq,
      at: this.#now().toISOString(),
      waMessageId,
      catalogId,
      content,
      ...(replyToWaMessageId ? { replyToWaMessageId } : {}),
    };
    this.#push(phone, event);
    return event;
  }

  /** Moves an inbound tick forward (sent → delivered → read), never back. */
  setTick(waMessageId: string, tick: SimulatorTick): boolean {
    const phone = this.#inboundPhone.get(waMessageId);
    if (!phone) return false;
    const order: SimulatorTick[] = ['sent', 'delivered', 'read'];
    for (const event of this.#conversations.get(phone) ?? []) {
      if (event.direction === 'inbound' && event.waMessageId === waMessageId) {
        if (order.indexOf(tick) > order.indexOf(event.tick)) event.tick = tick;
        return true;
      }
    }
    return false;
  }

  tickOf(waMessageId: string): SimulatorTick | null {
    const phone = this.#inboundPhone.get(waMessageId);
    if (!phone) return null;
    for (const event of this.#conversations.get(phone) ?? []) {
      if (event.direction === 'inbound' && event.waMessageId === waMessageId) return event.tick;
    }
    return null;
  }

  putMedia(bytes: Buffer, mimeType: string): { mediaId: string; sha256: string } {
    const mediaId = `sim-media-${randomBytes(10).toString('hex')}`;
    const sha256 = sha256Hex(bytes);
    this.#media.set(mediaId, { bytes, mimeType, sha256 });
    while (this.#media.size > MAX_MEDIA_ITEMS) {
      const oldest = this.#media.keys().next().value;
      if (oldest === undefined) break;
      this.#media.delete(oldest);
    }
    return { mediaId, sha256 };
  }

  getMedia(mediaId: string): StoredMedia | null {
    return this.#media.get(mediaId) ?? null;
  }

  clear(phone: string): void {
    for (const event of this.#conversations.get(phone) ?? []) {
      if (event.direction === 'inbound') this.#inboundPhone.delete(event.waMessageId);
    }
    this.#conversations.delete(phone);
  }
}

export interface SimulatorChannelOptions {
  db: Db;
  store: SimulatorStore;
}

/** Channel adapter for the simulator: Meta's limits, memory transport, real `outbound_messages`. */
export class SimulatorChannel implements Channel {
  readonly kind = 'simulator' as const;
  readonly #db: Db;
  readonly #store: SimulatorStore;

  constructor(options: SimulatorChannelOptions) {
    this.#db = options.db;
    this.#store = options.store;
  }

  get store(): SimulatorStore {
    return this.#store;
  }

  async markAsRead(waMessageId: string): Promise<void> {
    this.#store.setTick(waMessageId, 'read');
  }

  async sendText(ctx: OutboundContext, message: TextMessage): Promise<SentMessage> {
    assertValidContext(ctx);
    assertValidText(message);
    return this.#deliver(ctx, { type: 'text', body: message.body });
  }

  async sendButtons(ctx: OutboundContext, message: ButtonsMessage): Promise<SentMessage> {
    assertValidContext(ctx);
    assertValidButtons(message);
    return this.#deliver(ctx, {
      type: 'buttons',
      body: message.body,
      buttons: message.buttons.map((b) => ({ id: b.id, title: b.title })),
      ...(message.header !== undefined ? { header: message.header } : {}),
      ...(message.footer !== undefined ? { footer: message.footer } : {}),
    });
  }

  async sendImage(ctx: OutboundContext, message: ImageMessage): Promise<SentMessage> {
    assertValidContext(ctx);
    assertValidImage(message);
    if (!this.#store.getMedia(message.mediaId)) {
      throw new ChannelError('media_not_found', 'unknown media id');
    }
    return this.#deliver(ctx, {
      type: 'image',
      mediaId: message.mediaId,
      ...(message.caption !== undefined ? { caption: message.caption } : {}),
    });
  }

  async uploadMedia(media: { bytes: Buffer; mimeType: string }): Promise<UploadedMedia> {
    if (media.bytes.length === 0) throw new ChannelError('limit_exceeded', 'empty media');
    // Meta: images up to 5 MB.
    if (media.bytes.length > 5 * 1024 * 1024) {
      throw new ChannelError('limit_exceeded', 'media larger than 5 MB');
    }
    return { mediaId: this.#store.putMedia(media.bytes, media.mimeType).mediaId };
  }

  async downloadMedia(mediaId: string): Promise<DownloadedMedia> {
    const media = this.#store.getMedia(mediaId);
    if (!media) throw new ChannelError('media_not_found', 'unknown or expired media id');
    return { bytes: media.bytes, mimeType: media.mimeType, sha256: sha256Hex(media.bytes) };
  }

  async #deliver(ctx: OutboundContext, content: SimulatorOutboundContent): Promise<SentMessage> {
    const waMessageId = newWaMessageId();
    const outboundMessageId = await recordOutbound(this.#db, ctx, waMessageId);
    this.#store.addOutbound(ctx.to, waMessageId, ctx.catalogId, content, ctx.replyToWaMessageId);
    return { waMessageId, outboundMessageId };
  }
}
