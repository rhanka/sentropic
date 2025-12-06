ALTER TABLE "companies" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "email_verification_codes" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "folders" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "job_queue" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "magic_links" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "use_cases" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_sessions" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "created_at" SET NOT NULL;