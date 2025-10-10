CREATE TABLE IF NOT EXISTS "business_config" (
	"id" text PRIMARY KEY NOT NULL,
	"sectors" text,
	"processes" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "companies" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"industry" text,
	"size" text,
	"products" text,
	"processes" text,
	"challenges" text,
	"objectives" text,
	"technologies" text,
	"status" text DEFAULT 'completed',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "folders" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"company_id" text,
	"matrix_config" text,
	"status" text DEFAULT 'completed',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"data" text NOT NULL,
	"result" text,
	"error" text,
	"created_at" timestamp DEFAULT now(),
	"started_at" text,
	"completed_at" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text,
	"profile" text,
	"user_id" text,
	"created_at" timestamp DEFAULT now(),
	"expires_at" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text,
	"description" text,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "use_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"folder_id" text NOT NULL,
	"company_id" text,
	"name" text NOT NULL,
	"description" text,
	"process" text,
	"domain" text,
	"technologies" text,
	"prerequisites" text,
	"deadline" text,
	"contact" text,
	"benefits" text,
	"metrics" text,
	"risks" text,
	"next_steps" text,
	"sources" text,
	"related_data" text,
	"references" text,
	"value_scores" text,
	"complexity_scores" text,
	"total_value_score" integer,
	"total_complexity_score" integer,
	"status" text DEFAULT 'completed',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "folders" ADD CONSTRAINT "folders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "use_cases" ADD CONSTRAINT "use_cases_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "use_cases" ADD CONSTRAINT "use_cases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
