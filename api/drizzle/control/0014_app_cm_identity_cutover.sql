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
