-- General Cowork Lots 1-2: durable authority only. No execution is introduced.
ALTER TABLE "cowork_devices" ADD COLUMN "pep_public_key" text;
ALTER TABLE "cowork_devices" ADD COLUMN "pep_key_id" text;
ALTER TABLE "cowork_devices" ADD COLUMN "general_profile" jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "cowork_devices" ADD COLUMN "kill_epoch" integer NOT NULL DEFAULT 0;
ALTER TABLE "cowork_devices" DROP CONSTRAINT "cowork_devices_status_check";
ALTER TABLE "cowork_devices" ADD CONSTRAINT "cowork_devices_status_check" CHECK ("status" IN ('active', 'revoking', 'revoked'));

CREATE TABLE "cowork_general_calls" (
  "id" text PRIMARY KEY NOT NULL,
  "principal_id" text NOT NULL REFERENCES "users"("id"),
  "tenant_id" text NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id"),
  "target_device_id" text NOT NULL REFERENCES "cowork_devices"("id"),
  "invocation_id" text NOT NULL,
  "tool_call_id" text NOT NULL,
  "descriptor_ciphertext" text NOT NULL,
  "descriptor_key_ref" text NOT NULL,
  "descriptor_meta" jsonb NOT NULL,
  "state" text NOT NULL DEFAULT 'DÉPOSÉ-EN-ATTENTE' CHECK ("state" IN ('FAIT', 'DÉPOSÉ-EN-ATTENTE', 'PAS-FAIT')),
  "authority_epoch" integer NOT NULL,
  "requires_fresh_authority" boolean NOT NULL DEFAULT true,
  "fresh_authority" jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "cowork_general_calls_logical_unique" ON "cowork_general_calls" ("principal_id", "workspace_id", "tool_call_id");
CREATE INDEX "cowork_general_calls_pending_device_idx" ON "cowork_general_calls" ("target_device_id", "state");

CREATE TABLE "cowork_device_teardown_tombstones" (
  "id" text PRIMARY KEY NOT NULL,
  "device_id" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id"),
  "kill_epoch" integer NOT NULL,
  "reason" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE "cowork_device_proof_challenges" (
  "id" text PRIMARY KEY NOT NULL,
  "device_id" text NOT NULL REFERENCES "cowork_devices"("id") ON DELETE cascade,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "pep_key_id" text NOT NULL,
  "channel" text NOT NULL CHECK ("channel" IN ('poll', 'sse', 'wake', 'ack', 'result', 'stop-status')),
  "resource_id" text NOT NULL,
  "method" text NOT NULL,
  "device_kill_epoch" integer NOT NULL,
  "expires_at" timestamp NOT NULL,
  "consumed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX "cowork_device_proof_challenges_pending_device_idx" ON "cowork_device_proof_challenges" ("device_id", "expires_at");

CREATE TABLE "cowork_device_proof_sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "device_id" text NOT NULL REFERENCES "cowork_devices"("id") ON DELETE cascade,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "pep_key_id" text NOT NULL,
  "channel" text NOT NULL CHECK ("channel" IN ('sse')),
  "resource_id" text NOT NULL,
  "method" text NOT NULL CHECK ("method" IN ('GET')),
  "device_kill_epoch" integer NOT NULL,
  "expires_at" timestamp NOT NULL,
  "consumed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX "cowork_device_proof_sessions_pending_device_idx" ON "cowork_device_proof_sessions" ("device_id", "expires_at");
