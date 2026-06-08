CREATE TABLE IF NOT EXISTS "tenants" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_memberships" (
  "tenant_id" text NOT NULL,
  "user_id" text NOT NULL,
  "status" text NOT NULL DEFAULT 'requested',
  "role" text NOT NULL DEFAULT 'member',
  "approved_by_user_id" text,
  "requested_at" timestamp NOT NULL DEFAULT now(),
  "decided_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenants_status_idx" ON "tenants" USING btree ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_memberships_tenant_id_user_id_unique" ON "tenant_memberships" USING btree ("tenant_id","user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_memberships_tenant_id_idx" ON "tenant_memberships" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_memberships_user_id_idx" ON "tenant_memberships" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_memberships_status_idx" ON "tenant_memberships" USING btree ("status");
--> statement-breakpoint
-- BR-39e D5 backfill (idempotent, live-default-safe): seed the default `sentropic`
-- tenant and grant every EXISTING user an `approved` membership so the live shared
-- `users` population is never locked out by the new tenancy gate. New memberships
-- created by the app default to `requested` (column default above); this backfill
-- explicitly grandfathers current users to `approved`.
INSERT INTO "tenants" ("id", "name", "status")
VALUES ('sentropic', 'Sentropic', 'active')
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "tenant_memberships" ("tenant_id", "user_id", "status", "role", "requested_at", "decided_at")
SELECT 'sentropic', "users"."id", 'approved', 'member', now(), now()
FROM "users"
ON CONFLICT ("tenant_id", "user_id") DO NOTHING;
