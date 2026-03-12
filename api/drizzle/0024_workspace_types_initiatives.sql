-- Migration 0024: Workspace type system, initiative rename, extended objects
-- BR-04 Lot 1 — Single migration file (BR04-EX1)

-- 1. Rename use_cases -> initiatives
ALTER TABLE "use_cases" RENAME TO "initiatives";

-- 2. Add new columns on initiatives (formerly use_cases)
ALTER TABLE "initiatives" ADD COLUMN "antecedent_id" text;
ALTER TABLE "initiatives" ADD COLUMN "maturity_stage" text;
ALTER TABLE "initiatives" ADD COLUMN "gate_status" text;
ALTER TABLE "initiatives" ADD COLUMN "template_snapshot_id" text;

-- Self-FK for lineage
ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_antecedent_id_fk"
  FOREIGN KEY ("antecedent_id") REFERENCES "initiatives"("id");

-- 3. Add new columns on workspaces
ALTER TABLE "workspaces" ADD COLUMN "type" text NOT NULL DEFAULT 'ai-ideas';
ALTER TABLE "workspaces" ADD COLUMN "gate_config" jsonb;

-- 4. Create solutions table
CREATE TABLE "solutions" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id"),
  "initiative_id" text NOT NULL REFERENCES "initiatives"("id"),
  "status" text NOT NULL DEFAULT 'draft',
  "version" integer NOT NULL DEFAULT 1,
  "data" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now()
);

-- 5. Create products table
CREATE TABLE "products" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id"),
  "initiative_id" text NOT NULL REFERENCES "initiatives"("id"),
  "solution_id" text REFERENCES "solutions"("id"),
  "status" text NOT NULL DEFAULT 'draft',
  "version" integer NOT NULL DEFAULT 1,
  "data" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now()
);

-- 6. Create bids table
CREATE TABLE "bids" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id"),
  "initiative_id" text NOT NULL REFERENCES "initiatives"("id"),
  "status" text NOT NULL DEFAULT 'draft',
  "version" integer NOT NULL DEFAULT 1,
  "data" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now()
);

-- 7. Create bid_products junction table
CREATE TABLE "bid_products" (
  "id" text PRIMARY KEY NOT NULL,
  "bid_id" text NOT NULL REFERENCES "bids"("id"),
  "product_id" text NOT NULL REFERENCES "products"("id"),
  "data" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "bid_products" ADD CONSTRAINT "bid_products_bid_product_unique"
  UNIQUE ("bid_id", "product_id");

-- 8. Create workspace_type_workflows registry table
CREATE TABLE "workspace_type_workflows" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_type" text NOT NULL,
  "workflow_definition_id" text NOT NULL REFERENCES "workflow_definitions"("id"),
  "is_default" boolean NOT NULL DEFAULT false,
  "trigger_stage" text,
  "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now()
);

ALTER TABLE "workspace_type_workflows" ADD CONSTRAINT "workspace_type_workflows_type_workflow_unique"
  UNIQUE ("workspace_type", "workflow_definition_id");

-- 9. Create view_templates table
CREATE TABLE "view_templates" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text REFERENCES "workspaces"("id"),
  "workspace_type" text NOT NULL,
  "object_type" text NOT NULL,
  "maturity_stage" text,
  "descriptor" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "version" integer NOT NULL DEFAULT 1,
  "source_level" text NOT NULL DEFAULT 'code',
  "parent_id" text,
  "is_detached" boolean NOT NULL DEFAULT false,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now()
);

-- Self-FK for fork/detach lineage
ALTER TABLE "view_templates" ADD CONSTRAINT "view_templates_parent_id_fk"
  FOREIGN KEY ("parent_id") REFERENCES "view_templates"("id");

-- 10. Indexes
CREATE INDEX "initiatives_antecedent_id_idx" ON "initiatives" ("antecedent_id");
CREATE INDEX "initiatives_maturity_stage_idx" ON "initiatives" ("maturity_stage");
CREATE INDEX "initiatives_gate_status_idx" ON "initiatives" ("gate_status");

CREATE INDEX "workspaces_type_idx" ON "workspaces" ("type");
CREATE INDEX "workspaces_owner_user_id_idx" ON "workspaces" ("owner_user_id");

CREATE INDEX "solutions_workspace_id_idx" ON "solutions" ("workspace_id");
CREATE INDEX "solutions_initiative_id_idx" ON "solutions" ("initiative_id");
CREATE INDEX "solutions_status_idx" ON "solutions" ("status");

