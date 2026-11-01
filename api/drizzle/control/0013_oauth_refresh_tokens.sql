-- Refresh credentials stay in public auth storage, separate from control identities.
CREATE TABLE public.oauth_refresh_tokens (
  id text PRIMARY KEY,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  family_id text NOT NULL REFERENCES public.oauth_refresh_tokens(id) ON DELETE CASCADE,
  parent_id text REFERENCES public.oauth_refresh_tokens(id) ON DELETE SET NULL,
  replaced_by_id text,
  generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0),
  client_id text NOT NULL REFERENCES public.oauth_clients(client_id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tenant_id text,
  scope text NOT NULL,
  offline_grant_id text NOT NULL,
  issuer text NOT NULL,
  audience text NOT NULL,
  resource text,
  dpop_jkt text,
  acr text NOT NULL,
  amr text[] NOT NULL,
  auth_time timestamp NOT NULL,
  session_id text,
  created_at timestamp NOT NULL DEFAULT now(),
  expires_at timestamp NOT NULL,
  family_expires_at timestamp NOT NULL,
  consumed_at timestamp,
  revoked_at timestamp,
  revoked_reason text,
  UNIQUE (family_id, generation),
  CHECK ((generation = 0 AND id = family_id AND parent_id IS NULL)
    OR (generation > 0 AND id <> family_id AND parent_id IS NOT NULL)),
  CHECK (expires_at <= family_expires_at)
);
--> statement-breakpoint
CREATE UNIQUE INDEX oauth_refresh_tokens_active_leaf ON public.oauth_refresh_tokens(family_id)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;
CREATE INDEX oauth_refresh_tokens_user_client ON public.oauth_refresh_tokens(user_id, client_id);
CREATE INDEX oauth_refresh_tokens_expires ON public.oauth_refresh_tokens(expires_at);
ALTER TABLE public.oauth_tokens ADD COLUMN refresh_family_id text;
CREATE INDEX oauth_tokens_refresh_family ON public.oauth_tokens(refresh_family_id);
ALTER TABLE public.oauth_consents
  ADD COLUMN offline_grant_id text,
  ADD COLUMN offline_issuer text,
  ADD COLUMN offline_scopes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN approved_resources text[] NOT NULL DEFAULT '{}',
  ADD COLUMN default_audience_approved boolean NOT NULL DEFAULT false,
  ADD COLUMN offline_consented_at timestamp;
