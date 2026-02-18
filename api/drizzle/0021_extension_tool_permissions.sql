-- Custom SQL migration file, put your code below! --
CREATE TABLE IF NOT EXISTS "extension_tool_permissions" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "tool_name" text NOT NULL,
  "origin" text NOT NULL,
  "policy" text NOT NULL DEFAULT 'allow',
  "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "extension_tool_permissions_user_workspace_idx"
  ON "extension_tool_permissions" ("user_id", "workspace_id");
CREATE INDEX IF NOT EXISTS "extension_tool_permissions_tool_origin_idx"
  ON "extension_tool_permissions" ("tool_name", "origin");

CREATE UNIQUE INDEX IF NOT EXISTS "extension_tool_permissions_user_workspace_tool_origin_unique"
  ON "extension_tool_permissions" ("user_id", "workspace_id", "tool_name", "origin");
