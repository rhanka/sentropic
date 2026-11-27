-- Per-client magic-link sign-in policy flag + server-side continuation storage.
-- Additive, backward-compatible: existing clients default to magic_link_sign_in = false.
ALTER TABLE "oauth_clients" ADD COLUMN IF NOT EXISTS "magic_link_sign_in" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "magic_link_continuations" (
  "token_hash" text PRIMARY KEY NOT NULL,
  "continuation_url" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "magic_link_continuations_expires_at_idx" ON "magic_link_continuations" USING btree ("expires_at");
