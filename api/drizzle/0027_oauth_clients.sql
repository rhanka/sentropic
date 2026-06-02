CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_clients" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL,
  "client_secret_hash" text,
  "name" text NOT NULL,
  "redirect_uris" text[] NOT NULL,
  "allowed_scopes" text[] NOT NULL,
  "grant_types" text[] NOT NULL DEFAULT ARRAY['authorization_code']::text[],
  "response_types" text[] NOT NULL DEFAULT ARRAY['code']::text[],
  "token_endpoint_auth_method" text NOT NULL DEFAULT 'client_secret_basic',
  "dpop_bound_access_tokens" boolean NOT NULL DEFAULT false,
  "require_pkce" boolean NOT NULL DEFAULT true,
  "tenant_id" text,
  "owner_user_id" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "oauth_clients_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "authorization_codes" (
  "code" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL,
  "user_id" text NOT NULL,
  "tenant_id" text,
  "redirect_uri" text NOT NULL,
  "scope" text NOT NULL,
  "code_challenge" text NOT NULL,
  "code_challenge_method" text NOT NULL,
  "dpop_jkt" text,
  "nonce" text,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "expires_at" timestamp NOT NULL,
  "used_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "authorization_codes_code_challenge_method_check" CHECK ("code_challenge_method" = 'S256')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_tokens" (
  "jti" text PRIMARY KEY NOT NULL,
  "token_type" text NOT NULL,
  "client_id" text NOT NULL,
  "user_id" text NOT NULL,
  "tenant_id" text,
  "scope" text NOT NULL,
  "audience" text NOT NULL,
  "dpop_jkt" text,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "oauth_tokens_token_type_check" CHECK ("token_type" IN ('access_token','id_token'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_dpop_proofs" (
  "jti" text PRIMARY KEY NOT NULL,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "revoked_tokens" (
  "jti" text PRIMARY KEY NOT NULL,
  "client_id" text,
  "user_id" text,
  "tenant_id" text,
  "revoked_at" timestamp NOT NULL DEFAULT now(),
  "expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "id_token_signing_keys" (
  "kid" text PRIMARY KEY NOT NULL,
  "alg" text NOT NULL DEFAULT 'EdDSA',
  "crv" text NOT NULL DEFAULT 'Ed25519',
  "public_jwk" jsonb NOT NULL,
  "private_key_encrypted" bytea NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "rotated_at" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_clients" ADD CONSTRAINT "oauth_clients_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "authorization_codes" ADD CONSTRAINT "authorization_codes_client_id_oauth_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("client_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "authorization_codes" ADD CONSTRAINT "authorization_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_client_id_oauth_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("client_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "revoked_tokens" ADD CONSTRAINT "revoked_tokens_client_id_oauth_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("client_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "revoked_tokens" ADD CONSTRAINT "revoked_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_clients_client_id_idx" ON "oauth_clients" USING btree ("client_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_clients_owner_user_id_idx" ON "oauth_clients" USING btree ("owner_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_clients_tenant_id_idx" ON "oauth_clients" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "authorization_codes_client_id_idx" ON "authorization_codes" USING btree ("client_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "authorization_codes_expires_at_idx" ON "authorization_codes" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "authorization_codes_tenant_id_idx" ON "authorization_codes" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "authorization_codes_user_id_idx" ON "authorization_codes" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_tokens_client_id_idx" ON "oauth_tokens" USING btree ("client_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_tokens_expires_at_idx" ON "oauth_tokens" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_tokens_tenant_id_idx" ON "oauth_tokens" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_tokens_user_id_idx" ON "oauth_tokens" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_dpop_proofs_expires_at_idx" ON "oauth_dpop_proofs" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "revoked_tokens_client_id_idx" ON "revoked_tokens" USING btree ("client_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "revoked_tokens_expires_at_idx" ON "revoked_tokens" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "revoked_tokens_tenant_id_idx" ON "revoked_tokens" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "revoked_tokens_user_id_idx" ON "revoked_tokens" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "id_token_signing_keys_active_idx" ON "id_token_signing_keys" USING btree ("active");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "id_token_signing_keys_one_active_idx" ON "id_token_signing_keys" USING btree ("active") WHERE "active" = true;
