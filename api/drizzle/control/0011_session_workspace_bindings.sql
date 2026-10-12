CREATE TABLE IF NOT EXISTS "control"."session_workspace_bindings" (
	"binding_id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"status" text DEFAULT 'attached' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"detached_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	CONSTRAINT "session_workspace_bindings_status_check" CHECK ("control"."session_workspace_bindings"."status" IN ('attached', 'detached', 'ended'))
);
--> statement-breakpoint
ALTER TABLE "control"."session_workspace_bindings" ADD COLUMN IF NOT EXISTS "principal_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "session_workspace_bindings_session_unique" ON "control"."session_workspace_bindings" USING btree ("session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_workspace_bindings_tenant_workspace_idx" ON "control"."session_workspace_bindings" USING btree ("tenant_id","workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_workspace_bindings_tenant_principal_idx" ON "control"."session_workspace_bindings" USING btree ("tenant_id","principal_id");
