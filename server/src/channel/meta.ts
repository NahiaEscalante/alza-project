/** Meta Cloud API transport (D37, D46, RF-IN-03/04). Retries belong to the pipeline. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { WhatsAppConfig } from '../config.js';
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
  type SentMessage,
  type TextMessage,
  type UploadedMedia,
} from './types.js';

const TIMEOUT_MS = 15_000;
const MAX_DOWNLOAD_BYTES = 16 * 1024 * 1024;
const idSchema = z.object({ id: z.string().min(1) });
const sentSchema = z.object({ messages: z.array(idSchema).min(1) });
const errorSchema = z.object({
  error: z.object({ code: z.number().optional(), is_transient: z.boolean().optional() }),
});
const TRANSIENT_META_CODES = new Set([1, 2, 4, 17, 32, 613, 80007, 130429, 131000, 131056]);
const mediaSchema = z.object({
  url: z.url(),
  mime_type: z.string().min(1),
  sha256: z.string().min(1),
  file_size: z.number().int().nonnegative().optional(),
});

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
export interface MetaChannelOptions {
  db: Db;
  config: Pick<WhatsAppConfig, 'accessToken' | 'phoneNumberId' | 'apiVersion'>;
  fetch?: Fetch;
}

export class MetaChannel implements Channel {
  readonly kind = 'meta' as const;
  private readonly fetch: Fetch;
  private readonly baseUrl: string;

  constructor(private readonly options: MetaChannelOptions) {
    if (
      !/^v\d+\.\d+$/.test(options.config.apiVersion) ||
      !/^\d+$/.test(options.config.phoneNumberId)
    ) {
      throw new ChannelError('rejected', 'invalid Meta configuration');
    }
    this.fetch = options.fetch ?? globalThis.fetch;
    this.baseUrl = `https://graph.facebook.com/${options.config.apiVersion}`;
  }

  async markAsRead(waMessageId: string): Promise<void> {
    this.parse(
      z.object({ success: z.literal(true) }),
      await this.json(`${this.options.config.phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: waMessageId,
      }),
    );
  }

  async sendText(ctx: OutboundContext, message: TextMessage): Promise<SentMessage> {
    assertValidText(message);
    return this.send(ctx, {
      type: 'text',
      text: { body: message.body, preview_url: message.previewUrl ?? false },
    });
  }

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

  async sendImage(ctx: OutboundContext, message: ImageMessage): Promise<SentMessage> {
    assertValidImage(message);
    return this.send(ctx, {
      type: 'image',
      image: {
        id: message.mediaId,
        ...(message.caption !== undefined ? { caption: message.caption } : {}),
      },
    });
  }

  async uploadMedia(media: { bytes: Buffer; mimeType: string }): Promise<UploadedMedia> {
    if (
      !['image/png', 'image/jpeg'].includes(media.mimeType) ||
      media.bytes.length === 0 ||
      media.bytes.length > 5 * 1024 * 1024
    ) {
      throw new ChannelError('limit_exceeded', 'invalid outbound image');
    }
    const body = new FormData();
    body.set('messaging_product', 'whatsapp');
    body.set('type', media.mimeType);
    body.set(
      'file',
      new Blob([new Uint8Array(media.bytes)], { type: media.mimeType }),
      media.mimeType === 'image/png' ? 'summary.png' : 'summary.jpg',
    );
    const response = await this.request(
      `${this.baseUrl}/${this.options.config.phoneNumberId}/media`,
      { method: 'POST', body },
    );
    return { mediaId: this.parse(idSchema, await this.readJson(response)).id };
  }

  async downloadMedia(mediaId: string): Promise<DownloadedMedia> {
    // Resolve a fresh URL on every attempt: Meta's download URLs expire.
    const metadata = this.parse(
      mediaSchema,
      await this.readJson(
        await this.request(
          `${this.baseUrl}/${encodeURIComponent(mediaId)}?phone_number_id=${this.options.config.phoneNumberId}`,
          { method: 'GET' },
          true,
        ),
      ),
    );
    const url = new URL(metadata.url);
    const allowed = ['facebook.com', 'fbcdn.net', 'fbsbx.com', 'whatsapp.net'].some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    );
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !allowed) {
      throw new ChannelError('rejected', 'invalid Meta media URL');
    }
    if (!/^(image|audio)\//.test(metadata.mime_type))
      throw new ChannelError('rejected', 'unsupported inbound media');
    const limit = metadata.mime_type.startsWith('image/') ? 5 * 1024 * 1024 : MAX_DOWNLOAD_BYTES;
    if ((metadata.file_size ?? 0) > limit)
      throw new ChannelError('limit_exceeded', 'media too large');
    const response = await this.request(url.href, { method: 'GET' }, true);
    const reader = response.body?.getReader();
    if (!reader) throw new ChannelError('unavailable', 'empty Meta media response');
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.length;
        if (length > limit) {
          await reader.cancel();
          throw new ChannelError('limit_exceeded', 'media too large');
        }
        chunks.push(chunk.value);
      }
    } catch (err) {
      if (err instanceof ChannelError) throw err;
      throw new ChannelError('unavailable', 'Meta media download failed');
    } finally {
      reader.releaseLock();
    }
    const bytes = Buffer.concat(chunks);
    const digest = createHash('sha256').update(bytes).digest();
    if (
      !bytes.length ||
      ![digest.toString('hex'), digest.toString('base64')].includes(metadata.sha256)
    ) {
      throw new ChannelError('unavailable', 'Meta media integrity check failed');
    }
    return { bytes, mimeType: metadata.mime_type, sha256: digest.toString('hex') };
  }

  private async send(ctx: OutboundContext, content: object): Promise<SentMessage> {
    assertValidContext(ctx);
    const data = this.parse(
      sentSchema,
      await this.json(`${this.options.config.phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: ctx.to.slice(1),
        ...(ctx.replyToWaMessageId ? { context: { message_id: ctx.replyToWaMessageId } } : {}),
        ...content,
      }),
    );
    const waMessageId = data.messages[0]?.id;
    if (!waMessageId) throw new ChannelError('unavailable', 'missing Meta message id');
    return {
      waMessageId,
      outboundMessageId: await recordOutbound(this.options.db, ctx, waMessageId),
    };
  }

  private async json(path: string, body: object): Promise<unknown> {
    return this.readJson(
      await this.request(`${this.baseUrl}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new ChannelError('unavailable', 'invalid Meta response');
    }
  }

  private parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success) throw new ChannelError('unavailable', 'invalid Meta response');
    return result.data;
  }

  private async request(url: string, init: RequestInit, media = false): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetch(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { ...init.headers, Authorization: `Bearer ${this.options.config.accessToken}` },
      });
    } catch {
      throw new ChannelError('unavailable', 'Meta request failed');
    }
    if (!response.ok) {
      const parsed = errorSchema.safeParse(await response.json().catch(() => null));
      const metaError = parsed.success ? parsed.data.error : null;
      const transient =
        metaError?.is_transient === true || TRANSIENT_META_CODES.has(metaError?.code ?? -1);
      const code =
        response.status === 401 || response.status === 403 || metaError?.code === 190
          ? 'unauthorized'
          : media && response.status === 404
            ? 'media_not_found'
            : response.status === 429 || response.status >= 500 || transient
              ? 'unavailable'
              : 'rejected';
      // Never preserve Meta error bodies, tokens, URLs or fetch causes in logs.
      throw new ChannelError(code, `Meta HTTP ${response.status}`);
    }
    return response;
  }
}
