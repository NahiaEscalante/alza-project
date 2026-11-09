/**
 * ALZA data model: spec section 9.1, translated to English with the CLAUDE.md vocabulary (D32).
 *
 * Conventions
 * - Money: integer cents (`*_cents`). Never floats.
 * - Timestamps: `timestamptz`. `business_day` is a `date` (4:00–3:59 America/Lima, D12),
 *   computed by the domain layer, never by the database.
 * - Enum-like columns are `text` + a CHECK constraint built from the `as const` arrays below.
 *   Arrays marked [provisional] have no CHECK yet: the spec does not list their values.
 * - Spec columns named `at` are `created_at` here.
 * - Nothing in the ledger is deleted: corrections create a new row (`replaces_entry_id`) and the
 *   old one becomes `superseded` or `voided`. `onDelete: 'cascade'` on `user_id` exists only for
 *   account deletion (RF-PV-01).
 *
 * Kept in one file on purpose: drizzle-kit loads it without resolving relative imports.
 */
import { type SQL, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Enum values. CLAUDE.md «Valores» table (exact):
// ---------------------------------------------------------------------------

/** dirección: entra → in · sale → out */
export const DIRECTIONS = ['in', 'out'] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** medio: yape · plin · efectivo → cash · transferencia → bank_transfer · desconocido → unknown */
export const PAYMENT_METHODS = ['yape', 'plin', 'cash', 'bank_transfer', 'unknown'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** categoría: venta, otro_ingreso, mercadería, gasto, casa, por_clasificar, interno, personal */
export const CATEGORIES = [
  'sale',
  'other_income',
  'inventory',
  'expense',
  'household',
  'unclassified',
  'internal',
  'personal',
] as const;
export type Category = (typeof CATEGORIES)[number];

/** alcance (extraction output, 10.2): operación → single · total parcial · total del día */
export const SCOPES = ['single', 'partial_total', 'day_total'] as const;
export type Scope = (typeof SCOPES)[number];

/** estado del movimiento: confirmado, pendiente, duplicado, anulado → voided, reemplazado → superseded */
export const LEDGER_ENTRY_STATUSES = [
  'confirmed',
  'pending',
  'duplicate',
  'voided',
  'superseded',
] as const;
export type LedgerEntryStatus = (typeof LEDGER_ENTRY_STATUSES)[number];

/** etiqueta: con_captura → screenshot · lo_contaste → self_reported · sin_detalle → unitemized */
export const LEDGER_LABELS = ['screenshot', 'self_reported', 'unitemized'] as const;
export type LedgerLabel = (typeof LEDGER_LABELS)[number];

/** nivel del cierre: completo · parcial · sin_cierre → no_close */
export const CLOSE_LEVELS = ['complete', 'partial', 'no_close'] as const;
export type CloseLevel = (typeof CLOSE_LEVELS)[number];

/** cuadre: cuadra → balanced · ajustado → adjusted · no_sabe → unsure · sin_respuesta → no_answer */
export const CASH_CHECK_RESULTS = ['balanced', 'adjusted', 'unsure', 'no_answer'] as const;
export type CashCheckResult = (typeof CASH_CHECK_RESULTS)[number];

/** tipo de duda (11.8) */
export const CLARIFICATION_TYPES = [
  'ambiguous_total',
  'possible_duplicate',
  'unreadable',
  'direction',
  'date',
  'category',
  'missing_from_list',
] as const;
export type ClarificationType = (typeof CLARIFICATION_TYPES)[number];

/** intención (interpretation output, not a column) */
export const INTENTS = [
  'record',
  'correct',
  'close_reply',
  'request',
  'danger',
  'close_now',
  'other',
] as const;
export type Intent = (typeof INTENTS)[number];

// ---------------------------------------------------------------------------
// Enum values not in CLAUDE.md, translated from spec 9.1 / 9.2 (spec → code):
// ---------------------------------------------------------------------------

/**
 * usuarias.estado_alta: nuevo → new · esperando_consentimiento → awaiting_consent ·
 * negocio → business_name · titular → account_holder · hora → close_time ·
 * completa → complete · rechazada → declined
 */
export const ONBOARDING_STATUSES = [
  'new',
  'awaiting_consent',
  'business_name',
  'account_holder',
  'close_time',
  'complete',
  'declined',
] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

/** mensajes_entrantes.tipo (already English in the spec, Meta's names) */
export const INBOUND_MESSAGE_TYPES = ['image', 'audio', 'text', 'interactive'] as const;
export type InboundMessageType = (typeof INBOUND_MESSAGE_TYPES)[number];

/**
 * mensajes_entrantes.estado (9.2): recibido → received ·
 * descartado_sin_consentimiento → discarded_no_consent · procesando → processing ·
 * registrado → recorded · pendiente → pending · ilegible → unreadable · duplicado → duplicate ·
 * no_financiero → non_financial · pedido_atendido → request_handled · error → error ·
 * error_definitivo → failed
 */
export const INBOUND_MESSAGE_STATUSES = [
  'received',
  'discarded_no_consent',
  'processing',
  'recorded',
  'pending',
  'unreadable',
  'duplicate',
  'non_financial',
  'request_handled',
  'error',
  'failed',
] as const;
export type InboundMessageStatus = (typeof INBOUND_MESSAGE_STATUSES)[number];

/**
 * extracciones.funcion (AI layer functions, 8.3): clasificar_imagen → classify_image ·
 * extraer_captura → extract_screenshot · transcribir_audio → transcribe_audio ·
 * interpretar_texto → interpret_text · interpretar_respuesta_cierre → interpret_close_reply · chat
 */
export const EXTRACTION_FUNCTIONS = [
  'classify_image',
  'extract_screenshot',
  'transcribe_audio',
  'interpret_text',
  'interpret_close_reply',
  'chat',
] as const;
export type ExtractionFunction = (typeof EXTRACTION_FUNCTIONS)[number];

/**
 * movimientos.origen: captura → screenshot · lista → activity_list · texto → text ·
 * audio → audio · respuesta_cierre → close_reply · web → web · chat → chat
 */
export const LEDGER_ENTRY_SOURCES = [
  'screenshot',
  'activity_list',
  'text',
  'audio',
  'close_reply',
  'web',
  'chat',
] as const;
export type LedgerEntrySource = (typeof LEDGER_ENTRY_SOURCES)[number];

/** movimientos.creado_por: sistema → system · usuaria → user · panel → admin */
export const CREATED_BY = ['system', 'user', 'admin'] as const;
export type CreatedBy = (typeof CREATED_BY)[number];

/**
 * movimientos_eventos.evento: creado → created · confirmado → confirmed · anulado → voided ·
 * reemplazado → superseded · resuelto → resolved
 */
export const LEDGER_ENTRY_EVENTS = [
  'created',
  'confirmed',
  'voided',
  'superseded',
  'resolved',
] as const;
export type LedgerEntryEvent = (typeof LEDGER_ENTRY_EVENTS)[number];

/**
 * dudas.estado (9.2): abierta → open · en_mensaje → in_message · resuelta → resolved ·
 * en_web → in_web · resuelta_web → resolved_web
 */
export const CLARIFICATION_STATUSES = [
  'open',
  'in_message',
  'resolved',
  'in_web',
  'resolved_web',
] as const;
export type ClarificationStatus = (typeof CLARIFICATION_STATUSES)[number];

/**
 * cierres.estado (9.2): abierto → open · sin_actividad → no_activity · enviado → sent ·
 * esperando_aclaracion → awaiting_clarification · respondido → replied · vencido → expired ·
 * final → final
 */
export const DAILY_CLOSE_STATUSES = [
  'open',
  'no_activity',
  'sent',
  'awaiting_clarification',
  'replied',
  'expired',
  'final',
] as const;
export type DailyCloseStatus = (typeof DAILY_CLOSE_STATUSES)[number];

/**
 * puntos_movimientos.tipo (13.1): cierre_completo → complete_close ·
 * cierre_parcial → partial_close · racha_7 → streak_7 · racha_30 → streak_30 ·
 * semana → weekly_bonus · primera_racha → first_streak · canje → redemption ·
 * ajuste → adjustment · vencimiento → expiration
 */
export const POINTS_ENTRY_TYPES = [
  'complete_close',
  'partial_close',
  'streak_7',
  'streak_30',
  'weekly_bonus',
  'first_streak',
  'redemption',
  'adjustment',
  'expiration',
] as const;
export type PointsEntryType = (typeof POINTS_ENTRY_TYPES)[number];

/** canjes.estado: entregado → delivered · en_revision → in_review · rechazado → rejected */
export const REDEMPTION_STATUSES = ['delivered', 'in_review', 'rejected'] as const;
export type RedemptionStatus = (typeof REDEMPTION_STATUSES)[number];

/** reglas_contraparte.origen (PR14): memoria → memory · aceptada → accepted */
export const COUNTERPARTY_RULE_SOURCES = ['memory', 'accepted'] as const;
export type CounterpartyRuleSource = (typeof COUNTERPARTY_RULE_SOURCES)[number];

/** enlaces_acceso.tipo (14.3): activacion → activation (1 h) · acceso_7d → access (7 days) */
export const ACCESS_LINK_TYPES = ['activation', 'access'] as const;
export type AccessLinkType = (typeof ACCESS_LINK_TYPES)[number];

/** chat_mensajes.rol */
export const CHAT_ROLES = ['user', 'assistant'] as const;
export type ChatRole = (typeof CHAT_ROLES)[number];

/** [provisional, Fase 8] acciones_propuestas.estado: the spec only says «propone» and «confirma con PIN». */
export const PROPOSED_ACTION_STATUSES = ['proposed', 'confirmed', 'rejected', 'expired'] as const;
export type ProposedActionStatus = (typeof PROPOSED_ACTION_STATUSES)[number];

/** [provisional, Fase 6] alertas.tipo, from the review triggers in 13.4. */
export const ALERT_TYPES = [
  'duplicate_account_holder',
  'shared_screenshot',
  'activity_spike',
  'instant_close_replies',
  /** [Fase 7] 5 wrong PINs (D28): also read by the close composer for its notice line. */
  'pin_lockout',
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

/** [provisional, Fase 8] alertas.estado */
export const ALERT_STATUSES = ['open', 'reviewed', 'dismissed'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** CHECK (column IN (...)) from a constant list. Values are code constants, never user input. */
function oneOf(column: AnyPgColumn, values: readonly string[]): SQL {
  const list = values.map((value) => `'${value.replaceAll("'", "''")}'`).join(', ');
  return sql`${column} in (${sql.raw(list)})`;
}

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const businessDay = () => date('business_day', { mode: 'string' }).notNull();
const userRef = () =>
  uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' });

/** Postgres `bytea` as a Node Buffer. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

// ---------------------------------------------------------------------------
// Users, consent, account holders
// ---------------------------------------------------------------------------

/** usuarias */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phoneE164: text('phone_e164').notNull().unique(),
    businessName: text('business_name'),
    /** Main account holder as shown in Yape/Plin (titular_nombre). Extra holders: account_holders. */
    accountHolderName: text('account_holder_name'),
    /** Lowercase, no accents, for matching (titular_normal). */
    accountHolderNormalized: text('account_holder_normalized'),
    /** Lima time (hora_cierre). */
    closeTime: time('close_time'),
    /** D27: false = «solo texto». */
    summaryImage: boolean('summary_image').notNull().default(true),
    onboardingStatus: text('onboarding_status').$type<OnboardingStatus>().notNull().default('new'),
    /** For WhatsApp's 24 h service window. */
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    createdAt: createdAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    check('users_onboarding_status_check', oneOf(t.onboardingStatus, ONBOARDING_STATUSES)),
    index('users_account_holder_normalized_idx').on(t.accountHolderNormalized),
  ],
);

/** consentimientos (14.1): stored with the version of the text she accepted. */
export const consents = pgTable(
  'consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: userRef(),
    textVersion: text('text_version').notNull(),
    accepted: boolean('accepted').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('consents_user_id_idx').on(t.userId)],
);

/** titulares: additional account holders of the business (D31). Max 2 per user, enforced in code. */
export const accountHolders = pgTable(
  'account_holders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: userRef(),
    name: text('name').notNull(),
    nameNormalized: text('name_normalized').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('account_holders_user_id_idx').on(t.userId),
    index('account_holders_name_normalized_idx').on(t.nameNormalized),
  ],
);

