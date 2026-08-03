-- BR-41c: durable Cowork device identity, presence, and authorization leases.
-- This migration is deliberately authorization-only: it does not schedule or
-- execute remote screen capture or input actions.
CREATE TABLE "cowork_devices" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "device_name" text,
  "public_key" text NOT NULL,
  "public_key_fingerprint" text NOT NULL,
  "capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text DEFAULT 'active' NOT NULL CHECK ("status" IN ('active', 'revoked')),
  "enrolled_at" timestamp DEFAULT now() NOT NULL,
  "revoked_at" timestamp
);

CREATE INDEX "cowork_devices_user_status_idx" ON "cowork_devices" ("user_id", "status");
CREATE INDEX "cowork_devices_fingerprint_idx" ON "cowork_devices" ("public_key_fingerprint");

CREATE TABLE "cowork_device_presence" (
  "device_id" text PRIMARY KEY NOT NULL REFERENCES "cowork_devices"("id") ON DELETE cascade,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "status" text DEFAULT 'active' NOT NULL CHECK ("status" IN ('active', 'disconnected')),
  "connected_at" timestamp DEFAULT now() NOT NULL,
  "last_seen_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX "cowork_device_presence_user_status_idx" ON "cowork_device_presence" ("user_id", "status");

CREATE TABLE "cowork_device_leases" (
  "id" text PRIMARY KEY NOT NULL,
  "device_id" text NOT NULL REFERENCES "cowork_devices"("id") ON DELETE cascade,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "turn_ref" text NOT NULL,
  "nonce" text NOT NULL,
  "scope" jsonb,
  "status" text DEFAULT 'issued' NOT NULL CHECK ("status" IN ('issued', 'acknowledged', 'consumed', 'expired', 'revoked')),
  "issued_at" timestamp DEFAULT now() NOT NULL,
  "acknowledged_at" timestamp,
  "consumed_at" timestamp,
  "expires_at" timestamp NOT NULL
);

CREATE INDEX "cowork_device_leases_device_status_idx" ON "cowork_device_leases" ("device_id", "status");
CREATE INDEX "cowork_device_leases_expires_idx" ON "cowork_device_leases" ("expires_at");
CREATE UNIQUE INDEX "cowork_device_leases_device_turn_unique"
  ON "cowork_device_leases" ("device_id", "turn_ref")
  WHERE "status" IN ('issued', 'acknowledged');
