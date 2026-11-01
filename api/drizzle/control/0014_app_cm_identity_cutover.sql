-- Lot A4: app identity cutover to the cluster-mesh cm_identity stores (r13 D11 replacement gate).
-- ONE control migration, ONE transaction: CM schema + id-preserving data copy + rollback checkpoint
-- (recorded BEFORE any legacy table is deleted) + legacy identity table deletion.
-- Timestamps are ISO-8601 text in cm_identity; legacy timestamp columns are read as UTC.
-- The WebAuthn RP ID is taken from the app.webauthn_rp_id GUC set by the API before migrations
-- (falls back to 'localhost').
CREATE OR REPLACE FUNCTION pg_temp.a4_iso(ts timestamp) RETURNS text LANGUAGE sql IMMUTABLE
AS $$ SELECT to_char(ts, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;
CREATE SCHEMA IF NOT EXISTS "cm_identity";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cm_identity"."identity_user_accounts" ("user_id" text PRIMARY KEY, "email" text UNIQUE NOT NULL, "account_status" text NOT NULL, "global_role" text NOT NULL, "created_at" text NOT NULL, "updated_at" text NOT NULL)
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cm_identity"."identity_proofs" ("proof_id" text PRIMARY KEY, "user_id" text NOT NULL, "kind" text NOT NULL, "provider" text, "expires_at" text, "consumed_at" text, "revoked_at" text, "created_at" text NOT NULL)
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cm_identity"."identity_invitations" ("invitation_id" text PRIMARY KEY, "email" text NOT NULL, "tenant_id" text, "workspace_id" text, "token" text UNIQUE NOT NULL, "status" text NOT NULL, "expires_at" text NOT NULL, "consumed_at" text)
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cm_identity"."identity_device_codes" ("device_code" text PRIMARY KEY, "user_code" text UNIQUE NOT NULL, "device_name" text, "status" text NOT NULL, "approved_user_id" text, "approved_at" text, "issued_at" text NOT NULL, "expires_at" text NOT NULL)
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cm_identity"."identity_login_sessions" ("session_id" text PRIMARY KEY, "user_id" text NOT NULL, "status" text NOT NULL, "mfa_state" text NOT NULL, "created_at" text NOT NULL, "expires_at" text NOT NULL, "revoked_at" text, "refresh_count" integer NOT NULL)
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cm_identity"."identity_audit_events" ("at" text NOT NULL, "kind" text NOT NULL, "actor_id" text, "subject_id" text, "detail" text)
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cm_identity"."identity_account_profiles" ("user_id" text PRIMARY KEY, "email_verified" integer NOT NULL CHECK ("email_verified" IN (0,1)), "display_name" text, "approval_due_at" text, "approved_at" text, "approved_by_user_id" text, "disabled_at" text, "disabled_reason" text, "legacy_account_status" text)
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cm_identity"."identity_webauthn_credentials" ("proof_id" text PRIMARY KEY, "user_id" text NOT NULL, "credential_id" text UNIQUE NOT NULL, "public_key_cose" text NOT NULL, "counter" bigint NOT NULL CHECK ("counter" BETWEEN 0 AND 4294967295), "revision" bigint NOT NULL CHECK ("revision" BETWEEN 0 AND 9007199254740991), "rp_id" text NOT NULL, "device_name" text, "transports_json" text, "uv" integer NOT NULL CHECK ("uv" IN (0,1)), "device_type" text, "backed_up" integer CHECK ("backed_up" IN (0,1)), "created_at" text NOT NULL, "last_used_at" text, "revoked_at" text)
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cm_identity"."identity_single_use_proofs" ("kind" text NOT NULL CHECK ("kind" IN ('webauthn_challenge','email_code','magic_link')), "proof_id" text NOT NULL, "user_id" text, "state" text NOT NULL CHECK ("state" IN ('pending','consumed','revoked')), "revision" bigint NOT NULL CHECK ("revision" BETWEEN 0 AND 9007199254740991), "created_at" text NOT NULL, "expires_at" text NOT NULL, "consumed_at" text, "revoked_at" text, "challenge" text, "challenge_purpose" text, "rp_id" text, "allowed_origins_json" text, "user_verification" text, "email" text, "secret_digest" text, "digest_algorithm" text, "digest_key_ref" text, PRIMARY KEY ("kind", "proof_id"))
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cm_identity"."identity_email_registration_tickets" ("code_kind" text NOT NULL CHECK ("code_kind" = 'email_code'), "code_proof_id" text PRIMARY KEY, "email" text NOT NULL, "token_hash" text UNIQUE NOT NULL, "user_id" text, "state" text NOT NULL CHECK ("state" IN ('pending','consumed','revoked')), "revision" bigint NOT NULL CHECK ("revision" BETWEEN 0 AND 9007199254740991), "created_at" text NOT NULL, "expires_at" text NOT NULL, "consumed_at" text, "revoked_at" text)
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cm_identity"."identity_invitation_digests" ("invitation_id" text PRIMARY KEY, "email" text NOT NULL, "tenant_id" text, "workspace_id" text, "client_id" text, "token_hash" text UNIQUE NOT NULL, "status" text NOT NULL CHECK ("status" IN ('pending','consumed','revoked')), "expires_at" text NOT NULL, "created_at" text, "consumed_at" text, "consumed_by_user_id" text, "revision" bigint NOT NULL CHECK ("revision" BETWEEN 0 AND 9007199254740991))
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cm_identity"."identity_login_token_bindings" ("session_id" text PRIMARY KEY, "session_token_hash" text UNIQUE NOT NULL, "refresh_token_hash" text UNIQUE, "mfa_verified" integer NOT NULL CHECK ("mfa_verified" IN (0,1)), "auth_time" bigint NOT NULL CHECK ("auth_time" BETWEEN 0 AND 9007199254740991), "session_version" bigint NOT NULL CHECK ("session_version" BETWEEN 0 AND 9007199254740991), "rotation_version" bigint NOT NULL CHECK ("rotation_version" BETWEEN 0 AND 9007199254740991), "device_name" text, "ip_address" text, "user_agent" text, "last_activity_at" text)
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cm_identity"."identity_social_links" ("proof_id" text PRIMARY KEY, "user_id" text NOT NULL, "provider" text NOT NULL, "provider_subject" text NOT NULL, "provider_tenant" text, "email_at_link" text, "email_verified_by_provider" integer NOT NULL CHECK ("email_verified_by_provider" IN (0,1)), "linked_at" text NOT NULL, "last_login_at" text, "revoked_at" text, "revision" bigint NOT NULL CHECK ("revision" BETWEEN 0 AND 9007199254740991))
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cm_identity"."identity_subject_fences" ("user_id" text PRIMARY KEY, "revision" bigint NOT NULL CHECK ("revision" BETWEEN 0 AND 9007199254740991), "updated_at" text NOT NULL, "retired_at" text)
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cm_identity"."identity_deletion_operations" ("operation_id" text PRIMARY KEY, "user_id" text NOT NULL, "actor_id" text NOT NULL, "handler_id" text NOT NULL CHECK ("handler_id" IN ('self_account','admin_account')), "request_digest" text NOT NULL, "state" text NOT NULL CHECK ("state" IN ('queued','committed')), "created_at" text NOT NULL, "committed_at" text, "committed_receipt_json" text)
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cm_identity"."identity_deletion_attempts" ("attempt_id" text PRIMARY KEY, "operation_id" text NOT NULL, "at" text NOT NULL, "receipt_json" text NOT NULL)
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cm_identity"."identity_revocation_outbox" ("delivery_id" text PRIMARY KEY, "operation_id" text NOT NULL, "step" text NOT NULL, "subject_id" text NOT NULL, "target_kind" text NOT NULL, "target_ref" text NOT NULL, "state" text NOT NULL CHECK ("state" IN ('pending','delivered')), "created_at" text NOT NULL, "next_attempt_at" text NOT NULL, "custody_ref" text, "delivered_at" text, "claim_owner" text, "lease_until" text, "claim_version" bigint NOT NULL CHECK ("claim_version" BETWEEN 0 AND 9007199254740991), "attempt_count" bigint NOT NULL CHECK ("attempt_count" BETWEEN 0 AND 9007199254740991))
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cm_identity"."identity_import_receipts" ("migration_id" text PRIMARY KEY, "source_snapshot_ref" text NOT NULL, "source_snapshot_digest" text NOT NULL, "manifest_digest" text NOT NULL, "contract_version" text NOT NULL, "imported_at" text NOT NULL, "receipt_json" text NOT NULL)
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cm_identity"."identity_custody_schema_versions" ("migration_id" text PRIMARY KEY, "contract_version" text NOT NULL, "asset_sha256" text NOT NULL, "applied_at" text NOT NULL)
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cm_identity"."connector_revocation_custody" ("custody_ref" text PRIMARY KEY, "delivery_id" text UNIQUE NOT NULL, "connector_account_id" text NOT NULL, "provider" text NOT NULL, "envelope_version" text NOT NULL CHECK ("envelope_version" = '1'), "key_ref" text NOT NULL, "nonce" text NOT NULL, "ciphertext" text NOT NULL, "auth_tag" text NOT NULL, "created_at" text NOT NULL)
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cm_identity"."identity_legacy_connector_tombstones" ("source_event_id" text PRIMARY KEY, "connector_account_id" text NOT NULL, "provider" text NOT NULL, "subject_id" text, "disposition" text NOT NULL CHECK ("disposition" IN ('queued','unresolved','acknowledged')), "delivery_id" text UNIQUE, "evidence_ref" text, "imported_at" text NOT NULL)
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cm_identity"."identity_single_use_proofs_email_code_lookup" ON "cm_identity"."identity_single_use_proofs" ("kind", "email", "digest_algorithm", "digest_key_ref", "secret_digest", "created_at", "proof_id")
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cm_identity"."identity_single_use_proofs_challenge_lookup" ON "cm_identity"."identity_single_use_proofs" ("challenge") WHERE "challenge" IS NOT NULL
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cm_identity"."identity_single_use_proofs_magic_lookup" ON "cm_identity"."identity_single_use_proofs" ("secret_digest") WHERE "kind" = 'magic_link'
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cm_identity"."identity_webauthn_credentials_user" ON "cm_identity"."identity_webauthn_credentials" ("user_id")
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cm_identity"."identity_single_use_proofs_user" ON "cm_identity"."identity_single_use_proofs" ("user_id") WHERE "user_id" IS NOT NULL
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cm_identity"."identity_login_token_bindings_session" ON "cm_identity"."identity_login_token_bindings" ("session_token_hash")
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cm_identity"."identity_social_links_user" ON "cm_identity"."identity_social_links" ("user_id")
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cm_identity"."identity_social_links_subject" ON "cm_identity"."identity_social_links" ("provider", "provider_subject")
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cm_identity"."identity_invitation_digests_email" ON "cm_identity"."identity_invitation_digests" ("email")
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cm_identity"."identity_deletion_attempts_operation" ON "cm_identity"."identity_deletion_attempts" ("operation_id", "at", "attempt_id")
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cm_identity"."identity_revocation_outbox_operation" ON "cm_identity"."identity_revocation_outbox" ("operation_id")
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cm_identity"."identity_revocation_outbox_pending" ON "cm_identity"."identity_revocation_outbox" ("state", "next_attempt_at", "created_at", "delivery_id")
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cm_identity"."identity_revocation_outbox_tuple" ON "cm_identity"."identity_revocation_outbox" ("operation_id", "step", "target_kind", "target_ref")
--> statement-breakpoint
-- Custody schema attestation (must match applyPostgresIdentityCustodySchemaV1: migration_id 'A2.0b/1', contract 1.1.0).
INSERT INTO "cm_identity"."identity_custody_schema_versions" ("migration_id","contract_version","asset_sha256","applied_at")
VALUES ('A2.0b/1','1.1.0','8f653f0e016d6a45178896d89d7fc4054b3e8161a081f2cc6720773f3ab42da1', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
ON CONFLICT ("migration_id") DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cm_identity".cm_tenants (
  tenant_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cm_identity".cm_tenant_memberships (
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  status TEXT NOT NULL,
  tenant_role TEXT NOT NULL,
  decided_by TEXT,
  decided_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, tenant_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cm_identity".cm_workspaces (
  workspace_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  repo_identity TEXT,
  aliases TEXT NOT NULL DEFAULT '[]',
  enrolled_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS cm_workspaces_repo_uidx
  ON "cm_identity".cm_workspaces (tenant_id, repo_identity) WHERE repo_identity IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cm_identity".cm_workspace_members (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cm_identity".cm_oauth_consents (
  consent_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  revoked_at TEXT
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cm_identity".cm_service_clients (
  client_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  bound_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cm_identity".cm_identity_conversation_sessions (
      conversation_session_id text PRIMARY KEY,
      user_id text NOT NULL,
      workspace_id text NOT NULL,
      status text NOT NULL,
      opened_at text NOT NULL,
      expires_at text NOT NULL,
      revoked_at text)
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cm_identity_conversation_sessions_user
      ON "cm_identity".cm_identity_conversation_sessions (user_id)
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cm_identity".cm_identity_audit_events (
      ordinal bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      at text NOT NULL,
      kind text NOT NULL,
      actor_id text,
      subject_id text,
      detail text)
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cm_identity".cm_identity_escalation_entries (
      ordinal bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      escalation_id text NOT NULL,
      owner_user_id text NOT NULL,
      workspace_id text NOT NULL,
      target_ref text NOT NULL,
      entry_json jsonb NOT NULL,
      prev_entry_hash text,
      entry_hash text NOT NULL)
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cm_identity_escalation_entries_escalation
      ON "cm_identity".cm_identity_escalation_entries (escalation_id)
