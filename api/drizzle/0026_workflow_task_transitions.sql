-- Migration 0026: BR-04B generic workflow task transitions
-- Adds explicit workflow graph transitions for runtime scheduling.

CREATE TABLE IF NOT EXISTS "workflow_task_transitions" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "workflow_definition_id" text NOT NULL,
  "from_task_key" text,
  "to_task_key" text,
  "transition_type" text NOT NULL DEFAULT 'normal',
  "condition" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "workflow_task_transitions_type_check" CHECK ("workflow_task_transitions"."transition_type" IN ('start','normal','conditional','fanout','join','end'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_task_transitions" ADD CONSTRAINT "workflow_task_transitions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_task_transitions" ADD CONSTRAINT "workflow_task_transitions_workflow_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("workflow_definition_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_task_transitions_workflow_definition_id_idx" ON "workflow_task_transitions" USING btree ("workflow_definition_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_task_transitions_workspace_id_idx" ON "workflow_task_transitions" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_task_transitions_from_task_key_idx" ON "workflow_task_transitions" USING btree ("workflow_definition_id", "from_task_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_task_transitions_to_task_key_idx" ON "workflow_task_transitions" USING btree ("workflow_definition_id", "to_task_key");
