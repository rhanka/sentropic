-- Étape 1 : Migrer toutes les données vers data JSONB AVANT de supprimer les colonnes
-- Cette migration est idempotente : elle ne migre que les données qui ne sont pas déjà dans data
UPDATE use_cases 
SET "data" = COALESCE("data", '{}'::jsonb) || jsonb_build_object(
  'name', COALESCE("data"->>'name', "name"),
  'description', COALESCE("data"->>'description', "description"),
  'process', COALESCE("data"->>'process', "process"),
  'domain', COALESCE("data"->>'domain', "domain"),
  'technologies', COALESCE("data"->'technologies', COALESCE("technologies"::jsonb, '[]'::jsonb)),
  'prerequisites', COALESCE("data"->>'prerequisites', "prerequisites"),
  'deadline', COALESCE("data"->>'deadline', "deadline"),
  'contact', COALESCE("data"->>'contact', "contact"),
  'benefits', COALESCE("data"->'benefits', COALESCE("benefits"::jsonb, '[]'::jsonb)),
  'metrics', COALESCE("data"->'metrics', COALESCE("metrics"::jsonb, '[]'::jsonb)),
  'risks', COALESCE("data"->'risks', COALESCE("risks"::jsonb, '[]'::jsonb)),
  'nextSteps', COALESCE("data"->'nextSteps', COALESCE("next_steps"::jsonb, '[]'::jsonb)),
  'dataSources', COALESCE("data"->'dataSources', COALESCE("data_sources"::jsonb, '[]'::jsonb)),
  'dataObjects', COALESCE("data"->'dataObjects', COALESCE("data_objects"::jsonb, '[]'::jsonb)),
  'references', COALESCE("data"->'references', COALESCE("references"::jsonb, '[]'::jsonb)),
  'valueScores', COALESCE("data"->'valueScores', COALESCE("value_scores"::jsonb, '[]'::jsonb)),
  'complexityScores', COALESCE("data"->'complexityScores', COALESCE("complexity_scores"::jsonb, '[]'::jsonb))
)
WHERE 
  -- Migrer si data.name ou data.description manquent
  ("data"->>'name' IS NULL OR "data"->>'description' IS NULL)
  -- Ou si les colonnes natives ont des valeurs non migrées
  OR ("name" IS NOT NULL AND ("data"->>'name' IS NULL))
  OR ("description" IS NOT NULL AND ("data"->>'description' IS NULL))
  OR ("process" IS NOT NULL AND ("data"->>'process' IS NULL))
  OR ("domain" IS NOT NULL AND ("data"->>'domain' IS NULL))
  OR ("technologies" IS NOT NULL AND ("data"->'technologies' IS NULL))
  OR ("prerequisites" IS NOT NULL AND ("data"->>'prerequisites' IS NULL))
  OR ("deadline" IS NOT NULL AND ("data"->>'deadline' IS NULL))
  OR ("contact" IS NOT NULL AND ("data"->>'contact' IS NULL))
  OR ("benefits" IS NOT NULL AND ("data"->'benefits' IS NULL))
  OR ("metrics" IS NOT NULL AND ("data"->'metrics' IS NULL))
  OR ("risks" IS NOT NULL AND ("data"->'risks' IS NULL))
  OR ("next_steps" IS NOT NULL AND ("data"->'nextSteps' IS NULL))
  OR ("data_sources" IS NOT NULL AND ("data"->'dataSources' IS NULL))
  OR ("data_objects" IS NOT NULL AND ("data"->'dataObjects' IS NULL))
  OR ("references" IS NOT NULL AND ("data"->'references' IS NULL))
  OR ("value_scores" IS NOT NULL AND ("data"->'valueScores' IS NULL))
  OR ("complexity_scores" IS NOT NULL AND ("data"->'complexityScores' IS NULL))
;--> statement-breakpoint

-- Étape 2 : Supprimer toutes les colonnes migrées (name, description, et toutes les autres colonnes temporaires)
ALTER TABLE "use_cases" DROP COLUMN IF EXISTS "name";--> statement-breakpoint
ALTER TABLE "use_cases" DROP COLUMN IF EXISTS "description";--> statement-breakpoint
ALTER TABLE "use_cases" DROP COLUMN IF EXISTS "process";--> statement-breakpoint
ALTER TABLE "use_cases" DROP COLUMN IF EXISTS "domain";--> statement-breakpoint
ALTER TABLE "use_cases" DROP COLUMN IF EXISTS "technologies";--> statement-breakpoint
ALTER TABLE "use_cases" DROP COLUMN IF EXISTS "prerequisites";--> statement-breakpoint
ALTER TABLE "use_cases" DROP COLUMN IF EXISTS "deadline";--> statement-breakpoint
ALTER TABLE "use_cases" DROP COLUMN IF EXISTS "contact";--> statement-breakpoint
ALTER TABLE "use_cases" DROP COLUMN IF EXISTS "benefits";--> statement-breakpoint
ALTER TABLE "use_cases" DROP COLUMN IF EXISTS "metrics";--> statement-breakpoint
ALTER TABLE "use_cases" DROP COLUMN IF EXISTS "risks";--> statement-breakpoint
ALTER TABLE "use_cases" DROP COLUMN IF EXISTS "next_steps";--> statement-breakpoint
ALTER TABLE "use_cases" DROP COLUMN IF EXISTS "data_sources";--> statement-breakpoint
ALTER TABLE "use_cases" DROP COLUMN IF EXISTS "data_objects";--> statement-breakpoint
ALTER TABLE "use_cases" DROP COLUMN IF EXISTS "references";--> statement-breakpoint
ALTER TABLE "use_cases" DROP COLUMN IF EXISTS "value_scores";--> statement-breakpoint
ALTER TABLE "use_cases" DROP COLUMN IF EXISTS "complexity_scores";--> statement-breakpoint