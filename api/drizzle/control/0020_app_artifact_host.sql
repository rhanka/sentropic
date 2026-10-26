-- B06 reserves 0020 for W1.a; 0012–0019 belong to #677.
-- Package DDL stays in its original assets and is installed by runMigrations.
CREATE TABLE "control"."artifact_host_kv" (
  "storage_scope_id" text NOT NULL CHECK ("storage_scope_id" <> ''),
  "key" text NOT NULL,
  "value" text NOT NULL,
  PRIMARY KEY ("storage_scope_id", "key")
);
--> statement-breakpoint
CREATE TABLE "control"."artifact_package_migrations" (
  "asset_id" text PRIMARY KEY,
  "sha256" text NOT NULL CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  "installed_at" timestamptz NOT NULL DEFAULT now()
);
