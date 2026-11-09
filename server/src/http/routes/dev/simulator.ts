/**
 * WhatsApp simulator (D46, Fase 3): `GET /dev/simulador`, only when `SIMULATOR_ENABLED=true`.
 *
 * A self-contained page plus a small JSON API under `/dev/simulador/api`. Every message she
 * «sends» is turned into a Meta webhook payload, signed, and posted through the same
 * `POST /webhook/whatsapp` path the real number will use; ALZA's answers are whatever the
 * simulated channel delivered. Development tool: it shows her data on screen, never in logs.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import {
  buildWebhookPayload,
  newWaMessageId,
  type OutgoingWebhookMessage,
  type SimulatorInboundContent,
  type SimulatorStore,
  signPayload,
} from '../../../channel/index.js';
import type { Db } from '../../../db/client.js';
import {
  clarifications,
  consents,
  inboundMessages,
  ledgerEntries,
  users,
} from '../../../db/schema.js';
import { formatSoles, isValidCloseTime, normalizeName } from '../../../domain/index.js';
import { CONSENT_TEXT_VERSION } from '../../../messages/consent.js';
import { REPO_ROOT } from '../../../paths.js';
import { SIMULATOR_PAGE } from './simulator-page.js';

export interface SimulatorRouterDeps {
  db: Db;
  store: SimulatorStore;
  /** Same secret the webhook checks. */
  appSecret: string;
  /** Posts a raw body to `POST /webhook/whatsapp` (in process). */
  postWebhook: (rawBody: string, signature: string) => Promise<Response>;
  now?: () => Date;
  /** Default: `<repo>/datasets`. */
  datasetsDir?: string;
}

const IMAGE_DIRS = ['yape-imgs', 'plin-imgs', 'bancon-imgs', 'luqea-imgs', 'generated'];
const AUDIO_DIRS = ['audios'];
const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
};

/** `987654321` → `+51987654321`; `+51…` and other E.164 numbers as they are. */
export function simulatorPhone(input: string): string | null {
  const compact = input.replace(/[\s\-().]/g, '');
  if (/^9\d{8}$/.test(compact)) return `+51${compact}`;
  if (/^51 ?9\d{8}$/.test(compact)) return `+${compact}`;
  if (/^\+\d{8,15}$/.test(compact)) return compact;
  return null;
}

const phoneSchema = z.string().transform((value, ctx) => {
  const phone = simulatorPhone(value);
  if (!phone) {
    ctx.addIssue({ code: 'custom', message: 'invalid_phone' });
    return z.NEVER;
  }
  return phone;
});

const sendSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    phone: phoneSchema,
    text: z.string().min(1).max(4_096),
    replyTo: z.string().max(256).optional(),
  }),
  z.object({
    kind: z.enum(['image', 'audio']),
    phone: phoneSchema,
    datasetPath: z.string().max(300).optional(),
    fileBase64: z.string().max(16_000_000).optional(),
    mimeType: z.string().max(100).optional(),
    caption: z.string().max(1_024).optional(),
    replyTo: z.string().max(256).optional(),
  }),
  z.object({
    kind: z.literal('button'),
    phone: phoneSchema,
    buttonId: z.string().min(1).max(256),
    buttonTitle: z.string().min(1).max(20),
    replyTo: z.string().max(256).optional(),
  }),
]);

const createUserSchema = z.object({
  phone: phoneSchema,
  businessName: z.string().trim().min(1).max(80).default('Bodega de prueba'),
  holderName: z.string().trim().min(2).max(80).default('Marta Quispe'),
  closeTime: z.string().refine(isValidCloseTime).default('21:00'),
});

function listDataset(root: string, dirs: string[]): string[] {
  const files: string[] = [];
  for (const dir of dirs) {
    const full = join(root, dir);
    let names: string[] = [];
    try {
      names = readdirSync(full);
    } catch {
      continue;
    }
    for (const name of names.sort()) {
      if (MIME_BY_EXT[extname(name).toLowerCase()]) files.push(`${dir}/${name}`);
    }
  }
  return files;
}

