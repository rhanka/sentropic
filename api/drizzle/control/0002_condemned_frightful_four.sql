CREATE TABLE IF NOT EXISTS "control"."app_instance_hostnames" (
	"hostname" text PRIMARY KEY NOT NULL,
	"app_instance_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "control"."app_instances" (
	"id" text PRIMARY KEY NOT NULL,
	"template_family_id" text NOT NULL,
	"template_version" text NOT NULL,
	"tenant_id" text NOT NULL,
	"identity_tenant_id" text,
	"environment" text DEFAULT 'preview' NOT NULL,
	"status" text DEFAULT 'provisioning' NOT NULL,
	"desired_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"observed_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_instances_environment_check" CHECK ("control"."app_instances"."environment" IN ('prod', 'preview', 'local')),
	CONSTRAINT "app_instances_status_check" CHECK ("control"."app_instances"."status" IN ('provisioning', 'active', 'suspended', 'retired'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "control"."app_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"app_slug" text NOT NULL,
	"version" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"blueprint" jsonb NOT NULL,
	"blueprint_schema_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_templates_status_check" CHECK ("control"."app_templates"."status" IN ('draft', 'published', 'deprecated'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "control"."app_workspace_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"app_instance_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"identity_tenant_id" text,
	"allowed_workspace_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"default_workspace_template" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_instance_hostnames_instance_idx" ON "control"."app_instance_hostnames" USING btree ("app_instance_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_instances_template_idx" ON "control"."app_instances" USING btree ("template_family_id","template_version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_instances_tenant_idx" ON "control"."app_instances" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "app_templates_slug_version_unique" ON "control"."app_templates" USING btree ("app_slug","version");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "app_templates_family_version_unique" ON "control"."app_templates" USING btree ("family_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "app_workspace_bindings_instance_workspace_unique" ON "control"."app_workspace_bindings" USING btree ("app_instance_id","workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_workspace_bindings_tenant_workspace_idx" ON "control"."app_workspace_bindings" USING btree ("tenant_id","workspace_id");