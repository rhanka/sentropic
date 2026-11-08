CREATE TABLE IF NOT EXISTS "control"."github_app_enrollments" (
	"installation_ref" text PRIMARY KEY NOT NULL,
	"target_key" text,
	"envelope" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
