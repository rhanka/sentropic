-- Version: cutover-applicability-v1
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL TIME ZONE 'UTC';

SELECT CASE
  WHEN EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'public.users', 'public.webauthn_credentials', 'public.webauthn_challenges',
      'public.email_verification_codes', 'public.magic_links', 'public.auth_invite_tokens',
      'public.user_sessions', 'public.identities', 'public.tenants', 'public.tenant_memberships',
      'public.workspaces', 'public.workspace_memberships', 'public.oauth_consents',
      'public.service_clients', 'public.oauth_clients', 'public.oauth_refresh_tokens',
      'public.authorization_codes', 'public.settings', 'public.federation_flow_states'
    ]) AS req
    WHERE to_regclass(req) IS NULL
  ) THEN $err$
    SELECT jsonb_build_object(
      'version', 'cutover-applicability-v1',
      'ok', false,
      'missing_required_relations', (
        SELECT jsonb_agg(req ORDER BY req COLLATE "C")
        FROM unnest(ARRAY[
          'public.users', 'public.webauthn_credentials', 'public.webauthn_challenges',
          'public.email_verification_codes', 'public.magic_links', 'public.auth_invite_tokens',
          'public.user_sessions', 'public.identities', 'public.tenants', 'public.tenant_memberships',
          'public.workspaces', 'public.workspace_memberships', 'public.oauth_consents',
          'public.service_clients', 'public.oauth_clients', 'public.oauth_refresh_tokens',
          'public.authorization_codes', 'public.settings', 'public.federation_flow_states'
        ]) AS req
        WHERE to_regclass(req) IS NULL
      )
    )::text;
  $err$
  ELSE format($sql$
    WITH payload AS (
      SELECT jsonb_build_object(
        'version', 'cutover-applicability-v1',
        'durable_identity_sources', jsonb_build_object(
          'users', (SELECT coalesce(jsonb_agg(to_jsonb(u) ORDER BY u.id COLLATE "C"), '[]'::jsonb) FROM public.users u),
          'webauthn_credentials', (SELECT coalesce(jsonb_agg(to_jsonb(wc) ORDER BY wc.id COLLATE "C"), '[]'::jsonb) FROM public.webauthn_credentials wc),
          'auth_invite_tokens', (SELECT coalesce(jsonb_agg(to_jsonb(ait) ORDER BY ait.id COLLATE "C"), '[]'::jsonb) FROM public.auth_invite_tokens ait),
          'identities', (
            SELECT coalesce(jsonb_agg(
              (to_jsonb(i) - 'token_secret') || jsonb_build_object(
                'token_secret_sha256',
                CASE WHEN i.token_secret IS NULL THEN NULL ELSE encode(sha256(convert_to(i.token_secret, 'UTF8')), 'hex') END
              ) ORDER BY i.id COLLATE "C"
            ), '[]'::jsonb) FROM public.identities i
          ),
          'tenants', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id COLLATE "C"), '[]'::jsonb) FROM public.tenants t),
          'tenant_memberships', (SELECT coalesce(jsonb_agg(to_jsonb(tm) ORDER BY tm.tenant_id COLLATE "C", tm.user_id COLLATE "C"), '[]'::jsonb) FROM public.tenant_memberships tm),
          'workspaces', (SELECT coalesce(jsonb_agg(to_jsonb(w) ORDER BY w.id COLLATE "C"), '[]'::jsonb) FROM public.workspaces w),
          'workspace_memberships', (SELECT coalesce(jsonb_agg(to_jsonb(wm) ORDER BY wm.workspace_id COLLATE "C", wm.user_id COLLATE "C"), '[]'::jsonb) FROM public.workspace_memberships wm),
          'oauth_consents', (SELECT coalesce(jsonb_agg(to_jsonb(oc) ORDER BY oc.user_id COLLATE "C", oc.client_id COLLATE "C", oc.tenant_id COLLATE "C"), '[]'::jsonb) FROM public.oauth_consents oc),
          'service_clients', (
            SELECT coalesce(jsonb_agg(
              (to_jsonb(sc) - 'client_secret_hash') || jsonb_build_object(
                'client_secret_hash_sha256', encode(sha256(convert_to(sc.client_secret_hash, 'UTF8')), 'hex')
              ) ORDER BY sc.id COLLATE "C"
            ), '[]'::jsonb) FROM public.service_clients sc
          )
        ),
        'oauth_durable', jsonb_build_object(
          'oauth_clients', (
            SELECT coalesce(jsonb_agg(
              (to_jsonb(c) - 'client_secret_hash') || jsonb_build_object(
                'client_secret_hash_sha256',
                CASE WHEN c.client_secret_hash IS NULL THEN NULL ELSE encode(sha256(convert_to(c.client_secret_hash, 'UTF8')), 'hex') END
              ) ORDER BY c.client_id COLLATE "C"
            ), '[]'::jsonb) FROM public.oauth_clients c
          ),
          'oauth_refresh_tokens', (
            SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id COLLATE "C"), '[]'::jsonb)
            FROM public.oauth_refresh_tokens r
          ),
          'offline_authorization_codes', (
            SELECT coalesce(jsonb_agg(
              (to_jsonb(ac) - 'code' - 'code_challenge' - 'payload') || jsonb_build_object(
                'code_sha256', encode(sha256(convert_to(ac.code, 'UTF8')), 'hex'),
                'payload_sha256', encode(sha256(convert_to(ac.payload::text, 'UTF8')), 'hex')
              ) ORDER BY encode(sha256(convert_to(ac.code, 'UTF8')), 'hex') COLLATE "C"
            ), '[]'::jsonb)
            FROM public.authorization_codes ac
            WHERE 'offline_access' = ANY(string_to_array(ac.scope, ' '))
          )
        ),
        'connector_sources', jsonb_build_object(
          'event_outbox_connector_grants', %s,
          'document_connector_accounts', %s
        ),
        'remote_revocation_settings', jsonb_build_object(
          'intents', (
            SELECT coalesce(jsonb_agg(
              jsonb_build_object(
                'row_id', s.key || coalesce('@' || s.user_id, ''),
                'key', s.key,
                'user_id', s.user_id,
                'value_sha256', CASE WHEN s.value IS NULL THEN NULL ELSE encode(sha256(convert_to(s.value, 'UTF8')), 'hex') END,
                'updated_at', s.updated_at
              ) ORDER BY s.key COLLATE "C"
            ), '[]'::jsonb)
            FROM public.settings s
            WHERE s.key LIKE 'remote_session_revocation:%%' AND s.user_id IS NULL
          ),
          'user_scoped_counts', (
            SELECT coalesce(jsonb_agg(
              jsonb_build_object('user_id', s.user_id, 'row_count', s.cnt) ORDER BY s.user_id COLLATE "C"
            ), '[]'::jsonb)
            FROM (
              SELECT user_id, count(*)::int AS cnt FROM public.settings
              WHERE user_id IS NOT NULL GROUP BY user_id
            ) s
          )
        ),
