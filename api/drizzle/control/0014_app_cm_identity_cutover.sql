-- Lot A4: app identity cutover to the cluster-mesh cm_identity stores (r13 D11 replacement gate).
-- The migration runner must apply the qualified CM asset/import and record D11 first.
DO $$
DECLARE checkpoint jsonb; imported jsonb;
BEGIN
  IF current_setting('app.a4_import_manifest_digest', true) IS NULL THEN
    RAISE EXCEPTION 'A4 bound import checkpoint required';
  END IF;
  SELECT detail INTO checkpoint FROM control.app_cm_identity_cutover
    WHERE cutover_id = 'a4-identity-cutover' AND phase = 'pre-deletion-checkpoint';
  SELECT receipt_json::jsonb INTO imported FROM cm_identity.identity_import_receipts
    WHERE migration_id = '0014_app_cm_identity_cutover';
  IF checkpoint IS NULL OR imported IS NULL
    OR checkpoint->>'sourceSnapshotDigest' IS DISTINCT FROM imported->>'sourceSnapshotDigest'
    OR current_setting('app.a4_import_manifest_digest', true) IS DISTINCT FROM imported->>'manifestDigest'
    OR imported->>'verificationMaterialPreserved' IS DISTINCT FROM 'true'
    OR imported->>'identitiesPreserved' IS DISTINCT FROM 'true'
    OR imported->>'lifecyclePreserved' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'A4 bound import checkpoint required';
  END IF;