// ---------------------------------------------------------------------------
// Inbound messages, files, extractions
// ---------------------------------------------------------------------------

/** archivos: images and audios. Bytes live in BlobStorage under `storage_key`, encrypted. */
export const mediaFiles = pgTable(
  'media_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: userRef(),
    sha256: text('sha256').notNull(),
    mimeType: text('mime_type').notNull(),
    storageKey: text('storage_key').notNull(),
    /** PR07: originals are deleted after 30 days (borrar_desde). */
    deleteAfter: timestamp('delete_after', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('media_files_user_id_sha256_uq').on(t.userId, t.sha256),
    index('media_files_sha256_idx').on(t.sha256),
    index('media_files_delete_after_idx').on(t.deleteAfter),
  ],
);

/** mensajes_entrantes: `wa_message_id` is the idempotency key (RF-IN-02). */
export const inboundMessages = pgTable(
  'inbound_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    waMessageId: text('wa_message_id').notNull().unique(),
    userId: userRef(),
    type: text('type').$type<InboundMessageType>().notNull(),
    text: text('text'),
    /** wa_message_id this message replies to, if any (respuesta_a). */
    replyToWaMessageId: text('reply_to_wa_message_id'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    status: text('status').$type<InboundMessageStatus>().notNull().default('received'),
    attempts: integer('attempts').notNull().default(0),
    mediaFileId: uuid('media_file_id').references(() => mediaFiles.id, { onDelete: 'set null' }),
    /**
     * [Fase 3] Meta media id of an image or audio, to download it (RF-IN-04) and to retry from the
     * admin panel (RF-AD-01). Not content: the file itself goes to `media_files`.
     */
    waMediaId: text('wa_media_id'),
    /**
     * [Fase 3] RF-IN-05: why the last attempt failed (a code such as `ai_unavailable`, never
     * content), shown in the admin panel for `error` and `failed` messages.
     */
    errorCode: text('error_code'),
  },
  (t) => [
    check('inbound_messages_type_check', oneOf(t.type, INBOUND_MESSAGE_TYPES)),
    check('inbound_messages_status_check', oneOf(t.status, INBOUND_MESSAGE_STATUSES)),
    index('inbound_messages_user_id_received_at_idx').on(t.userId, t.receivedAt),
    index('inbound_messages_status_idx').on(t.status),
  ],
);

