-- Migration 0025: BR-04B workflow runtime state MVP
-- Adds additive runtime tables for durable run state and task results without pulling BR-23 into scope.

CREATE TABLE IF NOT EXISTS "workflow_run_state" (
  "run_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "workflow_definition_id" text,
  "status" text NOT NULL DEFAULT 'pending',
  "state" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "version" integer NOT NULL DEFAULT 1,
  "current_task_key" text,
  "current_task_instance_key" text,
  "checkpointed_at" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "workflow_run_state_status_check" CHECK ("workflow_run_state"."status" IN ('pending','in_progress','paused','completed','failed','cancelled','blocked'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_run_state" ADD CONSTRAINT "workflow_run_state_run_id_execution_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."execution_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_run_state" ADD CONSTRAINT "workflow_run_state_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_run_state" ADD CONSTRAINT "workflow_run_state_workflow_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("workflow_definition_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_run_state_workspace_id_idx" ON "workflow_run_state" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_run_state_status_idx" ON "workflow_run_state" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_run_state_workflow_definition_id_idx" ON "workflow_run_state" USING btree ("workflow_definition_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "workflow_task_results" (
  "run_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "workflow_definition_id" text,
  "task_key" text NOT NULL,
  "task_instance_key" text NOT NULL DEFAULT 'main',
  "status" text NOT NULL DEFAULT 'pending',
  "input_payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "output" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "state_patch" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" jsonb,
  "started_at" timestamp,
  "completed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "workflow_task_results_pk" PRIMARY KEY("run_id","task_key","task_instance_key"),
  CONSTRAINT "workflow_task_results_status_check" CHECK ("workflow_task_results"."status" IN ('pending','in_progress','completed','failed','cancelled','blocked','skipped'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_task_results" ADD CONSTRAINT "workflow_task_results_run_id_execution_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."execution_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_task_results" ADD CONSTRAINT "workflow_task_results_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_task_results" ADD CONSTRAINT "workflow_task_results_workflow_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("workflow_definition_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_task_results_workspace_id_idx" ON "workflow_task_results" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_task_results_workflow_definition_id_idx" ON "workflow_task_results" USING btree ("workflow_definition_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_task_results_status_idx" ON "workflow_task_results" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_task_results_task_key_idx" ON "workflow_task_results" USING btree ("task_key");
