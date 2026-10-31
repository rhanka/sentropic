-- B06 reserves 0020 for W1.a; 0012–0019 belong to #677.
-- Package DDL stays upstream; receipts share the reserved control migration journal.
CREATE TABLE "control"."artifact_host_kv" (
  "storage_scope_id" text NOT NULL CHECK ("storage_scope_id" <> ''),
  "key" text NOT NULL,
  "value" text NOT NULL,
  PRIMARY KEY ("storage_scope_id", "key")
);
--> statement-breakpoint
ALTER TABLE "public"."__drizzle_control_migrations" ADD COLUMN "asset_id" text UNIQUE;
