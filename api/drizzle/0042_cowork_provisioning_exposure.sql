-- Cowork F3 release-block remediation: only the server/conductor may attest a
-- rented kiosk VM, and only explicit workspace grants expose its capabilities.
CREATE TABLE "cowork_device_provisioning" (
  "public_key" text PRIMARY KEY NOT NULL,
  "kiosk_surface" text NOT NULL CHECK ("kiosk_surface" = 'notepad'),
  "capability_ids" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'revoked')),
  "provisioned_by" text NOT NULL,
  "provisioned_at" timestamp NOT NULL DEFAULT now(),
  "revoked_at" timestamp
);

CREATE TABLE "cowork_device_exposure_grants" (
  "device_id" text NOT NULL REFERENCES "cowork_devices"("id") ON DELETE cascade,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "capability" text NOT NULL CHECK ("capability" IN ('screen_capture', 'input_action')),
  "granted_by" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "created_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("device_id", "workspace_id", "capability")
);

CREATE INDEX "cowork_device_exposure_grants_workspace_idx"
  ON "cowork_device_exposure_grants" ("workspace_id", "capability");
