CREATE TABLE IF NOT EXISTS "service_clients" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL,
  "client_secret_hash" text NOT NULL,
  "display_name" text,
  "allowed_scopes" text[] NOT NULL,
  "resource_indicators" text[] NOT NULL DEFAULT '{}',
  "dpop_bound_access_tokens" boolean NOT NULL DEFAULT false,
  "tenant_id" text,
  "secret_rotated_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "revoked_at" timestamp,
  CONSTRAINT "service_clients_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_clients_client_id_idx" ON "service_clients" USING btree ("client_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_clients_tenant_id_idx" ON "service_clients" USING btree ("tenant_id");