CREATE INDEX "products_workspace_id_idx" ON "products" ("workspace_id");
CREATE INDEX "products_initiative_id_idx" ON "products" ("initiative_id");
CREATE INDEX "products_solution_id_idx" ON "products" ("solution_id");
CREATE INDEX "products_status_idx" ON "products" ("status");

CREATE INDEX "bids_workspace_id_idx" ON "bids" ("workspace_id");
CREATE INDEX "bids_initiative_id_idx" ON "bids" ("initiative_id");
CREATE INDEX "bids_status_idx" ON "bids" ("status");

CREATE INDEX "bid_products_bid_id_idx" ON "bid_products" ("bid_id");
CREATE INDEX "bid_products_product_id_idx" ON "bid_products" ("product_id");

CREATE INDEX "workspace_type_workflows_workspace_type_idx" ON "workspace_type_workflows" ("workspace_type");
CREATE INDEX "workspace_type_workflows_workflow_definition_id_idx" ON "workspace_type_workflows" ("workflow_definition_id");

CREATE INDEX "view_templates_workspace_id_idx" ON "view_templates" ("workspace_id");
CREATE INDEX "view_templates_workspace_type_idx" ON "view_templates" ("workspace_type");
CREATE INDEX "view_templates_object_type_idx" ON "view_templates" ("object_type");
CREATE INDEX "view_templates_parent_id_idx" ON "view_templates" ("parent_id");

-- 11. Backfill: ensure all existing workspaces have type 'ai-ideas' (default already handles this, but explicit for clarity)
UPDATE "workspaces" SET "type" = 'ai-ideas' WHERE "type" = 'ai-ideas';

-- 12. Backfill: create one neutral workspace per existing user who doesn't have one
INSERT INTO "workspaces" ("id", "owner_user_id", "name", "type", "created_at", "updated_at")
SELECT
  'neutral-' || u."id",
  u."id",
  'My Workspace',
  'neutral',
  now(),
  now()
FROM "users" u
WHERE NOT EXISTS (
  SELECT 1 FROM "workspaces" w WHERE w."owner_user_id" = u."id" AND w."type" = 'neutral'
);

-- 13. Backfill: seed default view_templates per workspace type (system-level, workspace_id = NULL)
-- ai-ideas templates
INSERT INTO "view_templates" ("id", "workspace_id", "workspace_type", "object_type", "descriptor", "version", "source_level", "is_detached", "created_at", "updated_at")
VALUES
  ('vt-seed-ai-ideas-initiative', NULL, 'ai-ideas', 'initiative', '{"layout": "default"}'::jsonb, 1, 'code', false, now(), now()),
  ('vt-seed-ai-ideas-organization', NULL, 'ai-ideas', 'organization', '{"layout": "default"}'::jsonb, 1, 'code', false, now(), now()),
  ('vt-seed-ai-ideas-dashboard', NULL, 'ai-ideas', 'dashboard', '{"layout": "default"}'::jsonb, 1, 'code', false, now(), now()),
-- opportunity templates
  ('vt-seed-opportunity-initiative', NULL, 'opportunity', 'initiative', '{"layout": "default"}'::jsonb, 1, 'code', false, now(), now()),
  ('vt-seed-opportunity-solution', NULL, 'opportunity', 'solution', '{"layout": "default"}'::jsonb, 1, 'code', false, now(), now()),
  ('vt-seed-opportunity-product', NULL, 'opportunity', 'product', '{"layout": "default"}'::jsonb, 1, 'code', false, now(), now()),
  ('vt-seed-opportunity-bid', NULL, 'opportunity', 'bid', '{"layout": "default"}'::jsonb, 1, 'code', false, now(), now()),
  ('vt-seed-opportunity-organization', NULL, 'opportunity', 'organization', '{"layout": "default"}'::jsonb, 1, 'code', false, now(), now()),
  ('vt-seed-opportunity-dashboard', NULL, 'opportunity', 'dashboard', '{"layout": "default"}'::jsonb, 1, 'code', false, now(), now()),
-- code templates
  ('vt-seed-code-initiative', NULL, 'code', 'initiative', '{"layout": "default"}'::jsonb, 1, 'code', false, now(), now()),
  ('vt-seed-code-organization', NULL, 'code', 'organization', '{"layout": "default"}'::jsonb, 1, 'code', false, now(), now()),
  ('vt-seed-code-dashboard', NULL, 'code', 'dashboard', '{"layout": "default"}'::jsonb, 1, 'code', false, now(), now()),
-- neutral templates
  ('vt-seed-neutral-dashboard', NULL, 'neutral', 'dashboard', '{"layout": "default"}'::jsonb, 1, 'code', false, now(), now())
ON CONFLICT DO NOTHING;