/** extracciones: every AI call keeps model and prompt version (8.3). */
export const extractions = pgTable(
  'extractions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    inboundMessageId: uuid('inbound_message_id')
      .notNull()
      .references(() => inboundMessages.id, { onDelete: 'cascade' }),
    function: text('function').$type<ExtractionFunction>().notNull(),
    model: text('model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    result: jsonb('result').notNull(),
    isValid: boolean('is_valid').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('extractions_function_check', oneOf(t.function, EXTRACTION_FUNCTIONS)),
    index('extractions_inbound_message_id_idx').on(t.inboundMessageId),
  ],
);

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

/** movimientos: the ledger. Append-only; see header. */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: userRef(),
    businessDay: businessDay(),
    /** Time of the operation, if known (operacion_at). */
    operationAt: timestamp('operation_at', { withTimezone: true }),
    amountCents: integer('amount_cents').notNull(),
    direction: text('direction').$type<Direction>().notNull(),
    paymentMethod: text('payment_method').$type<PaymentMethod>().notNull(),
    category: text('category').$type<Category>().notNull(),
    /** As displayed (contraparte). */
    counterparty: text('counterparty'),
    /** Normalized for matching (contraparte_norm). */
    counterpartyNormalized: text('counterparty_normalized'),
    operationNumber: text('operation_number'),
    label: text('label').$type<LedgerLabel>().notNull(),
    status: text('status').$type<LedgerEntryStatus>().notNull(),
    source: text('source').$type<LedgerEntrySource>().notNull(),
    inboundMessageId: uuid('inbound_message_id').references(() => inboundMessages.id, {
      onDelete: 'set null',
    }),
    /** Previous entry, when this one is a correction (reemplaza_a). */
    replacesEntryId: uuid('replaces_entry_id').references((): AnyPgColumn => ledgerEntries.id),
    createdBy: text('created_by').$type<CreatedBy>().notNull(),
    /** PR03: recorded after the close was sent. */
    afterClose: boolean('after_close').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    check('ledger_entries_amount_cents_check', sql`${t.amountCents} > 0`),
    check('ledger_entries_direction_check', oneOf(t.direction, DIRECTIONS)),
    check('ledger_entries_payment_method_check', oneOf(t.paymentMethod, PAYMENT_METHODS)),
    check('ledger_entries_category_check', oneOf(t.category, CATEGORIES)),
    check('ledger_entries_label_check', oneOf(t.label, LEDGER_LABELS)),
    check('ledger_entries_status_check', oneOf(t.status, LEDGER_ENTRY_STATUSES)),
    check('ledger_entries_source_check', oneOf(t.source, LEDGER_ENTRY_SOURCES)),
    check('ledger_entries_created_by_check', oneOf(t.createdBy, CREATED_BY)),
    // Duplicates (11.4): one live entry per operation number and payment method.
    uniqueIndex('ledger_entries_operation_number_uq')
      .on(t.userId, t.paymentMethod, t.operationNumber)
      .where(sql`operation_number is not null and status in ('confirmed', 'pending')`),
    index('ledger_entries_user_id_business_day_idx').on(t.userId, t.businessDay),
    index('ledger_entries_inbound_message_id_idx').on(t.inboundMessageId),
  ],
);

