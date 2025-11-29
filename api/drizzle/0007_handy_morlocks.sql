ALTER TABLE "use_cases" ADD COLUMN "data" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "use_cases" DROP COLUMN IF EXISTS "total_value_score";--> statement-breakpoint
ALTER TABLE "use_cases" DROP COLUMN IF EXISTS "total_complexity_score";