--> statement-breakpoint
-- users -> identity_user_accounts (ids preserved)
--> statement-breakpoint
INSERT INTO "cm_identity"."identity_user_accounts" ("user_id","email","account_status","global_role","created_at","updated_at")
SELECT "id", COALESCE("email", 'legacy-' || "id" || '@invalid.local'), "account_status", "role", pg_temp.a4_iso("created_at"), COALESCE(pg_temp.a4_iso("updated_at"), pg_temp.a4_iso("created_at")) FROM public.users ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- users -> identity_account_profiles
--> statement-breakpoint
INSERT INTO "cm_identity"."identity_account_profiles" ("user_id","email_verified","display_name","approval_due_at","approved_at","approved_by_user_id","disabled_at","disabled_reason","legacy_account_status")
SELECT "id", CASE WHEN "email_verified" THEN 1 ELSE 0 END, "display_name", pg_temp.a4_iso("approval_due_at"), pg_temp.a4_iso("approved_at"), "approved_by_user_id", pg_temp.a4_iso("disabled_at"), "disabled_reason", "account_status" FROM public.users ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- users -> identity_subject_fences (revision 1)
--> statement-breakpoint
INSERT INTO "cm_identity"."identity_subject_fences" ("user_id","revision","updated_at","retired_at")
SELECT "id", 1, COALESCE(pg_temp.a4_iso("updated_at"), pg_temp.a4_iso("created_at")), NULL FROM public.users ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- webauthn_credentials -> identity_webauthn_credentials
--> statement-breakpoint
INSERT INTO "cm_identity"."identity_webauthn_credentials" ("proof_id","user_id","credential_id","public_key_cose","counter","revision","rp_id","device_name","transports_json","uv","device_type","backed_up","created_at","last_used_at","revoked_at")
SELECT "id","user_id","credential_id","public_key_cose", COALESCE("counter",0), 1, COALESCE(NULLIF(current_setting('app.webauthn_rp_id', true), ''), 'localhost'), "device_name","transports_json", CASE WHEN "uv" THEN 1 ELSE 0 END, NULL, NULL, pg_temp.a4_iso("created_at"), pg_temp.a4_iso("last_used_at"), NULL FROM public.webauthn_credentials ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- webauthn_challenges -> identity_single_use_proofs (webauthn_challenge)
--> statement-breakpoint
INSERT INTO "cm_identity"."identity_single_use_proofs" ("kind","proof_id","user_id","state","revision","created_at","expires_at","consumed_at","revoked_at","challenge","challenge_purpose","rp_id","allowed_origins_json","user_verification")
SELECT 'webauthn_challenge',"id","user_id", CASE WHEN "used" THEN 'consumed' ELSE 'pending' END, 1, pg_temp.a4_iso("created_at"), pg_temp.a4_iso("expires_at"), CASE WHEN "used" THEN pg_temp.a4_iso("created_at") ELSE NULL END, NULL, "challenge", "type", COALESCE(NULLIF(current_setting('app.webauthn_rp_id', true), ''), 'localhost'), NULL, NULL FROM public.webauthn_challenges ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- magic_links -> identity_single_use_proofs (magic_link)
--> statement-breakpoint
INSERT INTO "cm_identity"."identity_single_use_proofs" ("kind","proof_id","user_id","state","revision","created_at","expires_at","consumed_at","revoked_at","email","secret_digest","digest_algorithm","digest_key_ref")
SELECT 'magic_link',"id","user_id", CASE WHEN "used" THEN 'consumed' ELSE 'pending' END, 1, pg_temp.a4_iso("created_at"), pg_temp.a4_iso("expires_at"), CASE WHEN "used" THEN pg_temp.a4_iso("created_at") ELSE NULL END, NULL, "email", "token_hash", 'sha256', NULL FROM public.magic_links ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- email_verification_codes -> identity_single_use_proofs (email_code)
--> statement-breakpoint
INSERT INTO "cm_identity"."identity_single_use_proofs" ("kind","proof_id","user_id","state","revision","created_at","expires_at","consumed_at","revoked_at","email","secret_digest","digest_algorithm","digest_key_ref")
SELECT 'email_code',"id",NULL, CASE WHEN "used" THEN 'consumed' ELSE 'pending' END, 1, pg_temp.a4_iso("created_at"), pg_temp.a4_iso("expires_at"), CASE WHEN "used" THEN pg_temp.a4_iso("created_at") ELSE NULL END, NULL, "email", "code_hash", 'sha256', NULL FROM public.email_verification_codes ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- email_verification_codes.verification_token -> identity_email_registration_tickets (hashed)
--> statement-breakpoint
INSERT INTO "cm_identity"."identity_email_registration_tickets" ("code_kind","code_proof_id","email","token_hash","user_id","state","revision","created_at","expires_at","consumed_at","revoked_at")
SELECT 'email_code',"id","email", encode(sha256(convert_to("verification_token",'UTF8')),'hex'), NULL, CASE WHEN "used" THEN 'consumed' ELSE 'pending' END, 1, pg_temp.a4_iso("created_at"), pg_temp.a4_iso("expires_at"), CASE WHEN "used" THEN pg_temp.a4_iso("created_at") ELSE NULL END, NULL FROM public.email_verification_codes WHERE "verification_token" IS NOT NULL ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- auth_invite_tokens -> identity_invitation_digests
--> statement-breakpoint
INSERT INTO "cm_identity"."identity_invitation_digests" ("invitation_id","email","tenant_id","workspace_id","client_id","token_hash","status","expires_at","created_at","consumed_at","consumed_by_user_id","revision")
SELECT "id","email",NULL,NULL,"client_id","token_hash", CASE WHEN "consumed_at" IS NOT NULL THEN 'consumed' ELSE 'pending' END, pg_temp.a4_iso("expires_at"), pg_temp.a4_iso("created_at"), pg_temp.a4_iso("consumed_at"), "consumed_by_user_id", 1 FROM public.auth_invite_tokens ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- identities -> identity_social_links
--> statement-breakpoint
INSERT INTO "cm_identity"."identity_social_links" ("proof_id","user_id","provider","provider_subject","provider_tenant","email_at_link","email_verified_by_provider","linked_at","last_login_at","revoked_at","revision")
SELECT "id","user_id","provider","provider_subject","provider_tenant","email_at_link", CASE WHEN "email_verified_by_provider" THEN 1 ELSE 0 END, pg_temp.a4_iso("linked_at"), pg_temp.a4_iso("last_login_at"), NULL, 1 FROM public.identities ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- user_sessions -> identity_login_sessions
--> statement-breakpoint
INSERT INTO "cm_identity"."identity_login_sessions" ("session_id","user_id","status","mfa_state","created_at","expires_at","revoked_at","refresh_count")
SELECT "id","user_id", CASE WHEN "expires_at" <= now() THEN 'expired' ELSE 'active' END, CASE WHEN "mfa_verified" THEN 'step_up' ELSE 'none' END, pg_temp.a4_iso("created_at"), pg_temp.a4_iso("expires_at"), NULL, 0 FROM public.user_sessions ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- user_sessions -> identity_login_token_bindings
--> statement-breakpoint
INSERT INTO "cm_identity"."identity_login_token_bindings" ("session_id","session_token_hash","refresh_token_hash","mfa_verified","auth_time","session_version","rotation_version","device_name","ip_address","user_agent","last_activity_at")
SELECT "id","session_token_hash","refresh_token_hash", CASE WHEN "mfa_verified" THEN 1 ELSE 0 END, FLOOR(EXTRACT(EPOCH FROM "created_at" AT TIME ZONE 'UTC'))::bigint, FLOOR(EXTRACT(EPOCH FROM "created_at" AT TIME ZONE 'UTC') * 1000)::bigint, 1, "device_name","ip_address","user_agent", pg_temp.a4_iso("last_activity_at") FROM public.user_sessions ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- tenants -> cm_tenants (slug == tid == id)
--> statement-breakpoint
INSERT INTO "cm_identity"."cm_tenants" ("tenant_id","slug","status","created_at")
SELECT "id","id","status", pg_temp.a4_iso("created_at") FROM public.tenants ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- tenant_memberships -> cm_tenant_memberships
--> statement-breakpoint
INSERT INTO "cm_identity"."cm_tenant_memberships" ("user_id","tenant_id","status","tenant_role","decided_by","decided_at","updated_at")
SELECT "user_id","tenant_id","status","role","approved_by_user_id", pg_temp.a4_iso("decided_at"), COALESCE(pg_temp.a4_iso("updated_at"), pg_temp.a4_iso("created_at")) FROM public.tenant_memberships ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- workspaces (identity part) -> cm_workspaces (repo_identity NULL per owner Q-A; business cols stay in public.workspaces)
--> statement-breakpoint
INSERT INTO "cm_identity"."cm_workspaces" ("workspace_id","tenant_id","repo_identity","aliases","enrolled_at")
SELECT "id","tenant_id",NULL,'[]', pg_temp.a4_iso("created_at") FROM public.workspaces ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- workspace_memberships -> cm_workspace_members
--> statement-breakpoint
INSERT INTO "cm_identity"."cm_workspace_members" ("workspace_id","user_id","role")
SELECT "workspace_id","user_id","role" FROM public.workspace_memberships ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Rollback checkpoint recorded BEFORE any legacy table is deleted (r13 D11).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "control"."app_cm_identity_cutover" (
  "cutover_id" text PRIMARY KEY,
  "phase" text NOT NULL,
  "detail" jsonb NOT NULL,
  "recorded_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
INSERT INTO "control"."app_cm_identity_cutover" ("cutover_id","phase","detail")
SELECT 'a4-identity-cutover', 'pre-deletion-checkpoint', jsonb_build_object(
  'legacy_counts', jsonb_build_object(
    'users', (SELECT count(*) FROM public.users),
    'webauthn_credentials', (SELECT count(*) FROM public.webauthn_credentials),
    'user_sessions', (SELECT count(*) FROM public.user_sessions),
    'webauthn_challenges', (SELECT count(*) FROM public.webauthn_challenges),
    'magic_links', (SELECT count(*) FROM public.magic_links),
    'email_verification_codes', (SELECT count(*) FROM public.email_verification_codes),
    'auth_invite_tokens', (SELECT count(*) FROM public.auth_invite_tokens),
    'identities', (SELECT count(*) FROM public.identities),
    'tenants', (SELECT count(*) FROM public.tenants),
    'tenant_memberships', (SELECT count(*) FROM public.tenant_memberships),
    'workspaces', (SELECT count(*) FROM public.workspaces),
    'workspace_memberships', (SELECT count(*) FROM public.workspace_memberships)
  ),
  'cm_counts', jsonb_build_object(
    'identity_user_accounts', (SELECT count(*) FROM "cm_identity"."identity_user_accounts"),
    'identity_account_profiles', (SELECT count(*) FROM "cm_identity"."identity_account_profiles"),
    'identity_webauthn_credentials', (SELECT count(*) FROM "cm_identity"."identity_webauthn_credentials"),
    'identity_single_use_proofs', (SELECT count(*) FROM "cm_identity"."identity_single_use_proofs"),
    'identity_email_registration_tickets', (SELECT count(*) FROM "cm_identity"."identity_email_registration_tickets"),
    'identity_invitation_digests', (SELECT count(*) FROM "cm_identity"."identity_invitation_digests"),
    'identity_social_links', (SELECT count(*) FROM "cm_identity"."identity_social_links"),
    'identity_login_sessions', (SELECT count(*) FROM "cm_identity"."identity_login_sessions"),
    'identity_login_token_bindings', (SELECT count(*) FROM "cm_identity"."identity_login_token_bindings"),
    'cm_tenants', (SELECT count(*) FROM "cm_identity"."cm_tenants"),
    'cm_tenant_memberships', (SELECT count(*) FROM "cm_identity"."cm_tenant_memberships"),
    'cm_workspaces', (SELECT count(*) FROM "cm_identity"."cm_workspaces"),
    'cm_workspace_members', (SELECT count(*) FROM "cm_identity"."cm_workspace_members")
  ),
  'recorded_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
) ON CONFLICT ("cutover_id") DO NOTHING;
--> statement-breakpoint
-- Custody import receipt (A2.0b 1.1.0) keyed to the checkpoint manifest.
--> statement-breakpoint
INSERT INTO "cm_identity"."identity_import_receipts" ("migration_id","source_snapshot_ref","source_snapshot_digest","manifest_digest","contract_version","imported_at","receipt_json")
SELECT '0014_app_cm_identity_cutover', 'legacy-public-identity-tables@pre-deletion',
  encode(sha256(convert_to("detail"::text,'UTF8')),'hex'),
  encode(sha256(convert_to('0014_app_cm_identity_cutover' || "detail"::text,'UTF8')),'hex'),
  '1.1.0',
  to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  jsonb_build_object('contractVersion','1.1.0','migrationId','0014_app_cm_identity_cutover','identitiesPreserved',true,'verificationMaterialPreserved',true,'lifecyclePreserved',true,'counts', "detail"->'cm_counts')::text
FROM "control"."app_cm_identity_cutover" WHERE "cutover_id" = 'a4-identity-cutover'
ON CONFLICT ("migration_id") DO NOTHING;
--> statement-breakpoint
-- Drop every FK that references a legacy identity table (business tables keep their rows; the A2.3 cascade owns deletion now).
--> statement-breakpoint
DO $$
DECLARE r record; dropped jsonb := '[]'::jsonb;
BEGIN
  FOR r IN
    SELECT con.conname, con.conrelid::regclass AS tbl
    FROM pg_constraint con
    WHERE con.contype = 'f' AND con.confrelid IN (
      'public.users'::regclass, 'public.webauthn_credentials'::regclass, 'public.user_sessions'::regclass,
      'public.webauthn_challenges'::regclass, 'public.magic_links'::regclass, 'public.email_verification_codes'::regclass,
      'public.auth_invite_tokens'::regclass, 'public.identities'::regclass, 'public.tenants'::regclass,
      'public.tenant_memberships'::regclass, 'public.workspace_memberships'::regclass
    )
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.tbl, r.conname);
    dropped := dropped || jsonb_build_object('table', r.tbl::text, 'constraint', r.conname);
  END LOOP;
  INSERT INTO "control"."app_cm_identity_cutover" ("cutover_id","phase","detail")
  VALUES ('a4-identity-cutover-fk-drop','fk-drop', jsonb_build_object('dropped_foreign_keys', dropped))
  ON CONFLICT ("cutover_id") DO NOTHING;