/** movimientos_eventos: audit trail of who changed what and why. */
export const ledgerEntryEvents = pgTable(
  'ledger_entry_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ledgerEntryId: uuid('ledger_entry_id')
      .notNull()
      .references(() => ledgerEntries.id, { onDelete: 'cascade' }),
    event: text('event').$type<LedgerEntryEvent>().notNull(),
    detail: jsonb('detail'),
    actor: text('actor').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('ledger_entry_events_event_check', oneOf(t.event, LEDGER_ENTRY_EVENTS)),
    index('ledger_entry_events_ledger_entry_id_idx').on(t.ledgerEntryId),
  ],
);

// ---------------------------------------------------------------------------
// Clarifications and daily closes
// ---------------------------------------------------------------------------

/** dudas (11.8) */
export const clarifications = pgTable(
  'clarifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: userRef(),
    businessDay: businessDay(),
    type: text('type').$type<ClarificationType>().notNull(),
    ledgerEntryId: uuid('ledger_entry_id').references(() => ledgerEntries.id, {
      onDelete: 'set null',
    }),
    inboundMessageId: uuid('inbound_message_id').references(() => inboundMessages.id, {
      onDelete: 'set null',
    }),
    priority: integer('priority').notNull(),
    status: text('status').$type<ClarificationStatus>().notNull().default('open'),
    /** Number shown in the close message (numero_en_mensaje). */
    messageNumber: integer('message_number'),
    /**
     * [Fase 7] What the doubt is about when there is no ledger entry: the list row of a
     * `missing_from_list`, the declared total of an `ambiguous_total`, the quote of an `unreadable`
     * audio. Shape: `ClarificationDetail` in `ledger/types.ts`.
     */
    detail: jsonb('detail'),
    answer: jsonb('answer'),
    createdAt: createdAt(),
  },
  (t) => [
    check('clarifications_type_check', oneOf(t.type, CLARIFICATION_TYPES)),
    check('clarifications_status_check', oneOf(t.status, CLARIFICATION_STATUSES)),
    index('clarifications_user_id_business_day_idx').on(t.userId, t.businessDay),
  ],
);

