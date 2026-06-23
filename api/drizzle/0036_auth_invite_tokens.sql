-- feat(BR-39r-L4): single-use invitation tokens (invitation → direct device enrollment).
-- The opaque `sit_`-prefixed token is never stored; only its SHA-256 hash is persisted.
-- Consumed ATOMICALLY at registration via
--   UPDATE auth_invite_tokens SET consumed_at=now(), consumed_by_user_id=$uid
--   WHERE token_hash=$h AND consumed_at IS NULL AND expires_at>now() RETURNING email
-- so exactly one concurrent caller wins (single-use). Additive, backward-compatible.
CREATE TABLE IF NOT EXISTS "auth_invite_tokens" (
  "id" text PRIMARY KEY NOT NULL,
  "token_hash" text NOT NULL,
  "email" text NOT NULL,
  "client_id" text,
  "expires_at" timestamp NOT NULL,
  "consumed_at" timestamp,
  "consumed_by_user_id" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auth_invite_tokens" ADD CONSTRAINT "auth_invite_tokens_token_hash_unique" UNIQUE ("token_hash");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auth_invite_tokens" ADD CONSTRAINT "auth_invite_tokens_consumed_by_user_id_users_id_fk" FOREIGN KEY ("consumed_by_user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_invite_tokens_expires_at_idx" ON "auth_invite_tokens" USING btree ("expires_at");
