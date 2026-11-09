/** 360dialog sandbox transport. Media by ID and read receipts are unavailable in this sandbox. */
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { assertValidButtons, assertValidContext, assertValidText } from './limits.js';
import { recordOutbound } from './outbound.js';
import {
  type ButtonsMessage,
  type Channel,
  ChannelError,
  type DownloadedMedia,
  type ImageMessage,
  type OutboundContext,
  type SentMessage,
  type TextMessage,
  type UploadedMedia,
} from './types.js';

export const DIALOG360_SANDBOX_URL = 'https://waba-sandbox.360dialog.io/v1';
const sentSchema = z.object({ messages: z.array(z.object({ id: z.string().min(1) })).min(1) });

export interface Dialog360Options {
  db: Db;
  apiKey: string;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
}

export class Dialog360SandboxChannel implements Channel {
  readonly kind = 'dialog360' as const;
  private readonly fetch: NonNullable<Dialog360Options['fetch']>;
  constructor(private readonly options: Dialog360Options) {
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  // Do not spend the 25-request allowance on an undocumented read-receipt endpoint.
  async markAsRead(_waMessageId: string): Promise<void> {}

  async sendText(ctx: OutboundContext, message: TextMessage): Promise<SentMessage> {
    assertValidText(message);
    return this.send(ctx, {
      type: 'text',
      text: { body: message.body, preview_url: message.previewUrl ?? false },
    });
  }

  /** Standard reply-button payload; its availability still needs a real sandbox test. */
  async sendButtons(ctx: OutboundContext, message: ButtonsMessage): Promise<SentMessage> {
    assertValidButtons(message);
    return this.send(ctx, {
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: message.body },
        action: { buttons: message.buttons.map((reply) => ({ type: 'reply', reply })) },
        ...(message.header !== undefined ? { header: { type: 'text', text: message.header } } : {}),
        ...(message.footer !== undefined ? { footer: { text: message.footer } } : {}),
      },
    });
  }

  async sendImage(_ctx: OutboundContext, _message: ImageMessage): Promise<SentMessage> {
    throw this.mediaUnavailable();
  }
  async uploadMedia(_media: { bytes: Buffer; mimeType: string }): Promise<UploadedMedia> {
    throw this.mediaUnavailable();
  }
  async downloadMedia(_mediaId: string): Promise<DownloadedMedia> {
    throw this.mediaUnavailable();
  }
  private mediaUnavailable(): ChannelError {
    return new ChannelError('unsupported', '360dialog sandbox does not support media by ID');
  }

  private async send(ctx: OutboundContext, content: object): Promise<SentMessage> {
    assertValidContext(ctx);
    let response: Response;
    try {
      response = await this.fetch(`${DIALOG360_SANDBOX_URL}/messages`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
        headers: { 'Content-Type': 'application/json', 'D360-API-KEY': this.options.apiKey },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: ctx.to.slice(1),
          ...(ctx.replyToWaMessageId ? { context: { message_id: ctx.replyToWaMessageId } } : {}),
          ...content,
        }),
      });
    } catch {
      throw new ChannelError('unavailable', '360dialog request failed');
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      const code =
        response.status === 429
          ? 'quota_exhausted'
          : response.status === 401
            ? 'unauthorized'
            : response.status >= 500
              ? 'unavailable'
              : 'rejected';
      // Raw provider errors may contain the key, number or message. Keep status only.
      throw new ChannelError(code, `360dialog HTTP ${response.status}`);
    }
    const parsed = sentSchema.safeParse(await response.json().catch(() => null));
    const waMessageId = parsed.success ? parsed.data.messages[0]?.id : undefined;
    if (!waMessageId) throw new ChannelError('unavailable', 'invalid 360dialog response');
    return {
      waMessageId,
      outboundMessageId: await recordOutbound(this.options.db, ctx, waMessageId),
    };
  }
}
