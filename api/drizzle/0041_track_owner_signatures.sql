CREATE TABLE "track_owner_signatures" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_issuer" text NOT NULL,
  "owner_subject" text NOT NULL,
  "workspace_id" text NOT NULL,
  "decision_id" text NOT NULL,
  "contract_version" text NOT NULL,
  "attester_principal_id" text NOT NULL,
  "attester_authenticated_at" text NOT NULL,
  "relayer_transport" text NOT NULL,
  "relayer_id" text NOT NULL,
  "relayer_issuer" text NOT NULL,
  "relayer_subject" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "track_owner_signatures_owner_workspace_decision_unique"
    UNIQUE("owner_issuer", "owner_subject", "workspace_id", "decision_id")
);
