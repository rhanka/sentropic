-- Custom SQL migration file, put your code below! --
CREATE TABLE IF NOT EXISTS "comments" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "context_type" text NOT NULL,
  "context_id" text NOT NULL,
  "section_key" text,
  "created_by" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "assigned_to" text REFERENCES "users"("id") ON DELETE SET NULL,
  "status" text NOT NULL DEFAULT 'open',
  "thread_id" text NOT NULL,
  "content" text NOT NULL,
  "tool_call_id" text,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "comments_workspace_id_idx" ON "comments" ("workspace_id");
CREATE INDEX IF NOT EXISTS "comments_context_idx" ON "comments" ("context_type", "context_id");
CREATE INDEX IF NOT EXISTS "comments_thread_id_idx" ON "comments" ("thread_id");
CREATE INDEX IF NOT EXISTS "comments_assigned_to_idx" ON "comments" ("assigned_to");
CREATE INDEX IF NOT EXISTS "comments_status_idx" ON "comments" ("status");
CREATE INDEX IF NOT EXISTS "comments_tool_call_id_idx" ON "comments" ("tool_call_id");