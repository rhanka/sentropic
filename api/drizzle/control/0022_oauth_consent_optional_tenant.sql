-- A1 (prod A4 prerequisite): an OAuth consent is keyed by (user, client) with an OPTIONAL tenant.
-- A tenant-optional client (`require_tenant = false`) keeps a tenant-less consent (tenant_id NULL, no
-- `tid`) for a user with no approved membership; every other client keeps requiring one. Tenant-keyed
-- rows keep their key; a pre-0022 grant that only a tenant default keyed moves to the tenant-less key
-- with its offline evidence (A1-REKEY below), so no consent is lost.
ALTER TABLE public.oauth_clients ADD COLUMN IF NOT EXISTS require_tenant boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE public.oauth_consents ALTER COLUMN tenant_id DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE public.oauth_consents ALTER COLUMN tenant_id DROP NOT NULL;
--> statement-breakpoint
-- Same key name and columns; NULLS NOT DISTINCT keeps one tenant-less row per (user, client).
DROP INDEX IF EXISTS public.oauth_consents_user_id_client_id_tenant_id_unique;
--> statement-breakpoint
CREATE UNIQUE INDEX oauth_consents_user_id_client_id_tenant_id_unique
  ON public.oauth_consents (user_id, client_id, tenant_id) NULLS NOT DISTINCT;
--> statement-breakpoint
-- A consent change revokes the families of its own key, the tenant-less key included. The 0013/0015
-- `coalesce(tenant_id, 'sentropic')` association of NULL-tenant families is replaced by the exact key:
-- A1-REKEY re-associates those families with their tenant-less consent in this same migration.
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
      AND tenant_id IS NOT DISTINCT FROM OLD.tenant_id AND generation = 0 ORDER BY id;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Making a client tenant-bound, or re-homing it to another tenant, narrows its policy: its refresh
-- families are revoked (tenant-keyed families included).
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
      AND (OLD.require_tenant OR NOT NEW.require_tenant) AND NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id
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
-- Clients whose users are not sentropic tenant members (Q3-A: one approval realm per app): the
-- claude.ai immo-mcp connector, the immo RP (prod and preprod ids) and the free-auth design system.
-- Tenant-bound (unchanged): sentropic-mcp, h2a-cli and every other or future client (default true).
UPDATE public.oauth_clients SET require_tenant = false
  WHERE client_id IN ('immo-mcp', 'radar-immobilier', 'radar-immobilier-preprod', 'design-system');
--> statement-breakpoint
-- A1-REKEY: a tenant-keyed grant of a tenant-optional client, whose user has no approved membership
-- in that tenant and whose CM authority is live, moves to the tenant-less key: same row, scopes and
-- offline evidence (its NULL-tenant refresh families match it again), CM authority re-issued under the
-- tenant-less id with the same grant time, and the tenant-keyed CM authority revoked. A revoked or
-- missing authority is never resurrected; an existing tenant-less grant is kept as is.
DO $$
DECLARE r record;
  stamp text := to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
  -- No CM authority tables (artifact host slot or pre-cutover database): no CM
  -- authority exists, so no grant can move; the rekey is a proven no-op here.
  IF to_regclass('cm_identity.cm_tenants') IS NULL
    OR to_regclass('cm_identity.cm_tenant_memberships') IS NULL
    OR to_regclass('cm_identity.cm_oauth_consents') IS NULL THEN
    RETURN;
  END IF;
  FOR r IN
    SELECT DISTINCT ON (c.user_id, c.client_id) c.user_id, c.client_id, c.tenant_id AS tid,
      cg.consent_id, cg.granted_at, gov.tenant_id AS governing
    FROM public.oauth_consents c
    JOIN public.oauth_clients k ON k.client_id = c.client_id AND NOT k.require_tenant
    JOIN cm_identity.cm_tenants gov ON gov.slug = k.tenant_id AND gov.status = 'active'
    JOIN cm_identity.cm_tenants t ON t.slug = c.tenant_id
    JOIN cm_identity.cm_oauth_consents cg ON cg.revoked_at IS NULL AND cg.consent_id = encode(sha256(convert_to(
      '["app-oauth-consent",' || to_json(c.user_id)::text || ',' || to_json(c.client_id)::text || ','
      || to_json(t.tenant_id)::text || ']', 'UTF8')), 'hex')
    WHERE c.tenant_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM cm_identity.cm_tenant_memberships m
        WHERE m.user_id = c.user_id AND m.tenant_id = t.tenant_id AND m.status = 'approved')
      AND NOT EXISTS (SELECT 1 FROM public.oauth_consents n
        WHERE n.user_id = c.user_id AND n.client_id = c.client_id AND n.tenant_id IS NULL)
    ORDER BY c.user_id, c.client_id, c.updated_at DESC
  LOOP
    UPDATE public.oauth_consents SET tenant_id = NULL
      WHERE user_id = r.user_id AND client_id = r.client_id AND tenant_id = r.tid;
    INSERT INTO cm_identity.cm_oauth_consents (consent_id, tenant_id, user_id, client_id, granted_at, revoked_at)
      VALUES (encode(sha256(convert_to('["app-oauth-consent",' || to_json(r.user_id)::text || ','
        || to_json(r.client_id)::text || ',null]', 'UTF8')), 'hex'), r.governing, r.user_id, r.client_id, r.granted_at, NULL)
      ON CONFLICT (consent_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, granted_at = EXCLUDED.granted_at,
        revoked_at = NULL;
    UPDATE cm_identity.cm_oauth_consents SET revoked_at = stamp WHERE consent_id = r.consent_id;
  END LOOP;
END $$;
