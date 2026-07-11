-- feat(BR-39e-Lot0): social/enterprise federation substrate.
-- Two additive, backward-compatible tables (no change to `users`):
--   * identities            — links a stable external identity `(provider, provider_subject)` to
--                             exactly one Sentropic user (D6). `provider_subject` is the STABLE
--                             upstream subject (Google `sub`, GitHub id, MS `oid`, Apple `sub`, FB id),
--                             NEVER the email. `email_at_link` is audit-only (D13); `token_secret`
--                             stays null in v1 (broker drops the provider token, D1). FK ON DELETE
--                             CASCADE from `users` implements GDPR erasure of the linked profile (D14).
--   * federation_flow_states — one-time, SERVER-SIDE flow-state (D5): upstream CSRF `state`, OIDC
--                             `nonce`, PKCE `code_verifier`, and a POINTER (`continuation_token`) to
--                             the sealed OAuth continuation. Referenced by the opaque `id` (the only
--                             value carried through the provider round-trip, in a bound HttpOnly
--                             cookie). Consumed verify-and-DELETE (single-use + TTL).
CREATE TABLE IF NOT EXISTS "identities" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "provider" text NOT NULL,
  "provider_subject" text NOT NULL,
  "email_at_link" text,
  "email_verified_by_provider" boolean NOT NULL DEFAULT false,
  "provider_tenant" text,
  "token_secret" text,
  "linked_at" timestamp with time zone NOT NULL DEFAULT now(),
  "last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "federation_flow_states" (
  "id" text PRIMARY KEY NOT NULL,
  "provider" text NOT NULL,
  "upstream_state" text NOT NULL,
  "nonce" text,
  "code_verifier" text,
  "continuation_token" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "identities" ADD CONSTRAINT "identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "identities_provider_subject_unique" ON "identities" USING btree ("provider","provider_subject");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "identities_user_id_idx" ON "identities" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "federation_flow_states_expires_at_idx" ON "federation_flow_states" USING btree ("expires_at");
