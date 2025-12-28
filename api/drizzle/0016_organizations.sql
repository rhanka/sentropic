-- Organizations refactor:
-- - Rename companies -> organizations
-- - Migrate organization profile fields into JSONB data
-- - Rename FK columns company_id -> organization_id for folders/use_cases

-- 1) Rename table companies -> organizations (idempotent)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'companies'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'organizations'
  ) THEN
    ALTER TABLE "companies" RENAME TO "organizations";
  END IF;
END $$;
--> statement-breakpoint

-- 2) Add JSONB data column on organizations
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "data" jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint

-- 3) Migrate legacy columns into organizations.data (preserve existing keys)
-- Also initialize KPI containers (sector + org) as arrays if missing.
UPDATE "organizations"
SET "data" = COALESCE("data", '{}'::jsonb) || jsonb_build_object(
  'industry', COALESCE("data"->>'industry', "industry"),
  'size', COALESCE("data"->>'size', "size"),
  'products', COALESCE("data"->>'products', "products"),
  'processes', COALESCE("data"->>'processes', "processes"),
  'challenges', COALESCE("data"->>'challenges', "challenges"),
  'objectives', COALESCE("data"->>'objectives', "objectives"),
  'technologies', COALESCE("data"->>'technologies', "technologies"),
  'kpis_sector', COALESCE("data"->'kpis_sector', '[]'::jsonb),
  'kpis_org', COALESCE("data"->'kpis_org', '[]'::jsonb)
)
WHERE
  -- migrate when any legacy column exists and corresponding data key is missing
  ("industry" IS NOT NULL AND ("data"->>'industry' IS NULL))
  OR ("size" IS NOT NULL AND ("data"->>'size' IS NULL))
  OR ("products" IS NOT NULL AND ("data"->>'products' IS NULL))
  OR ("processes" IS NOT NULL AND ("data"->>'processes' IS NULL))
  OR ("challenges" IS NOT NULL AND ("data"->>'challenges' IS NULL))
  OR ("objectives" IS NOT NULL AND ("data"->>'objectives' IS NULL))
  OR ("technologies" IS NOT NULL AND ("data"->>'technologies' IS NULL))
  OR ("data"->'kpis_sector' IS NULL)
  OR ("data"->'kpis_org' IS NULL);
--> statement-breakpoint

-- 4) Drop legacy columns from organizations (now stored in data)
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "industry";
--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "size";
--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "products";
--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "processes";
--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "challenges";
--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "objectives";
--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "technologies";
--> statement-breakpoint

-- 5) Folders: rename company_id -> organization_id and FK target
DO $$ BEGIN
  ALTER TABLE "folders" DROP CONSTRAINT IF EXISTS "folders_company_id_companies_id_fk";
EXCEPTION
  WHEN undefined_table THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'folders' AND column_name = 'company_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'folders' AND column_name = 'organization_id'
  ) THEN
    ALTER TABLE "folders" RENAME COLUMN "company_id" TO "organization_id";
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "folders" ADD CONSTRAINT "folders_organization_id_organizations_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- 6) Use cases: rename company_id -> organization_id and FK target
DO $$ BEGIN
  ALTER TABLE "use_cases" DROP CONSTRAINT IF EXISTS "use_cases_company_id_companies_id_fk";
EXCEPTION
  WHEN undefined_table THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'use_cases' AND column_name = 'company_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'use_cases' AND column_name = 'organization_id'
  ) THEN
    ALTER TABLE "use_cases" RENAME COLUMN "company_id" TO "organization_id";
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "use_cases" ADD CONSTRAINT "use_cases_organization_id_organizations_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint


