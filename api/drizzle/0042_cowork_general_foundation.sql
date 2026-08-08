-- General Cowork Lots 1-2: durable authority only. No execution is introduced.
ALTER TABLE "cowork_devices" ADD COLUMN "pep_public_key" text;
ALTER TABLE "cowork_devices" ADD COLUMN "pep_key_id" text;
ALTER TABLE "cowork_devices" ADD COLUMN "general_profile" jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "cowork_devices" ADD COLUMN "kill_epoch" integer NOT NULL DEFAULT 0;
ALTER TABLE "cowork_devices" DROP CONSTRAINT "cowork_devices_status_check";
ALTER TABLE "cowork_devices" ADD CONSTRAINT "cowork_devices_status_check" CHECK ("status" IN ('active', 'revoking', 'revoked'));

CREATE TABLE "cowork_general_calls" (
  "id" text PRIMARY KEY NOT NULL,
  "principal_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "tenant_id" text NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "target_device_id" text NOT NULL REFERENCES "cowork_devices"("id") ON DELETE cascade,
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
  "user_id" text NOT NULL,
  "kill_epoch" integer NOT NULL,
  "reason" text NOT NULL,
  "revoked_lease_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
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

CREATE OR REPLACE FUNCTION "cowork_general_revoke_call_before_delete"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "cowork_device_leases" SET "status" = 'revoked'
  WHERE "turn_ref" = OLD."id" AND "status" IN ('issued', 'acknowledged');
  UPDATE "cowork_device_proof_challenges" SET "consumed_at" = now()
  WHERE "resource_id" = 'call:' || OLD."id" AND "consumed_at" IS NULL;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION "cowork_general_revoke_device_before_delete"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE revoked_lease_ids jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg("id" ORDER BY "id"), '[]'::jsonb) INTO revoked_lease_ids
  FROM "cowork_device_leases" WHERE "device_id" = OLD."id" AND "status" IN ('issued', 'acknowledged');
  UPDATE "cowork_general_calls"
  SET "state" = 'PAS-FAIT', "requires_fresh_authority" = true, "fresh_authority" = NULL, "updated_at" = now()
  WHERE "target_device_id" = OLD."id" AND "state" = 'DÉPOSÉ-EN-ATTENTE';
  UPDATE "cowork_device_leases" SET "status" = 'revoked'
  WHERE "device_id" = OLD."id" AND "status" IN ('issued', 'acknowledged');
  UPDATE "cowork_device_proof_challenges" SET "consumed_at" = now()
  WHERE "device_id" = OLD."id" AND "consumed_at" IS NULL;
  UPDATE "cowork_device_proof_sessions" SET "consumed_at" = now()
  WHERE "device_id" = OLD."id" AND "consumed_at" IS NULL;
  INSERT INTO "cowork_device_teardown_tombstones" ("id", "device_id", "user_id", "kill_epoch", "reason", "revoked_lease_ids")
  VALUES (gen_random_uuid()::text, OLD."id", OLD."user_id", OLD."kill_epoch" + 1, 'cascade_delete', revoked_lease_ids);
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION "cowork_general_bump_device_epoch"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."pep_public_key" IS DISTINCT FROM NEW."pep_public_key"
     OR OLD."pep_key_id" IS DISTINCT FROM NEW."pep_key_id"
     OR (OLD."status" = 'active' AND NEW."status" <> 'active') THEN
    NEW."kill_epoch" := GREATEST(NEW."kill_epoch", OLD."kill_epoch" + 1);
    UPDATE "cowork_general_calls" SET "requires_fresh_authority" = true, "fresh_authority" = NULL, "updated_at" = now()
    WHERE "target_device_id" = OLD."id" AND "state" = 'DÉPOSÉ-EN-ATTENTE';
    UPDATE "cowork_device_leases" SET "status" = 'revoked'
    WHERE "device_id" = OLD."id" AND "status" IN ('issued', 'acknowledged');
    UPDATE "cowork_device_proof_challenges" SET "consumed_at" = now()
    WHERE "device_id" = OLD."id" AND "consumed_at" IS NULL;
    UPDATE "cowork_device_proof_sessions" SET "consumed_at" = now()
    WHERE "device_id" = OLD."id" AND "consumed_at" IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "cowork_general_call_before_delete_revoke"
BEFORE DELETE ON "cowork_general_calls" FOR EACH ROW EXECUTE FUNCTION "cowork_general_revoke_call_before_delete"();
CREATE TRIGGER "cowork_general_device_before_delete_revoke"
BEFORE DELETE ON "cowork_devices" FOR EACH ROW EXECUTE FUNCTION "cowork_general_revoke_device_before_delete"();
CREATE TRIGGER "cowork_general_device_before_authority_change"
BEFORE UPDATE OF "pep_public_key", "pep_key_id", "status" ON "cowork_devices" FOR EACH ROW EXECUTE FUNCTION "cowork_general_bump_device_epoch"();