/** cierres: one per user and business day. */
export const dailyCloses = pgTable(
  'daily_closes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: userRef(),
    businessDay: businessDay(),
    status: text('status').$type<DailyCloseStatus>().notNull().default('open'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    repliedAt: timestamp('replied_at', { withTimezone: true }),
    finalAt: timestamp('final_at', { withTimezone: true }),
    /** 11.7 (variacion_esperada_centimos). Can be negative. */
    expectedCashChangeCents: integer('expected_cash_change_cents'),
    cashCheck: text('cash_check').$type<CashCheckResult>(),
    level: text('level').$type<CloseLevel>(),
    /** Level reached after 12:00, without points (nivel_mejorado). */
    improvedLevel: text('improved_level').$type<CloseLevel>(),
    /** Clarification rounds used, max 2 (aclaraciones, WA-11). */
    clarificationRounds: integer('clarification_rounds').notNull().default(0),
    /** wa_message_id of the close message (wa_message_id_cierre). */
    closeWaMessageId: text('close_wa_message_id'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('daily_closes_user_id_business_day_uq').on(t.userId, t.businessDay),
    check('daily_closes_status_check', oneOf(t.status, DAILY_CLOSE_STATUSES)),
    check('daily_closes_cash_check_check', oneOf(t.cashCheck, CASH_CHECK_RESULTS)),
    check('daily_closes_level_check', oneOf(t.level, CLOSE_LEVELS)),
    check('daily_closes_improved_level_check', oneOf(t.improvedLevel, CLOSE_LEVELS)),
  ],
);

// ---------------------------------------------------------------------------
// Points and rewards
// ---------------------------------------------------------------------------

/** puntos_movimientos: positive earns, negative redeems or expires. */
export const pointsEntries = pgTable(
  'points_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: userRef(),
    type: text('type').$type<PointsEntryType>().notNull(),
    points: integer('points').notNull(),
    /** Close, redemption, etc. that produced it (referencia). */
    referenceId: uuid('reference_id'),
    createdAt: createdAt(),
  },
  (t) => [
    check('points_entries_type_check', oneOf(t.type, POINTS_ENTRY_TYPES)),
    index('points_entries_user_id_idx').on(t.userId),
  ],
);

