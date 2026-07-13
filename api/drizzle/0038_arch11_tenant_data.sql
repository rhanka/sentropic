-- ARCH-11 G1a — Tenant DATA reconciliation (DEFAULT-safe, rolling-deploy safe, NO behavior change).
-- Spec: spec/SPEC_EVOL_ARCH11_TENANT_RECONCILIATION.md §4.1 (DATA / G1a).
-- Models REAL multi-org (owner A): the schema/registry supports many orgs; existing rows populate
-- to the bootstrap org `sentropic` (unmapped → 'sentropic', §4.1.2). NO `resolveTenant` seam here
-- (that is G1b); NO alias rewiring; NO strict-mode flip.
--
-- DEFAULT-safe contract: every new required column is added with a live DEFAULT so inserts from
-- not-yet-rolled pods (old semantics, no tenant_id) never violate NOT NULL during the roll.

-- (1) Bootstrap the real target `tenants` row (idempotent). Already seeded by 0031; re-asserted so
--     this migration is self-sufficient on a fresh DB. Multi-org-capable: additional org rows are
--     inserted operationally, never hardcoded here.
INSERT INTO "tenants" ("id", "name", "status")
VALUES ('sentropic', 'Sentropic', 'active')
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint

-- (2) workspaces.tenant_id — the single durable `workspace → tenant` edge (§2). PG ≥11 fast-default:
--     DEFAULT + NOT NULL in one ADD COLUMN (no table rewrite, no lock storm), so old + new pods both
--     satisfy NOT NULL during the roll. Existing rows adopt 'sentropic' via the fast-default (the
--     current single-real-org population); a real per-org backfill would map by owner/known org here.
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "tenant_id" text DEFAULT 'sentropic' NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspaces_tenant_id_idx" ON "workspaces" USING btree ("tenant_id");
--> statement-breakpoint

-- (3) tenant_memberships backfill (§4.1.3): every existing user gets an `approved`/`member` row on
--     the bootstrap org so `tid` can be minted (token-handler requires an approved membership).
--     Idempotent (re-run of the 0031 backfill; catches users created since 0031). New app-created
--     memberships still default to `requested` (column default) — this backfill only grandfathers
--     the current live population.
INSERT INTO "tenant_memberships" ("tenant_id", "user_id", "status", "role", "requested_at", "decided_at")
SELECT 'sentropic', "users"."id", 'approved', 'member', now(), now()
FROM "users"
ON CONFLICT ("tenant_id", "user_id") DO NOTHING;
--> statement-breakpoint

-- (4) oauth_consents.tenant_id — STAGED nullable → backfill → default → NOT NULL (§4.1.4). Staging is
--     required so each existing grant is backfilled to the CONSENTING USER's resolved org before the
--     column is locked NOT NULL (a blanket default would mis-assign in real multi-org). Single-org
--     today → all resolve to 'sentropic'.
ALTER TABLE "oauth_consents" ADD COLUMN IF NOT EXISTS "tenant_id" text;
--> statement-breakpoint
UPDATE "oauth_consents" c
SET "tenant_id" = COALESCE((
  SELECT m."tenant_id"
  FROM "tenant_memberships" m
  WHERE m."user_id" = c."user_id" AND m."status" = 'approved'
  ORDER BY m."decided_at" DESC NULLS LAST
  LIMIT 1
), 'sentropic')
WHERE c."tenant_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "oauth_consents" ALTER COLUMN "tenant_id" SET DEFAULT 'sentropic';
--> statement-breakpoint
ALTER TABLE "oauth_consents" ALTER COLUMN "tenant_id" SET NOT NULL;
--> statement-breakpoint
-- (§1.5) Add the tenant-carrying composite unique index NOW, but KEEP the old (user_id, client_id)
-- index — G1a stays rolling-deploy-safe. ARCHITECT RATIFICATION of BR-G1a-EX1 = option (b) two-phase:
-- dropping the old index in a single deploy would break OLD pods still running
-- `ON CONFLICT (user_id, client_id)` against the new composite during the roll. G1c drops the old
-- index (after ALL pods run the composite-targeting adapter) — which is when multi-org consent, and
-- thus the cross-tenant bypass, actually opens (§4.3). Until then the stricter old index correctly
-- keeps consent single-org.
CREATE UNIQUE INDEX IF NOT EXISTS "oauth_consents_user_id_client_id_tenant_id_unique" ON "oauth_consents" USING btree ("user_id","client_id","tenant_id");
--> statement-breakpoint

-- (5) service_clients.tenant_id (§4.1.6): backfill NULLs + add a DEFAULT so new single-org clients
--     inherit a tenant. Stays nullable (no NOT NULL) — token-tenant columns remain nullable.
UPDATE "service_clients" SET "tenant_id" = 'sentropic' WHERE "tenant_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "service_clients" ALTER COLUMN "tenant_id" SET DEFAULT 'sentropic';
