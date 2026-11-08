-- A1 (prod A4 prerequisite): an OAuth consent is keyed by (user, client) with an OPTIONAL tenant.
-- A tenant-optional client (`require_tenant = false`) keeps a tenant-less consent (tenant_id NULL, no
-- `tid`) for a user with no approved membership; every other client keeps requiring one. Existing
-- tenant-keyed rows keep their exact key: no consent is rewritten or lost.
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
-- A consent change revokes the families of its own key, the tenant-less key included.
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
-- Making a client tenant-bound is a policy narrowing: its refresh families are revoked.
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
      AND (OLD.require_tenant OR NOT NEW.require_tenant)
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
-- The claude.ai immo-mcp connector serves immo users who are not sentropic tenant members (Q3-A).
UPDATE public.oauth_clients SET require_tenant = false WHERE client_id = 'immo-mcp';