/** rachas */
export const streaks = pgTable('streaks', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  days: integer('days').notNull(),
  isoWeek: text('iso_week').notNull(),
  /** comodines_usados */
  freezesUsed: integer('freezes_used').notNull(),
  firstStreakAwarded: boolean('first_streak_awarded').notNull().default(false),
});

/** premios: example catalog in the demo (3.2). */
export const rewards = pgTable('rewards', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  costPoints: integer('cost_points').notNull(),
  isBig: boolean('is_big').notNull(),
  isExample: boolean('is_example').notNull(),
  active: boolean('active').notNull(),
});

/** canjes (13.3) */
export const redemptions = pgTable(
  'redemptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: userRef(),
    rewardId: uuid('reward_id')
      .notNull()
      .references(() => rewards.id),
    points: integer('points').notNull(),
    status: text('status').$type<RedemptionStatus>().notNull(),
    /** DEMO-XXXX */
    code: text('code').unique(),
    reviewedBy: text('reviewed_by'),
    createdAt: createdAt(),
  },
  (t) => [
    check('redemptions_status_check', oneOf(t.status, REDEMPTION_STATUSES)),
    index('redemptions_user_id_idx').on(t.userId),
  ],
);

/** reglas_contraparte: memory by counterparty (PR14). */
export const counterpartyRules = pgTable(
  'counterparty_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: userRef(),
    counterpartyNormalized: text('counterparty_normalized').notNull(),
    direction: text('direction').$type<Direction>().notNull(),
    /** Outgoing: the last one she chose. Incoming: personal. */
    category: text('category').$type<Category>().notNull(),
    source: text('source').$type<CounterpartyRuleSource>().notNull(),
    active: boolean('active').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('counterparty_rules_user_counterparty_direction_uq').on(
      t.userId,
      t.counterpartyNormalized,
      t.direction,
    ),
    check('counterparty_rules_direction_check', oneOf(t.direction, DIRECTIONS)),
    check('counterparty_rules_category_check', oneOf(t.category, CATEGORIES)),
    check('counterparty_rules_source_check', oneOf(t.source, COUNTERPARTY_RULE_SOURCES)),
  ],
);

