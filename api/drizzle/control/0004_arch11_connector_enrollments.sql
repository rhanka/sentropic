-- ARCH-11 G1c — control.connector_tenant_enrollments (spec §2.1). The durable authorized-tenant-set
-- backing for the DB-backed `authorizedTenants` resolver + the S2S OBO mint (§2.2).
-- Applied in the CONTROL migration stream (run-migrations.ts), AFTER the public stream.
--
-- Control-namespace rule (control-schema.ts:9): SOFT references only — `principal_sub` (== the token
-- subject; for S2S == service_clients.client_id) and `tenant_id` (== public.tenants(id)) are SOFT id
-- refs, NO cross-namespace FK. Integrity is service-enforced (matches app_workspace_bindings).
--
-- ADDITIVE + DEFAULT-safe + NO behavior change: the table ships EMPTY. On prod (single-org) it stays
-- empty — single-org clients resolve their fixed service_clients.tenant_id WITHOUT a row (§1.6 fix).
-- Enrollment rows exist ONLY for multi-org sets, populated operationally (never hardcoded here).

CREATE TABLE IF NOT EXISTS "control"."connector_tenant_enrollments" (
	"principal_sub" text NOT NULL,
	"connector_instance_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connector_tenant_enrollments_pk" PRIMARY KEY("principal_sub","connector_instance_id","tenant_id"),
	CONSTRAINT "connector_tenant_enrollments_status_check" CHECK ("control"."connector_tenant_enrollments"."status" IN ('active', 'suspended'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connector_tenant_enrollments_principal_connector_idx" ON "control"."connector_tenant_enrollments" USING btree ("principal_sub","connector_instance_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connector_tenant_enrollments_principal_status_idx" ON "control"."connector_tenant_enrollments" USING btree ("principal_sub","status");
