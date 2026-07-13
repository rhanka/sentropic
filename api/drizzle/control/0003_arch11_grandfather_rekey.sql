-- ARCH-11 G1a — grandfather re-key of the control-plane tenant columns (DEFAULT-safe, §4.1.5).
-- Applied AFTER the public stream (run-migrations.ts), so public."workspaces"."tenant_id" and
-- public."tenants" already exist and are backfilled when this runs.
-- Control-namespace rule: NO cross-namespace FK is added — the UPDATEs only READ public tables to
-- resolve the real tenant (soft references stay soft).
-- These tables (BR-45/BR-59) are control-plane scaffolding; the re-keys are correct if rows exist
-- and no-ops otherwise.

-- app_instances: DEFAULT-safe default on the grandfather tenant_id; backfill the real-tenant column
-- `identity_tenant_id` from the bound workspace's real tenant (via app_workspace_bindings), fallback
-- to the grandfather value when it is already a valid tenant, else 'sentropic'. Re-key tenant_id ONLY
-- where it holds a non-tenant (workspace-id alias) value.
ALTER TABLE "control"."app_instances" ALTER COLUMN "tenant_id" SET DEFAULT 'sentropic';
--> statement-breakpoint
UPDATE "control"."app_instances" i
SET "identity_tenant_id" = sub."tenant_id"
FROM (
  SELECT DISTINCT b."app_instance_id", w."tenant_id"
  FROM "control"."app_workspace_bindings" b
  JOIN "workspaces" w ON w."id" = b."workspace_id"
) sub
WHERE i."identity_tenant_id" IS NULL AND sub."app_instance_id" = i."id";
--> statement-breakpoint
UPDATE "control"."app_instances" i
SET "identity_tenant_id" = COALESCE(
  (SELECT t."id" FROM "tenants" t WHERE t."id" = i."tenant_id"),
  'sentropic')
WHERE i."identity_tenant_id" IS NULL;
--> statement-breakpoint
UPDATE "control"."app_instances" i
SET "tenant_id" = COALESCE(i."identity_tenant_id", 'sentropic')
WHERE i."tenant_id" NOT IN (SELECT "id" FROM "tenants");
--> statement-breakpoint

-- app_workspace_bindings: DEFAULT-safe default; backfill identity_tenant_id from the bound
-- workspace's real tenant; re-key tenant_id alias values to the bound workspace's real tenant.
ALTER TABLE "control"."app_workspace_bindings" ALTER COLUMN "tenant_id" SET DEFAULT 'sentropic';
--> statement-breakpoint
UPDATE "control"."app_workspace_bindings" b
SET "identity_tenant_id" = w."tenant_id"
FROM "workspaces" w
WHERE w."id" = b."workspace_id" AND b."identity_tenant_id" IS NULL;
--> statement-breakpoint
UPDATE "control"."app_workspace_bindings"
SET "identity_tenant_id" = 'sentropic'
WHERE "identity_tenant_id" IS NULL;
--> statement-breakpoint
UPDATE "control"."app_workspace_bindings" b
SET "tenant_id" = w."tenant_id"
FROM "workspaces" w
WHERE w."id" = b."workspace_id" AND b."tenant_id" NOT IN (SELECT "id" FROM "tenants");
--> statement-breakpoint

-- object_type_definitions: nullable tenant_id (null = global / first-party type — LEFT untouched, no
-- default). Only tenant-scoped rows whose tenant_id holds a non-tenant (alias) value are re-keyed to
-- the bootstrap org.
UPDATE "control"."object_type_definitions"
SET "tenant_id" = 'sentropic'
WHERE "tenant_id" IS NOT NULL AND "tenant_id" NOT IN (SELECT "id" FROM "tenants");