END $$;
--> statement-breakpoint
-- 0013 refresh-token invalidation triggers/functions reference the legacy identity tables; the CM revocation outbox owns this now.
--> statement-breakpoint
DROP TRIGGER IF EXISTS oauth_refresh_client_guard ON public.oauth_clients;
DROP TRIGGER IF EXISTS oauth_refresh_client_invalidate ON public.oauth_clients;
DROP TRIGGER IF EXISTS oauth_refresh_consent_invalidate ON public.oauth_consents;
--> statement-breakpoint
DROP FUNCTION IF EXISTS public.oauth_refresh_client_guard(text, boolean);
DROP FUNCTION IF EXISTS public.oauth_refresh_client_statement_guard();
DROP FUNCTION IF EXISTS public.oauth_refresh_client_invalidate();
DROP FUNCTION IF EXISTS public.oauth_refresh_user_invalidate();
DROP FUNCTION IF EXISTS public.oauth_refresh_membership_invalidate();
DROP FUNCTION IF EXISTS public.oauth_refresh_consent_invalidate();
DROP FUNCTION IF EXISTS public.oauth_refresh_credential_invalidate();
DROP FUNCTION IF EXISTS public.oauth_refresh_revoke_user(text, text);
DROP FUNCTION IF EXISTS public.oauth_refresh_revoke_family(text, text, timestamp);
DROP FUNCTION IF EXISTS public.oauth_refresh_invalidate_restore();
--> statement-breakpoint
-- Legacy identity tables leave the app schema in this same lot (replacement gate).
--> statement-breakpoint
DROP TABLE IF EXISTS public.workspace_memberships;
DROP TABLE IF EXISTS public.tenant_memberships;
DROP TABLE IF EXISTS public.auth_invite_tokens;
DROP TABLE IF EXISTS public.identities;
DROP TABLE IF EXISTS public.magic_links;
DROP TABLE IF EXISTS public.email_verification_codes;
DROP TABLE IF EXISTS public.webauthn_challenges;
DROP TABLE IF EXISTS public.webauthn_credentials;
DROP TABLE IF EXISTS public.user_sessions;
DROP TABLE IF EXISTS public.tenants;
ALTER TABLE public.workspaces DROP COLUMN IF EXISTS "owner_user_id";
ALTER TABLE public.workspaces DROP COLUMN IF EXISTS "tenant_id";
DROP TABLE IF EXISTS public.users;
--> statement-breakpoint
-- Post-deletion attestation row (same transaction: rollback of this migration restores everything).
--> statement-breakpoint
INSERT INTO "control"."app_cm_identity_cutover" ("cutover_id","phase","detail")
VALUES ('a4-identity-cutover','post-deletion-attestation', jsonb_build_object('legacy_tables_dropped', true, 'recorded_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
ON CONFLICT ("cutover_id") DO UPDATE SET "phase" = 'post-deletion-attestation', "detail" = EXCLUDED."detail", "recorded_at" = now();