--> statement-breakpoint
-- One deterministic mapping shared by all API replicas and SQL writers.
CREATE FUNCTION public.oauth_refresh_client_guard(p_client text, p_exclusive boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_exclusive THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('oauth-refresh-client:' || p_client, 0));
  ELSE
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('oauth-refresh-client:' || p_client, 0));
  END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.oauth_refresh_revoke_user(p_user text, p_reason text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE f text;
BEGIN
  PERFORM 1 FROM public.users WHERE id = p_user FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF; -- A parent-delete trigger already invalidated cascading rows.
  DELETE FROM public.authorization_codes WHERE user_id = p_user AND 'offline_access' = ANY(string_to_array(scope, ' '));
  FOR f IN SELECT id FROM public.oauth_refresh_tokens
    WHERE user_id = p_user AND generation = 0 ORDER BY id FOR UPDATE LOOP
    PERFORM public.oauth_refresh_revoke_family(f, p_reason, clock_timestamp()::timestamp);
  END LOOP;
  IF p_reason IN ('security_event', 'db_restore_invalidation') THEN
    UPDATE public.oauth_consents SET offline_grant_id = NULL, offline_issuer = NULL,
      offline_scopes = '{}', approved_resources = '{}', default_audience_approved = false,
      offline_consented_at = NULL WHERE user_id = p_user AND offline_grant_id IS NOT NULL;
  END IF;
END $$;
--> statement-breakpoint
-- Statement guard precedes tuple locking (a row trigger alone can deadlock on FK checks).
CREATE FUNCTION public.oauth_refresh_client_statement_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c text;
BEGIN
  FOR c IN SELECT client_id FROM public.oauth_clients ORDER BY client_id LOOP
    PERFORM public.oauth_refresh_client_guard(c, true);
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER oauth_refresh_client_guard BEFORE UPDATE OR DELETE ON public.oauth_clients
  FOR EACH STATEMENT EXECUTE FUNCTION public.oauth_refresh_client_statement_guard();
--> statement-breakpoint
CREATE FUNCTION public.oauth_refresh_client_invalidate()
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
    PERFORM 1 FROM public.users WHERE id = u FOR UPDATE;
  END LOOP;
  DELETE FROM public.authorization_codes WHERE client_id = OLD.client_id AND 'offline_access' = ANY(string_to_array(scope, ' '));
  PERFORM public.oauth_refresh_revoke_family(id, 'policy_denied', clock_timestamp()::timestamp)
    FROM public.oauth_refresh_tokens WHERE client_id = OLD.client_id AND generation = 0 ORDER BY id;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER oauth_refresh_client_invalidate BEFORE UPDATE OR DELETE ON public.oauth_clients
  FOR EACH ROW EXECUTE FUNCTION public.oauth_refresh_client_invalidate();
--> statement-breakpoint
CREATE FUNCTION public.oauth_refresh_user_invalidate()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.oauth_refresh_revoke_user(OLD.id, 'security_event');
    RETURN OLD;
  END IF;
  IF NEW.account_status IS DISTINCT FROM OLD.account_status
    OR (OLD.email_verified AND NOT NEW.email_verified)
    OR to_jsonb(NEW)->'security_generation' IS DISTINCT FROM to_jsonb(OLD)->'security_generation'
    OR to_jsonb(NEW)->'auth_security_generation' IS DISTINCT FROM to_jsonb(OLD)->'auth_security_generation'
    THEN PERFORM public.oauth_refresh_revoke_user(OLD.id, 'security_event'); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER oauth_refresh_user_invalidate BEFORE UPDATE OR DELETE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.oauth_refresh_user_invalidate();
--> statement-breakpoint
CREATE FUNCTION public.oauth_refresh_membership_invalidate()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.oauth_refresh_revoke_user(OLD.user_id, 'policy_denied');
    RETURN OLD;
  END IF;
  IF OLD.status = 'approved' AND (NEW.status <> 'approved' OR NEW.tenant_id <> OLD.tenant_id OR NEW.user_id <> OLD.user_id)
    THEN PERFORM public.oauth_refresh_revoke_user(OLD.user_id, 'policy_denied'); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER oauth_refresh_membership_invalidate BEFORE UPDATE OR DELETE ON public.tenant_memberships
  FOR EACH ROW EXECUTE FUNCTION public.oauth_refresh_membership_invalidate();
--> statement-breakpoint
CREATE FUNCTION public.oauth_refresh_consent_invalidate()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.oauth_clients WHERE client_id = OLD.client_id)
    OR NOT EXISTS (SELECT 1 FROM public.users WHERE id = OLD.user_id) THEN
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
  PERFORM 1 FROM public.users WHERE id = OLD.user_id FOR UPDATE;
  PERFORM public.oauth_refresh_revoke_family(id, 'consent_revoked', clock_timestamp()::timestamp)
    FROM public.oauth_refresh_tokens WHERE user_id = OLD.user_id AND client_id = OLD.client_id
      AND coalesce(tenant_id, 'sentropic') = OLD.tenant_id AND generation = 0 ORDER BY id;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER oauth_refresh_consent_invalidate BEFORE UPDATE OR DELETE ON public.oauth_consents
  FOR EACH ROW EXECUTE FUNCTION public.oauth_refresh_consent_invalidate();
--> statement-breakpoint
-- Removing/replacing an enrolled credential is an authorized security event.
-- Signature counters and last-used telemetry do not change offline authority.
CREATE FUNCTION public.oauth_refresh_credential_invalidate()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.oauth_refresh_revoke_user(OLD.user_id, 'security_event');
    RETURN OLD;
  END IF;
  IF NEW.public_key_cose IS DISTINCT FROM OLD.public_key_cose OR NEW.user_id <> OLD.user_id
    THEN PERFORM public.oauth_refresh_revoke_user(OLD.user_id, 'security_event'); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER oauth_refresh_credential_invalidate BEFORE UPDATE OR DELETE ON public.webauthn_credentials
  FOR EACH ROW EXECUTE FUNCTION public.oauth_refresh_credential_invalidate();
--> statement-breakpoint
CREATE FUNCTION public.oauth_refresh_invalidate_restore()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE c text; u text;
BEGIN
  FOR c IN SELECT client_id FROM public.oauth_clients ORDER BY client_id LOOP
    PERFORM public.oauth_refresh_client_guard(c, true);
  END LOOP;
  FOR u IN SELECT id FROM public.users ORDER BY id FOR UPDATE LOOP
    PERFORM public.oauth_refresh_revoke_user(u, 'db_restore_invalidation');
  END LOOP;
  DELETE FROM public.oauth_tokens;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.oauth_refresh_revoke_family(p_family text, p_reason text, p_now timestamp)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM public.oauth_refresh_tokens WHERE id = p_family FOR UPDATE;
  UPDATE public.oauth_refresh_tokens SET revoked_at = COALESCE(revoked_at, p_now),
    revoked_reason = COALESCE(revoked_reason, p_reason) WHERE family_id = p_family;
  INSERT INTO public.revoked_tokens (jti, client_id, user_id, tenant_id, expires_at, revoked_at)
    SELECT jti, client_id, user_id, tenant_id, expires_at, p_now
    FROM public.oauth_tokens WHERE refresh_family_id = p_family AND expires_at > p_now
    ON CONFLICT (jti) DO NOTHING;
END $$;
