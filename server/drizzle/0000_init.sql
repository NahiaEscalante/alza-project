CREATE TABLE "access_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"type" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_links_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "access_links_type_check" CHECK ("access_links"."type" in ('activation', 'access'))
);
--> statement-breakpoint
CREATE TABLE "account_holders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_normalized" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"type" text NOT NULL,
	"detail" jsonb,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_messages_role_check" CHECK ("chat_messages"."role" in ('user', 'assistant'))
);
--> statement-breakpoint
CREATE TABLE "clarifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"business_day" date NOT NULL,
	"type" text NOT NULL,
	"ledger_entry_id" uuid,
	"inbound_message_id" uuid,
	"priority" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"message_number" integer,
	"answer" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clarifications_type_check" CHECK ("clarifications"."type" in ('ambiguous_total', 'possible_duplicate', 'unreadable', 'direction', 'date', 'category', 'missing_from_list')),
	CONSTRAINT "clarifications_status_check" CHECK ("clarifications"."status" in ('open', 'in_message', 'resolved', 'in_web', 'resolved_web'))
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"text_version" text NOT NULL,
	"accepted" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "counterparty_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"counterparty_normalized" text NOT NULL,
	"direction" text NOT NULL,
	"category" text NOT NULL,
	"source" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "counterparty_rules_direction_check" CHECK ("counterparty_rules"."direction" in ('in', 'out')),
	CONSTRAINT "counterparty_rules_category_check" CHECK ("counterparty_rules"."category" in ('sale', 'other_income', 'inventory', 'expense', 'household', 'unclassified', 'internal', 'personal')),
	CONSTRAINT "counterparty_rules_source_check" CHECK ("counterparty_rules"."source" in ('memory', 'accepted'))
);
--> statement-breakpoint
CREATE TABLE "daily_closes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"business_day" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"sent_at" timestamp with time zone,
	"replied_at" timestamp with time zone,
	"final_at" timestamp with time zone,
	"expected_cash_change_cents" integer,
	"cash_check" text,
	"level" text,
	"improved_level" text,
	"clarification_rounds" integer DEFAULT 0 NOT NULL,
	"close_wa_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_closes_status_check" CHECK ("daily_closes"."status" in ('open', 'no_activity', 'sent', 'awaiting_clarification', 'replied', 'expired', 'final')),
	CONSTRAINT "daily_closes_cash_check_check" CHECK ("daily_closes"."cash_check" in ('balanced', 'adjusted', 'unsure', 'no_answer')),
	CONSTRAINT "daily_closes_level_check" CHECK ("daily_closes"."level" in ('complete', 'partial', 'no_close')),
	CONSTRAINT "daily_closes_improved_level_check" CHECK ("daily_closes"."improved_level" in ('complete', 'partial', 'no_close'))
);
--> statement-breakpoint
CREATE TABLE "extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inbound_message_id" uuid NOT NULL,
	"function" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"result" jsonb NOT NULL,
	"is_valid" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extractions_function_check" CHECK ("extractions"."function" in ('classify_image', 'extract_screenshot', 'transcribe_audio', 'interpret_text', 'interpret_close_reply', 'chat'))
);
--> statement-breakpoint
CREATE TABLE "inbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wa_message_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"text" text,
	"reply_to_wa_message_id" text,
	"received_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"media_file_id" uuid,
	CONSTRAINT "inbound_messages_wa_message_id_unique" UNIQUE("wa_message_id"),
	CONSTRAINT "inbound_messages_type_check" CHECK ("inbound_messages"."type" in ('image', 'audio', 'text', 'interactive')),
	CONSTRAINT "inbound_messages_status_check" CHECK ("inbound_messages"."status" in ('received', 'discarded_no_consent', 'processing', 'recorded', 'pending', 'unreadable', 'duplicate', 'non_financial', 'request_handled', 'error', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"business_day" date NOT NULL,
	"operation_at" timestamp with time zone,
	"amount_cents" integer NOT NULL,
	"direction" text NOT NULL,
	"payment_method" text NOT NULL,
	"category" text NOT NULL,
	"counterparty" text,
	"counterparty_normalized" text,
	"operation_number" text,
	"label" text NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"inbound_message_id" uuid,
	"replaces_entry_id" uuid,
	"created_by" text NOT NULL,
	"after_close" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_amount_cents_check" CHECK ("ledger_entries"."amount_cents" > 0),
	CONSTRAINT "ledger_entries_direction_check" CHECK ("ledger_entries"."direction" in ('in', 'out')),
	CONSTRAINT "ledger_entries_payment_method_check" CHECK ("ledger_entries"."payment_method" in ('yape', 'plin', 'cash', 'bank_transfer', 'unknown')),
	CONSTRAINT "ledger_entries_category_check" CHECK ("ledger_entries"."category" in ('sale', 'other_income', 'inventory', 'expense', 'household', 'unclassified', 'internal', 'personal')),
	CONSTRAINT "ledger_entries_label_check" CHECK ("ledger_entries"."label" in ('screenshot', 'self_reported', 'unitemized')),
	CONSTRAINT "ledger_entries_status_check" CHECK ("ledger_entries"."status" in ('confirmed', 'pending', 'duplicate', 'voided', 'superseded')),
	CONSTRAINT "ledger_entries_source_check" CHECK ("ledger_entries"."source" in ('screenshot', 'activity_list', 'text', 'audio', 'close_reply', 'web', 'chat')),
	CONSTRAINT "ledger_entries_created_by_check" CHECK ("ledger_entries"."created_by" in ('system', 'user', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "ledger_entry_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ledger_entry_id" uuid NOT NULL,
	"event" text NOT NULL,
	"detail" jsonb,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entry_events_event_check" CHECK ("ledger_entry_events"."event" in ('created', 'confirmed', 'voided', 'superseded', 'resolved'))
);
--> statement-breakpoint
CREATE TABLE "media_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"mime_type" text NOT NULL,
	"storage_key" text NOT NULL,
	"delete_after" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"wa_message_id" text,
	"pricing_category" text,
	"billable" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbound_messages_wa_message_id_unique" UNIQUE("wa_message_id")
);
--> statement-breakpoint
CREATE TABLE "pins" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"pin_hash" text NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"total_failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "points_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"points" integer NOT NULL,
	"reference_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "points_entries_type_check" CHECK ("points_entries"."type" in ('complete_close', 'partial_close', 'streak_7', 'streak_30', 'weekly_bonus', 'first_streak', 'redemption', 'adjustment', 'expiration'))
);
--> statement-breakpoint
CREATE TABLE "proposed_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"reward_id" uuid NOT NULL,
	"points" integer NOT NULL,
	"status" text NOT NULL,
	"code" text,
	"reviewed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "redemptions_code_unique" UNIQUE("code"),
	CONSTRAINT "redemptions_status_check" CHECK ("redemptions"."status" in ('delivered', 'in_review', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"period" text NOT NULL,
	"pdf_storage_key" text,
	"xlsx_storage_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rewards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"cost_points" integer NOT NULL,
	"is_big" boolean NOT NULL,
	"is_example" boolean NOT NULL,
	"active" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_objects" (
	"key" text PRIMARY KEY NOT NULL,
	"content_type" text,
	"size_bytes" integer NOT NULL,
	"iv" "bytea" NOT NULL,
	"auth_tag" "bytea" NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "streaks" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"days" integer NOT NULL,
	"iso_week" text NOT NULL,
	"freezes_used" integer NOT NULL,
	"first_streak_awarded" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trusted_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"cookie_hash" text NOT NULL,
	"remembered_until" timestamp with time zone NOT NULL,
	"pin_verified_at" timestamp with time zone,
	"revoked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trusted_devices_cookie_hash_unique" UNIQUE("cookie_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_e164" text NOT NULL,
	"business_name" text,
	"account_holder_name" text,
	"account_holder_normalized" text,
	"close_time" time,
	"summary_image" boolean DEFAULT true NOT NULL,
	"onboarding_status" text DEFAULT 'new' NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_phone_e164_unique" UNIQUE("phone_e164"),
	CONSTRAINT "users_onboarding_status_check" CHECK ("users"."onboarding_status" in ('new', 'awaiting_consent', 'business_name', 'account_holder', 'close_time', 'complete', 'declined'))
);
--> statement-breakpoint
CREATE TABLE "waitlist_signups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_e164" text NOT NULL,
	"name" text NOT NULL,
	"business_name" text,
	"consent_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_signups_phone_e164_unique" UNIQUE("phone_e164")
);
--> statement-breakpoint
ALTER TABLE "access_links" ADD CONSTRAINT "access_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_holders" ADD CONSTRAINT "account_holders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clarifications" ADD CONSTRAINT "clarifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clarifications" ADD CONSTRAINT "clarifications_ledger_entry_id_ledger_entries_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clarifications" ADD CONSTRAINT "clarifications_inbound_message_id_inbound_messages_id_fk" FOREIGN KEY ("inbound_message_id") REFERENCES "public"."inbound_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counterparty_rules" ADD CONSTRAINT "counterparty_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_closes" ADD CONSTRAINT "daily_closes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_inbound_message_id_inbound_messages_id_fk" FOREIGN KEY ("inbound_message_id") REFERENCES "public"."inbound_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_media_file_id_media_files_id_fk" FOREIGN KEY ("media_file_id") REFERENCES "public"."media_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_inbound_message_id_inbound_messages_id_fk" FOREIGN KEY ("inbound_message_id") REFERENCES "public"."inbound_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_replaces_entry_id_ledger_entries_id_fk" FOREIGN KEY ("replaces_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entry_events" ADD CONSTRAINT "ledger_entry_events_ledger_entry_id_ledger_entries_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_files" ADD CONSTRAINT "media_files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pins" ADD CONSTRAINT "pins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_entries" ADD CONSTRAINT "points_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposed_actions" ADD CONSTRAINT "proposed_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_reward_id_rewards_id_fk" FOREIGN KEY ("reward_id") REFERENCES "public"."rewards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "streaks" ADD CONSTRAINT "streaks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trusted_devices" ADD CONSTRAINT "trusted_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_links_user_id_idx" ON "access_links" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "access_links_expires_at_idx" ON "access_links" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "account_holders_user_id_idx" ON "account_holders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "account_holders_name_normalized_idx" ON "account_holders" USING btree ("name_normalized");--> statement-breakpoint
CREATE INDEX "admin_audit_log_admin_user_id_idx" ON "admin_audit_log" USING btree ("admin_user_id");--> statement-breakpoint
CREATE INDEX "alerts_status_idx" ON "alerts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "chat_messages_user_id_created_at_idx" ON "chat_messages" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "clarifications_user_id_business_day_idx" ON "clarifications" USING btree ("user_id","business_day");--> statement-breakpoint
CREATE INDEX "consents_user_id_idx" ON "consents" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "counterparty_rules_user_counterparty_direction_uq" ON "counterparty_rules" USING btree ("user_id","counterparty_normalized","direction");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_closes_user_id_business_day_uq" ON "daily_closes" USING btree ("user_id","business_day");--> statement-breakpoint
CREATE INDEX "extractions_inbound_message_id_idx" ON "extractions" USING btree ("inbound_message_id");--> statement-breakpoint
CREATE INDEX "inbound_messages_user_id_received_at_idx" ON "inbound_messages" USING btree ("user_id","received_at");--> statement-breakpoint
CREATE INDEX "inbound_messages_status_idx" ON "inbound_messages" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_operation_number_uq" ON "ledger_entries" USING btree ("user_id","payment_method","operation_number") WHERE operation_number is not null and status in ('confirmed', 'pending');--> statement-breakpoint
CREATE INDEX "ledger_entries_user_id_business_day_idx" ON "ledger_entries" USING btree ("user_id","business_day");--> statement-breakpoint
CREATE INDEX "ledger_entries_inbound_message_id_idx" ON "ledger_entries" USING btree ("inbound_message_id");--> statement-breakpoint
CREATE INDEX "ledger_entry_events_ledger_entry_id_idx" ON "ledger_entry_events" USING btree ("ledger_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_files_user_id_sha256_uq" ON "media_files" USING btree ("user_id","sha256");--> statement-breakpoint
CREATE INDEX "media_files_sha256_idx" ON "media_files" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "media_files_delete_after_idx" ON "media_files" USING btree ("delete_after");--> statement-breakpoint
CREATE INDEX "outbound_messages_user_id_created_at_idx" ON "outbound_messages" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "points_entries_user_id_idx" ON "points_entries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "proposed_actions_user_id_idx" ON "proposed_actions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "redemptions_user_id_idx" ON "redemptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "reports_user_id_idx" ON "reports" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trusted_devices_user_id_idx" ON "trusted_devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_account_holder_normalized_idx" ON "users" USING btree ("account_holder_normalized");