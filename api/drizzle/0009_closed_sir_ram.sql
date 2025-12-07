ALTER TABLE "webauthn_credentials" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
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
ALTER TABLE "use_cases" DROP COLUMN IF EXISTS "complexity_scores";