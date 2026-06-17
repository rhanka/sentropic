-- Migration 0034: BR-44 LLM account transports
-- Adds DB-backed subscription account routing state for llm-mesh transports.

CREATE TABLE IF NOT EXISTS "llm_provider_accounts" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text,
  "owner_user_id" text,
  "scope" text NOT NULL DEFAULT 'user',
  "target_provider_id" text NOT NULL,
  "transport_provider_id" text NOT NULL,
  "external_account_id" text,
  "account_label" text,
  "status" text NOT NULL DEFAULT 'active',
  "model_allowlist" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "priority" integer NOT NULL DEFAULT 0,
  "weight" integer NOT NULL DEFAULT 1,
  "token_secret" text,
  "token_expires_at" timestamp,
  "terms_accepted_at" timestamp,
  "connected_at" timestamp,
  "disconnected_at" timestamp,
  "cooldown_until" timestamp,
  "last_error" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "llm_provider_accounts_scope_check" CHECK ("scope" IN ('user','workspace','environment')),
  CONSTRAINT "llm_provider_accounts_status_check" CHECK ("status" IN ('active','cooldown','reauth_required','disabled','disconnected')),
  CONSTRAINT "llm_provider_accounts_weight_check" CHECK ("weight" > 0)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "llm_provider_accounts" ADD CONSTRAINT "llm_provider_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "llm_provider_accounts" ADD CONSTRAINT "llm_provider_accounts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "llm_provider_accounts_owner_transport_external_unique"
  ON "llm_provider_accounts" USING btree ("owner_user_id","target_provider_id","transport_provider_id","external_account_id")
  WHERE "external_account_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_provider_accounts_routing_idx"
  ON "llm_provider_accounts" USING btree ("owner_user_id","target_provider_id","transport_provider_id","status","priority");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_provider_accounts_workspace_idx" ON "llm_provider_accounts" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_provider_accounts_cooldown_idx" ON "llm_provider_accounts" USING btree ("cooldown_until");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "llm_account_leases" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text,
  "user_id" text,
  "affinity_key" text NOT NULL,
  "target_provider_id" text NOT NULL,
  "transport_provider_id" text NOT NULL,
  "model_id" text NOT NULL DEFAULT '',
  "account_id" text NOT NULL,
  "stable_session_id" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  "released_at" timestamp,
  CONSTRAINT "llm_account_leases_status_check" CHECK ("status" IN ('active','released','invalidated'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "llm_account_leases" ADD CONSTRAINT "llm_account_leases_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "llm_account_leases" ADD CONSTRAINT "llm_account_leases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "llm_account_leases" ADD CONSTRAINT "llm_account_leases_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."llm_provider_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "llm_account_leases_active_affinity_unique"
  ON "llm_account_leases" USING btree (
    coalesce("workspace_id", ''),
    coalesce("user_id", ''),
    "affinity_key",
    "target_provider_id",
    "transport_provider_id",
    "model_id"
  )
  WHERE "status" = 'active';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_account_leases_account_idx" ON "llm_account_leases" USING btree ("account_id");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "llm_account_reservations" (
  "id" text PRIMARY KEY NOT NULL,
  "account_id" text NOT NULL,
  "lease_id" text NOT NULL,
  "request_id" text,
  "status" text NOT NULL DEFAULT 'active',
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "completed_at" timestamp,
  CONSTRAINT "llm_account_reservations_status_check" CHECK ("status" IN ('active','completed','expired'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "llm_account_reservations" ADD CONSTRAINT "llm_account_reservations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."llm_provider_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "llm_account_reservations" ADD CONSTRAINT "llm_account_reservations_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."llm_account_leases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_account_reservations_active_account_idx"
  ON "llm_account_reservations" USING btree ("account_id","expires_at")
  WHERE "status" = 'active';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_account_reservations_lease_idx" ON "llm_account_reservations" USING btree ("lease_id");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "llm_account_quota_state" (
  "id" text PRIMARY KEY NOT NULL,
  "account_id" text NOT NULL,
  "quota_key" text NOT NULL,
  "status" text NOT NULL DEFAULT 'unknown',
  "utilization_basis_points" integer,
  "remaining_count" integer,
  "reset_at" timestamp,
  "cooldown_until" timestamp,
  "raw_payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "version" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "llm_account_quota_state_status_check" CHECK ("status" IN ('unknown','ok','limited','exhausted','cooldown'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "llm_account_quota_state" ADD CONSTRAINT "llm_account_quota_state_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."llm_provider_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "llm_account_quota_state_account_key_unique" ON "llm_account_quota_state" USING btree ("account_id","quota_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_account_quota_state_status_idx" ON "llm_account_quota_state" USING btree ("status","cooldown_until");
