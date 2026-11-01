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