/** A dataset file path, only inside the allowed folders and with a known extension. */
function datasetFile(root: string, path: string): { file: string; mimeType: string } | null {
  const file = resolve(root, path);
  const rel = relative(root, file);
  if (rel.startsWith('..') || rel.includes(`..${sep}`)) return null;
  const [dir] = rel.split(sep);
  if (!dir || ![...IMAGE_DIRS, ...AUDIO_DIRS].includes(dir)) return null;
  const mimeType = MIME_BY_EXT[extname(file).toLowerCase()];
  if (!mimeType) return null;
  try {
    if (!statSync(file).isFile()) return null;
  } catch {
    return null;
  }
  return { file, mimeType };
}

export function createSimulatorRouter(deps: SimulatorRouterDeps): Hono {
  const router = new Hono();
  const now = deps.now ?? (() => new Date());
  const datasetsDir = deps.datasetsDir ?? join(REPO_ROOT, 'datasets');
  const { db, store } = deps;

  router.use('*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  router.get('/', (c) => c.html(SIMULATOR_PAGE));

  router.get('/api/users', async (c) => {
    const rows = await db
      .select({
        id: users.id,
        phone: users.phoneE164,
        businessName: users.businessName,
        onboardingStatus: users.onboardingStatus,
      })
      .from(users)
      .where(isNull(users.deletedAt))
      .orderBy(desc(users.createdAt))
      .limit(50);
    const known = new Set(rows.map((row) => row.phone));
    const memoryOnly = store.phones().filter((phone) => !known.has(phone));
    return c.json({
      users: [
        ...rows,
        ...memoryOnly.map((phone) => ({
          id: null,
          phone,
          businessName: null,
          onboardingStatus: null,
        })),
      ],
    });
  });

  /** A test user with onboarding complete and consent accepted (Fase 4 builds the real flow). */
  router.post('/api/users', bodyLimit({ maxSize: 4 * 1024 }), async (c) => {
    const parsed = createUserSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
    const input = parsed.data;
    const values = {
      businessName: input.businessName,
      accountHolderName: input.holderName,
      accountHolderNormalized: normalizeName(input.holderName),
      closeTime: input.closeTime,
      onboardingStatus: 'complete' as const,
    };
    const user = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(users)
        .values({ phoneE164: input.phone, ...values })
        .onConflictDoUpdate({ target: users.phoneE164, set: values })
        .returning();
      if (!row) throw new Error('user upsert returned no row');
      await tx
        .insert(consents)
        .values({ userId: row.id, textVersion: CONSENT_TEXT_VERSION, accepted: true });
      return row;
    });
    return c.json({ id: user.id, phone: user.phoneE164 }, 201);
  });

  router.get('/api/conversation', (c) => {
    const phone = simulatorPhone(c.req.query('phone') ?? '');
    if (!phone) return c.json({ error: 'invalid_phone' }, 400);
    const after = Number(c.req.query('after') ?? '0') || 0;
    return c.json({ phone, events: store.events(phone, after) });
  });

  router.post('/api/reset', bodyLimit({ maxSize: 1024 }), async (c) => {
    const body = (await c.req.json().catch(() => null)) as { phone?: string } | null;
    const phone = simulatorPhone(body?.phone ?? '');
    if (!phone) return c.json({ error: 'invalid_phone' }, 400);
    store.clear(phone);
    return c.json({ ok: true });
  });

  router.get('/api/datasets', (c) =>
    c.json({
      images: listDataset(datasetsDir, IMAGE_DIRS),
      audios: listDataset(datasetsDir, AUDIO_DIRS),
    }),
  );

  router.get('/api/dataset-file', (c) => {
    const found = datasetFile(datasetsDir, c.req.query('path') ?? '');
    if (!found) return c.json({ error: 'not_found' }, 404);
    return c.body(readFileSync(found.file), 200, { 'Content-Type': found.mimeType });
  });

  router.get('/api/media/:id', (c) => {
    const media = store.getMedia(c.req.param('id'));
    if (!media) return c.json({ error: 'not_found' }, 404);
    return c.body(new Uint8Array(media.bytes), 200, { 'Content-Type': media.mimeType });
  });

  router.post(
    '/api/send',
    bodyLimit({
      maxSize: 16 * 1024 * 1024,
      onError: (c) => c.json({ error: 'payload_too_large' }, 413),
    }),
    async (c) => {
      const parsed = sendSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
      const input = parsed.data;
      const waMessageId = newWaMessageId();
      let message: OutgoingWebhookMessage;
      let content: SimulatorInboundContent;

      if (input.kind === 'text') {
        message = { type: 'text', body: input.text };
        content = { type: 'text', body: input.text };
      } else if (input.kind === 'button') {
        message = { type: 'interactive', buttonId: input.buttonId, buttonTitle: input.buttonTitle };
        content = { type: 'interactive', buttonId: input.buttonId, buttonTitle: input.buttonTitle };
      } else {
        let bytes: Buffer;
        let mimeType: string;
        if (input.datasetPath) {
          const found = datasetFile(datasetsDir, input.datasetPath);
          if (!found) return c.json({ error: 'dataset_file_not_found' }, 404);
          bytes = readFileSync(found.file);
          mimeType = found.mimeType;
        } else if (input.fileBase64 && input.mimeType) {
          bytes = Buffer.from(input.fileBase64, 'base64');
          mimeType = input.mimeType.split(';')[0]?.trim() ?? '';
        } else {
          return c.json({ error: 'file_required' }, 400);
        }
        if (bytes.length === 0 || !mimeType.startsWith(`${input.kind}/`)) {
          return c.json({ error: 'invalid_file' }, 400);
        }
        const { mediaId, sha256 } = store.putMedia(bytes, mimeType);
        if (input.kind === 'image') {
          message = { type: 'image', mediaId, mimeType, sha256, caption: input.caption };
          content = {
            type: 'image',
            mediaId,
            ...(input.caption ? { caption: input.caption } : {}),
          };
        } else {
          message = { type: 'audio', mediaId, mimeType, sha256 };
          content = { type: 'audio', mediaId };
        }
      }

      store.addInbound(input.phone, waMessageId, content, input.replyTo);
      const raw = JSON.stringify(
        buildWebhookPayload({
          waMessageId,
          from: input.phone,
          sentAt: now(),
          message,
          replyToWaMessageId: input.replyTo ?? null,
        }),
      );
      const res = await deps.postWebhook(raw, signPayload(raw, deps.appSecret));
      if (res.status === 200) store.setTick(waMessageId, 'delivered');
      return c.json({ waMessageId, webhookStatus: res.status }, res.status === 200 ? 200 : 502);
    },
  );

  /** What the pipeline wrote for this phone (development view of the ledger). */
  router.get('/api/ledger', async (c) => {
    const phone = simulatorPhone(c.req.query('phone') ?? '');
    if (!phone) return c.json({ error: 'invalid_phone' }, 400);
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.phoneE164, phone), isNull(users.deletedAt)));
    if (!user) return c.json({ user: null, entries: [], clarifications: [], messages: [] });
    const [entries, doubts, messages] = await Promise.all([
      db
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.userId, user.id))
        .orderBy(desc(ledgerEntries.createdAt))
        .limit(40),
      db
        .select()
        .from(clarifications)
        .where(eq(clarifications.userId, user.id))
        .orderBy(desc(clarifications.createdAt))
        .limit(40),
      db
        .select({
          waMessageId: inboundMessages.waMessageId,
          type: inboundMessages.type,
          status: inboundMessages.status,
          attempts: inboundMessages.attempts,
          errorCode: inboundMessages.errorCode,
          receivedAt: inboundMessages.receivedAt,
        })
        .from(inboundMessages)
        .where(eq(inboundMessages.userId, user.id))
        .orderBy(desc(inboundMessages.receivedAt))
        .limit(40),
    ]);
    return c.json({
      user: {
        id: user.id,
        businessName: user.businessName,
        holderName: user.accountHolderName,
        onboardingStatus: user.onboardingStatus,
      },
      entries: entries.map((e) => ({
        id: e.id,
        businessDay: e.businessDay,
        amount: formatSoles(e.amountCents),
        direction: e.direction,
        paymentMethod: e.paymentMethod,
        category: e.category,
        label: e.label,
        status: e.status,
        source: e.source,
        counterparty: e.counterparty,
        afterClose: e.afterClose,
      })),
      clarifications: doubts.map((d) => ({
        id: d.id,
        businessDay: d.businessDay,
        type: d.type,
        status: d.status,
        priority: d.priority,
        ledgerEntryId: d.ledgerEntryId,
      })),
      messages,
    });
  });

  return router;
}