// ---------------------------------------------------------------------------
// Web access (14.3)
// ---------------------------------------------------------------------------

/** pines: Argon2id/bcrypt hash only (RNF-08). */
export const pins = pgTable('pins', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  pinHash: text('pin_hash').notNull(),
  /** Consecutive failures: 5 → 15 min lock (intentos_fallidos). */
  failedAttempts: integer('failed_attempts').notNull().default(0),
  /** Accumulated failures: 10 → new activation link required (intentos_acumulados). */
  totalFailedAttempts: integer('total_failed_attempts').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** enlaces_acceso: only the token hash is stored. */
export const accessLinks = pgTable(
  'access_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: userRef(),
    tokenHash: text('token_hash').notNull().unique(),
    type: text('type').$type<AccessLinkType>().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check('access_links_type_check', oneOf(t.type, ACCESS_LINK_TYPES)),
    index('access_links_user_id_idx').on(t.userId),
    index('access_links_expires_at_idx').on(t.expiresAt),
  ],
);

/** dispositivos: «celular recordado», cookie hash only. */
export const trustedDevices = pgTable(
  'trusted_devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: userRef(),
    cookieHash: text('cookie_hash').notNull().unique(),
    rememberedUntil: timestamp('remembered_until', { withTimezone: true }).notNull(),
    /** Sensitive actions need a PIN verified in the last 10 minutes (PR11). */
    pinVerifiedAt: timestamp('pin_verified_at', { withTimezone: true }),
    revoked: boolean('revoked').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('trusted_devices_user_id_idx').on(t.userId)],
);

// ---------------------------------------------------------------------------
// Chat, reports, outbound messages, alerts
// ---------------------------------------------------------------------------

/** chat_mensajes */
export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: userRef(),
    role: text('role').$type<ChatRole>().notNull(),
    content: text('content').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('chat_messages_role_check', oneOf(t.role, CHAT_ROLES)),
    index('chat_messages_user_id_created_at_idx').on(t.userId, t.createdAt),
  ],
);

/** acciones_propuestas: the chat only proposes; she confirms with her PIN (14.5). */
export const proposedActions = pgTable(
  'proposed_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: userRef(),
    type: text('type').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    status: text('status').$type<ProposedActionStatus>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('proposed_actions_user_id_idx').on(t.userId)],
);

/** reportes: PDF/Excel stored in BlobStorage. */
export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: userRef(),
    period: text('period').notNull(),
    pdfStorageKey: text('pdf_storage_key'),
    xlsxStorageKey: text('xlsx_storage_key'),
    createdAt: createdAt(),
  },
  (t) => [index('reports_user_id_idx').on(t.userId)],
);

