-- Migration 0026: BR-16a Google Drive connector accounts
-- Adds per-user/per-workspace connector lifecycle state and encrypted token storage.

CREATE TABLE IF NOT EXISTS "document_connector_accounts" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "user_id" text NOT NULL,
  "provider" text NOT NULL DEFAULT 'google_drive',
  "status" text NOT NULL DEFAULT 'disconnected',
  "account_email" text,
  "account_subject" text,
  "scopes" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "token_secret" text,
  "token_expires_at" timestamp,
  "connected_at" timestamp,
  "disconnected_at" timestamp,
  "last_error" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "document_connector_accounts_provider_check" CHECK ("document_connector_accounts"."provider" IN ('google_drive')),
  CONSTRAINT "document_connector_accounts_status_check" CHECK ("document_connector_accounts"."status" IN ('connected','disconnected','error'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_connector_accounts" ADD CONSTRAINT "document_connector_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_connector_accounts" ADD CONSTRAINT "document_connector_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "document_connector_accounts_workspace_user_provider_unique" ON "document_connector_accounts" USING btree ("workspace_id","user_id","provider");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_connector_accounts_workspace_id_idx" ON "document_connector_accounts" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_connector_accounts_user_id_idx" ON "document_connector_accounts" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_connector_accounts_status_idx" ON "document_connector_accounts" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_connector_accounts_provider_idx" ON "document_connector_accounts" USING btree ("provider");
