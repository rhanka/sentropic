-- feat(auth-consent-persistence): OAuth consent persistence (skip re-consent for granted scopes).
-- Records a user's approved grant per exact (user_id, client_id); the authorize handler skips
-- the consent screen when the stored scopes are a superset of the requested scopes. Additive,
-- backward-compatible: absent rows ⇒ always-consent legacy behavior (no grant = re-consent).
CREATE TABLE IF NOT EXISTS "oauth_consents" (
  "user_id" text NOT NULL,
  "client_id" text NOT NULL,
  "scopes" text[] NOT NULL DEFAULT '{}',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_consents" ADD CONSTRAINT "oauth_consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_consents" ADD CONSTRAINT "oauth_consents_client_id_oauth_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "oauth_clients"("client_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "oauth_consents_user_id_client_id_unique" ON "oauth_consents" USING btree ("user_id","client_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_consents_user_id_idx" ON "oauth_consents" USING btree ("user_id");