/** mensajes_salientes: `type` is the catalog id of section 12.1 (e.g. 'WA-10'). */
export const outboundMessages = pgTable(
  'outbound_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: userRef(),
    type: text('type').notNull(),
    waMessageId: text('wa_message_id').unique(),
    /** Meta pricing category (categoria_precio). */
    pricingCategory: text('pricing_category'),
    billable: boolean('billable'),
    createdAt: createdAt(),
  },
  (t) => [index('outbound_messages_user_id_created_at_idx').on(t.userId, t.createdAt)],
);

/** alertas (13.4): user_id may be null for system-wide alerts. */
export const alerts = pgTable(
  'alerts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    detail: jsonb('detail'),
    status: text('status').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('alerts_status_idx').on(t.status)],
);

// ---------------------------------------------------------------------------
// Tables added by decisions (not in 9.1)
// ---------------------------------------------------------------------------

/** D45: encrypted blobs (AES-256-GCM) behind the BlobStorage interface. Not user-scoped by FK. */
export const storageObjects = pgTable('storage_objects', {
  key: text('key').primaryKey(),
  contentType: text('content_type'),
  /** Plaintext size. */
  sizeBytes: integer('size_bytes').notNull(),
  iv: bytea('iv').notNull(),
  authTag: bytea('auth_tag').notNull(),
  ciphertext: bytea('ciphertext').notNull(),
  createdAt: createdAt(),
});

/** D43: landing waitlist (stored only with consent). */
export const waitlistSignups = pgTable('waitlist_signups', {
  id: uuid('id').primaryKey().defaultRandom(),
  phoneE164: text('phone_e164').notNull().unique(),
  name: text('name').notNull(),
  businessName: text('business_name'),
  consentVersion: text('consent_version').notNull(),
  createdAt: createdAt(),
});

/** RF-AD-04 / 14.4: one account per team member. */
export const adminUsers = pgTable('admin_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  active: boolean('active').notNull().default(true),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: createdAt(),
});

/** RF-AD-04: every admin panel action, with who did it. */
export const adminAuditLog = pgTable(
  'admin_audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminUserId: uuid('admin_user_id')
      .notNull()
      .references(() => adminUsers.id),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    detail: jsonb('detail'),
    createdAt: createdAt(),
  },
  (t) => [index('admin_audit_log_admin_user_id_idx').on(t.adminUserId)],
);

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Consent = typeof consents.$inferSelect;
export type AccountHolder = typeof accountHolders.$inferSelect;
export type MediaFile = typeof mediaFiles.$inferSelect;
export type InboundMessage = typeof inboundMessages.$inferSelect;
export type NewInboundMessage = typeof inboundMessages.$inferInsert;
export type Extraction = typeof extractions.$inferSelect;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type NewLedgerEntry = typeof ledgerEntries.$inferInsert;
export type LedgerEntryEventRow = typeof ledgerEntryEvents.$inferSelect;
export type Clarification = typeof clarifications.$inferSelect;
export type DailyClose = typeof dailyCloses.$inferSelect;
export type PointsEntry = typeof pointsEntries.$inferSelect;
export type Streak = typeof streaks.$inferSelect;
export type Reward = typeof rewards.$inferSelect;
export type Redemption = typeof redemptions.$inferSelect;
export type CounterpartyRule = typeof counterpartyRules.$inferSelect;
export type Pin = typeof pins.$inferSelect;
export type AccessLink = typeof accessLinks.$inferSelect;
export type TrustedDevice = typeof trustedDevices.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type ProposedAction = typeof proposedActions.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type OutboundMessage = typeof outboundMessages.$inferSelect;
export type Alert = typeof alerts.$inferSelect;
export type StorageObject = typeof storageObjects.$inferSelect;
export type WaitlistSignup = typeof waitlistSignups.$inferSelect;
export type AdminUser = typeof adminUsers.$inferSelect;
export type AdminAuditLogEntry = typeof adminAuditLog.$inferSelect;
