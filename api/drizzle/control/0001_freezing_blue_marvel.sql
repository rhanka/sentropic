CREATE SCHEMA IF NOT EXISTS "control";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "control"."event_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"seq" bigint NOT NULL,
	"envelope" jsonb NOT NULL,
	"trace_id" text,
	"lineage" jsonb,
	"origin" text,
	"tenant_id" text,
	"workspace_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"claimed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"dispatched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"channel" text NOT NULL,
	CONSTRAINT "event_outbox_status_check" CHECK ("control"."event_outbox"."status" IN ('pending', 'processing', 'dispatched', 'failed')),
	CONSTRAINT "event_outbox_attempts_check" CHECK ("control"."event_outbox"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "control"."object_type_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"object_type" text NOT NULL,
	"tenant_id" text,
	"json_schema" jsonb NOT NULL,
	"declared_queryable_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"typed_reference_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"classification" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "object_type_definitions_status_check" CHECK ("control"."object_type_definitions"."status" IN ('draft', 'active', 'deprecated')),
	CONSTRAINT "object_type_definitions_schema_version_check" CHECK ("control"."object_type_definitions"."schema_version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "event_outbox_aggregate_seq_unique" ON "control"."event_outbox" USING btree ("aggregate_type","aggregate_id","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_outbox_status_dispatch_idx" ON "control"."event_outbox" USING btree ("status","aggregate_type","aggregate_id","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_outbox_tenant_workspace_idx" ON "control"."event_outbox" USING btree ("tenant_id","workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "object_type_definitions_type_tenant_unique" ON "control"."object_type_definitions" USING btree ("object_type",coalesce("tenant_id", ''));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "object_type_definitions_tenant_idx" ON "control"."object_type_definitions" USING btree ("tenant_id");