END $$;
--> statement-breakpoint
-- ONE control migration, ONE transaction: CM schema + id-preserving data copy + rollback checkpoint
-- (recorded BEFORE any legacy table is deleted) + legacy identity table deletion.
-- Timestamps are ISO-8601 text in cm_identity; legacy timestamp columns are read as UTC.
-- The WebAuthn RP ID is taken from the app.webauthn_rp_id GUC set by the API before migrations
-- (falls back to 'localhost').
CREATE OR REPLACE FUNCTION pg_temp.a4_iso(ts timestamp) RETURNS text LANGUAGE sql IMMUTABLE
AS $$ SELECT to_char(ts, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;
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
-- OAuth refresh rows remain app-owned. Rebind their invalidation to CM identity
-- while preserving client policy, consent, linked-JTI and restore protections.
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.oauth_refresh_revoke_user(p_user text, p_reason text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE f text;
BEGIN
  PERFORM 1 FROM cm_identity.identity_user_accounts WHERE user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  DELETE FROM public.authorization_codes WHERE user_id = p_user AND 'offline_access' = ANY(string_to_array(scope, ' '));
  FOR f IN SELECT id FROM public.oauth_refresh_tokens
    WHERE user_id = p_user AND generation = 0 ORDER BY id FOR UPDATE LOOP
    PERFORM public.oauth_refresh_revoke_family(f, p_reason, clock_timestamp() AT TIME ZONE 'UTC');
  END LOOP;
  IF p_reason IN ('security_event', 'db_restore_invalidation') THEN
    UPDATE public.oauth_consents SET offline_grant_id = NULL, offline_issuer = NULL,
      offline_scopes = '{}', approved_resources = '{}', default_audience_approved = false,
      offline_consented_at = NULL WHERE user_id = p_user AND offline_grant_id IS NOT NULL;
  END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.oauth_refresh_user_invalidate()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.oauth_refresh_revoke_user(OLD.user_id, 'security_event');
    RETURN OLD;
  END IF;
  IF NEW.account_status IS DISTINCT FROM OLD.account_status THEN
    PERFORM public.oauth_refresh_revoke_user(OLD.user_id, 'security_event');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER oauth_refresh_user_invalidate BEFORE UPDATE OR DELETE ON cm_identity.identity_user_accounts
  FOR EACH ROW EXECUTE FUNCTION public.oauth_refresh_user_invalidate();
--> statement-breakpoint
CREATE FUNCTION public.oauth_refresh_profile_invalidate()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.email_verified IS DISTINCT FROM OLD.email_verified
    OR NEW.disabled_at IS DISTINCT FROM OLD.disabled_at
    OR NEW.legacy_account_status IS DISTINCT FROM OLD.legacy_account_status THEN
    PERFORM public.oauth_refresh_revoke_user(OLD.user_id, 'security_event');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER oauth_refresh_profile_invalidate BEFORE UPDATE ON cm_identity.identity_account_profiles
  FOR EACH ROW EXECUTE FUNCTION public.oauth_refresh_profile_invalidate();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.oauth_refresh_client_invalidate()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE u text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.allowed_scopes @> OLD.allowed_scopes AND NEW.resource_indicators @> OLD.resource_indicators
      AND NEW.grant_types @> OLD.grant_types AND NEW.required_acr IS NOT DISTINCT FROM OLD.required_acr
      AND NEW.allowed_user_ids IS NOT DISTINCT FROM OLD.allowed_user_ids
      AND NEW.dpop_bound_access_tokens IS NOT DISTINCT FROM OLD.dpop_bound_access_tokens
      AND NEW.token_endpoint_auth_method IS NOT DISTINCT FROM OLD.token_endpoint_auth_method
      THEN RETURN NEW; END IF;
  END IF;
  FOR u IN SELECT user_id FROM public.oauth_refresh_tokens WHERE client_id = OLD.client_id
    UNION SELECT user_id FROM public.authorization_codes WHERE client_id = OLD.client_id ORDER BY user_id LOOP
    PERFORM 1 FROM cm_identity.identity_user_accounts WHERE user_id = u FOR UPDATE;
  END LOOP;
  DELETE FROM public.authorization_codes WHERE client_id = OLD.client_id AND 'offline_access' = ANY(string_to_array(scope, ' '));
  PERFORM public.oauth_refresh_revoke_family(id, 'policy_denied', clock_timestamp() AT TIME ZONE 'UTC')
    FROM public.oauth_refresh_tokens WHERE client_id = OLD.client_id AND generation = 0 ORDER BY id;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.oauth_refresh_consent_invalidate()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.oauth_clients WHERE client_id = OLD.client_id)
    OR NOT EXISTS (SELECT 1 FROM cm_identity.identity_user_accounts WHERE user_id = OLD.user_id) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.scopes @> OLD.scopes AND NEW.offline_scopes @> OLD.offline_scopes
      AND NEW.approved_resources @> OLD.approved_resources
      AND NEW.offline_grant_id IS NOT DISTINCT FROM OLD.offline_grant_id
      AND NEW.offline_issuer IS NOT DISTINCT FROM OLD.offline_issuer
      AND NEW.offline_consented_at IS NOT DISTINCT FROM OLD.offline_consented_at
      AND (NEW.default_audience_approved OR NOT OLD.default_audience_approved)
      THEN RETURN NEW; END IF;
  END IF;
  PERFORM 1 FROM cm_identity.identity_user_accounts WHERE user_id = OLD.user_id FOR UPDATE;
  PERFORM public.oauth_refresh_revoke_family(id, 'consent_revoked', clock_timestamp() AT TIME ZONE 'UTC')
    FROM public.oauth_refresh_tokens WHERE user_id = OLD.user_id AND client_id = OLD.client_id
      AND coalesce(tenant_id, 'sentropic') = OLD.tenant_id AND generation = 0 ORDER BY id;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER oauth_refresh_membership_invalidate BEFORE UPDATE OR DELETE ON cm_identity.cm_tenant_memberships
  FOR EACH ROW EXECUTE FUNCTION public.oauth_refresh_membership_invalidate();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.oauth_refresh_credential_invalidate()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.oauth_refresh_revoke_user(OLD.user_id, 'security_event');
    RETURN OLD;
  END IF;
  IF NEW.public_key_cose IS DISTINCT FROM OLD.public_key_cose OR NEW.user_id <> OLD.user_id
    OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    PERFORM public.oauth_refresh_revoke_user(OLD.user_id, 'security_event');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER oauth_refresh_credential_invalidate BEFORE UPDATE OR DELETE ON cm_identity.identity_webauthn_credentials
  FOR EACH ROW EXECUTE FUNCTION public.oauth_refresh_credential_invalidate();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.oauth_refresh_invalidate_restore()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE c text; u text;
BEGIN
  FOR c IN SELECT client_id FROM public.oauth_clients ORDER BY client_id LOOP
    PERFORM public.oauth_refresh_client_guard(c, true);
  END LOOP;
  FOR u IN SELECT user_id FROM cm_identity.identity_user_accounts ORDER BY user_id FOR UPDATE LOOP
    PERFORM public.oauth_refresh_revoke_user(u, 'db_restore_invalidation');
  END LOOP;
  DELETE FROM public.oauth_tokens;
END $$;
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
VALUES ('a4-identity-cutover-completed','post-deletion-attestation', jsonb_build_object('legacy_tables_dropped', true, 'recorded_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
