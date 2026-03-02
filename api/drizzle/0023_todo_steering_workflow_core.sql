CREATE TABLE IF NOT EXISTS "plans" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "created_by_user_id" text,
  "owner_user_id" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "plans" ADD CONSTRAINT "plans_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "plans" ADD CONSTRAINT "plans_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "plans" ADD CONSTRAINT "plans_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plans_workspace_id_idx" ON "plans" USING btree ("workspace_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "todos" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "plan_id" text,
  "parent_todo_id" text,
  "title" text NOT NULL,
  "description" text,
  "position" integer NOT NULL DEFAULT 0,
  "created_by_user_id" text,
  "owner_user_id" text,
  "closed_at" timestamp,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "todos" ADD CONSTRAINT "todos_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "todos" ADD CONSTRAINT "todos_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "todos" ADD CONSTRAINT "todos_parent_todo_id_todos_id_fk" FOREIGN KEY ("parent_todo_id") REFERENCES "public"."todos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "todos" ADD CONSTRAINT "todos_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "todos" ADD CONSTRAINT "todos_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "todos_workspace_id_idx" ON "todos" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "todos_plan_id_idx" ON "todos" USING btree ("plan_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "todos_parent_todo_id_idx" ON "todos" USING btree ("parent_todo_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "todos_owner_user_id_idx" ON "todos" USING btree ("owner_user_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "tasks" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "todo_id" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "position" integer NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'todo',
  "created_by_user_id" text,
  "assignee_user_id" text,
  "started_at" timestamp,
  "completed_at" timestamp,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "tasks_status_check" CHECK ("tasks"."status" IN ('todo','planned','in_progress','blocked','done','deferred','cancelled'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tasks" ADD CONSTRAINT "tasks_todo_id_todos_id_fk" FOREIGN KEY ("todo_id") REFERENCES "public"."todos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_workspace_id_idx" ON "tasks" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_todo_id_idx" ON "tasks" USING btree ("todo_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_status_idx" ON "tasks" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_assignee_user_id_idx" ON "tasks" USING btree ("assignee_user_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "todo_dependencies" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "todo_id" text NOT NULL,
  "depends_on_todo_id" text NOT NULL,
  "dependency_type" text NOT NULL DEFAULT 'blocks',
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "todo_dependencies" ADD CONSTRAINT "todo_dependencies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "todo_dependencies" ADD CONSTRAINT "todo_dependencies_todo_id_todos_id_fk" FOREIGN KEY ("todo_id") REFERENCES "public"."todos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "todo_dependencies" ADD CONSTRAINT "todo_dependencies_depends_on_todo_id_todos_id_fk" FOREIGN KEY ("depends_on_todo_id") REFERENCES "public"."todos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "todo_dependencies_unique_idx" ON "todo_dependencies" USING btree ("todo_id","depends_on_todo_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "todo_dependencies_workspace_id_idx" ON "todo_dependencies" USING btree ("workspace_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "task_dependencies" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "task_id" text NOT NULL,
  "depends_on_task_id" text NOT NULL,
  "dependency_type" text NOT NULL DEFAULT 'blocks',
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_depends_on_task_id_tasks_id_fk" FOREIGN KEY ("depends_on_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_dependencies_unique_idx" ON "task_dependencies" USING btree ("task_id","depends_on_task_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_dependencies_workspace_id_idx" ON "task_dependencies" USING btree ("workspace_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "task_io_contracts" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "task_id" text NOT NULL,
  "schema_format" text NOT NULL DEFAULT 'json_schema',
  "input_schema" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "output_schema" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "task_io_contracts_schema_format_check" CHECK ("task_io_contracts"."schema_format" = 'json_schema')
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_io_contracts" ADD CONSTRAINT "task_io_contracts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_io_contracts" ADD CONSTRAINT "task_io_contracts_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_io_contracts_task_id_unique" ON "task_io_contracts" USING btree ("task_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_io_contracts_workspace_id_idx" ON "task_io_contracts" USING btree ("workspace_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "agent_definitions" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "source_level" text NOT NULL DEFAULT 'code',
  "lineage_root_id" text,
  "parent_id" text,
  "is_detached" boolean NOT NULL DEFAULT false,
  "last_parent_sync_at" timestamp,
  "created_by_user_id" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "agent_definitions_source_level_check" CHECK ("agent_definitions"."source_level" IN ('code','admin','user'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_definitions" ADD CONSTRAINT "agent_definitions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_definitions" ADD CONSTRAINT "agent_definitions_parent_id_agent_definitions_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."agent_definitions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_definitions" ADD CONSTRAINT "agent_definitions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_definitions_workspace_key_unique" ON "agent_definitions" USING btree ("workspace_id","key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_definitions_workspace_id_idx" ON "agent_definitions" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_definitions_parent_id_idx" ON "agent_definitions" USING btree ("parent_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "workflow_definitions" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "source_level" text NOT NULL DEFAULT 'code',
  "lineage_root_id" text,
  "parent_id" text,
  "is_detached" boolean NOT NULL DEFAULT false,
  "last_parent_sync_at" timestamp,
  "created_by_user_id" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "workflow_definitions_source_level_check" CHECK ("workflow_definitions"."source_level" IN ('code','admin','user'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_parent_id_workflow_definitions_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_definitions_workspace_key_unique" ON "workflow_definitions" USING btree ("workspace_id","key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_definitions_workspace_id_idx" ON "workflow_definitions" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_definitions_parent_id_idx" ON "workflow_definitions" USING btree ("parent_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "workflow_definition_tasks" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "workflow_definition_id" text NOT NULL,
  "task_key" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "order_index" integer NOT NULL DEFAULT 0,
  "agent_definition_id" text,
  "schema_format" text NOT NULL DEFAULT 'json_schema',
  "input_schema" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "output_schema" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "section_key" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "workflow_definition_tasks_schema_format_check" CHECK ("workflow_definition_tasks"."schema_format" = 'json_schema')
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_definition_tasks" ADD CONSTRAINT "workflow_definition_tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_definition_tasks" ADD CONSTRAINT "workflow_definition_tasks_workflow_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("workflow_definition_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_definition_tasks" ADD CONSTRAINT "workflow_definition_tasks_agent_definition_id_agent_definitions_id_fk" FOREIGN KEY ("agent_definition_id") REFERENCES "public"."agent_definitions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_definition_tasks_unique_key" ON "workflow_definition_tasks" USING btree ("workflow_definition_id","task_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_definition_tasks_order_idx" ON "workflow_definition_tasks" USING btree ("workflow_definition_id","order_index");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_definition_tasks_workspace_id_idx" ON "workflow_definition_tasks" USING btree ("workspace_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "guardrails" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text NOT NULL,
  "category" text NOT NULL,
  "title" text,
  "instruction" text NOT NULL,
  "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by_user_id" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "guardrails_entity_type_check" CHECK ("guardrails"."entity_type" IN ('plan','todo','task')),
  CONSTRAINT "guardrails_category_check" CHECK ("guardrails"."category" IN ('scope','quality','safety','approval'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "guardrails" ADD CONSTRAINT "guardrails_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "guardrails" ADD CONSTRAINT "guardrails_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "guardrails_workspace_id_idx" ON "guardrails" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "guardrails_entity_idx" ON "guardrails" USING btree ("entity_type","entity_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "entity_links" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "source_entity_type" text NOT NULL,
  "source_entity_id" text NOT NULL,
  "target_object_type" text NOT NULL,
  "target_object_id" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "entity_links_source_entity_type_check" CHECK ("entity_links"."source_entity_type" IN ('plan','todo','task'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_links" ADD CONSTRAINT "entity_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "entity_links_unique_idx" ON "entity_links" USING btree ("workspace_id","source_entity_type","source_entity_id","target_object_type","target_object_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_links_source_entity_idx" ON "entity_links" USING btree ("source_entity_type","source_entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_links_target_object_idx" ON "entity_links" USING btree ("target_object_type","target_object_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "execution_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "plan_id" text,
  "todo_id" text,
  "task_id" text,
  "workflow_definition_id" text,
  "agent_definition_id" text,
  "mode" text NOT NULL DEFAULT 'manual',
  "status" text NOT NULL DEFAULT 'pending',
  "started_by_user_id" text,
  "started_at" timestamp NOT NULL DEFAULT now(),
  "completed_at" timestamp,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "execution_runs_mode_check" CHECK ("execution_runs"."mode" IN ('manual','sub_agentic','full_auto')),
  CONSTRAINT "execution_runs_status_check" CHECK ("execution_runs"."status" IN ('pending','in_progress','paused','completed','failed','cancelled','blocked'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "execution_runs" ADD CONSTRAINT "execution_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "execution_runs" ADD CONSTRAINT "execution_runs_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "execution_runs" ADD CONSTRAINT "execution_runs_todo_id_todos_id_fk" FOREIGN KEY ("todo_id") REFERENCES "public"."todos"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "execution_runs" ADD CONSTRAINT "execution_runs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "execution_runs" ADD CONSTRAINT "execution_runs_workflow_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("workflow_definition_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "execution_runs" ADD CONSTRAINT "execution_runs_agent_definition_id_agent_definitions_id_fk" FOREIGN KEY ("agent_definition_id") REFERENCES "public"."agent_definitions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "execution_runs" ADD CONSTRAINT "execution_runs_started_by_user_id_users_id_fk" FOREIGN KEY ("started_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "execution_runs_workspace_id_idx" ON "execution_runs" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "execution_runs_status_idx" ON "execution_runs" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "execution_runs_task_id_idx" ON "execution_runs" USING btree ("task_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "execution_events" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "run_id" text NOT NULL,
  "event_type" text NOT NULL,
  "actor_type" text,
  "actor_id" text,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "sequence" integer NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "execution_events" ADD CONSTRAINT "execution_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "execution_events" ADD CONSTRAINT "execution_events_run_id_execution_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."execution_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "execution_events_run_id_sequence_unique" ON "execution_events" USING btree ("run_id","sequence");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "execution_events_workspace_id_idx" ON "execution_events" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "execution_events_run_id_idx" ON "execution_events" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "execution_events_event_type_idx" ON "execution_events" USING btree ("event_type");
