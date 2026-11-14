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
        'pre_cutover_guards', jsonb_build_object(
          'cm_identity_schema_present', EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cm_identity'),
          'cm_identity_invitations', %s,
          'cm_identity_import_receipts', %s,
          'app_cm_identity_cutover', %s,
          'live_federation_flow_states', (SELECT count(*)::int FROM public.federation_flow_states WHERE expires_at > now()),
          'non_null_identity_token_secrets', (SELECT count(*)::int FROM public.identities WHERE token_secret IS NOT NULL),
          'legacy_foreign_keys', (
            SELECT coalesce(jsonb_agg(fk_row ORDER BY child_schema COLLATE "C", child_table COLLATE "C", name COLLATE "C"), '[]'::jsonb)
            FROM (
              SELECT ns.nspname AS child_schema, child.relname AS child_table, c.conname AS name,
                parent.relname AS parent, c.confdeltype AS on_delete, c.confupdtype AS on_update,
                c.condeferrable AS deferrable, c.condeferred AS deferred, c.confmatchtype AS match,
                (SELECT json_agg(a.attname ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(num, ord)
                  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.num) AS child_columns,
                (SELECT json_agg(a.attname ORDER BY k.ord) FROM unnest(c.confkey) WITH ORDINALITY k(num, ord)
                  JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.num) AS parent_columns
              FROM pg_constraint c
              JOIN pg_class child ON child.oid = c.conrelid
              JOIN pg_namespace ns ON ns.oid = child.relnamespace
              JOIN pg_class parent ON parent.oid = c.confrelid
              JOIN pg_namespace pn ON pn.oid = parent.relnamespace
              WHERE c.contype = 'f' AND pn.nspname = 'public'
                AND parent.relname = ANY(ARRAY[
                  'users', 'webauthn_credentials', 'webauthn_challenges', 'email_verification_codes',
                  'magic_links', 'auth_invite_tokens', 'user_sessions', 'identities',
                  'tenants', 'tenant_memberships', 'workspace_memberships'
                ])
            ) fk_row
          )
        )
      ) AS applicability_doc,
      jsonb_build_object(
        'settings_enc', (
          SELECT coalesce(jsonb_agg(
            jsonb_build_object(
              'id', s.key || coalesce('@' || s.user_id, ''),
              'value_sha256', encode(sha256(convert_to(s.value, 'UTF8')), 'hex')
            ) ORDER BY (s.key || coalesce('@' || s.user_id, '')) COLLATE "C"
          ), '[]'::jsonb)
          FROM public.settings s WHERE s.value LIKE 'enc:%%'
        ),
        'document_connector_accounts_enc', %s,
        'llm_provider_accounts_enc', %s,
        'connector_revocation_custody_enc', %s
      ) AS encrypted_stores_doc
    )
    SELECT jsonb_build_object(
      'version', 'cutover-applicability-v1',
      'ok', true,
      'durableCutoverApplicabilitySha256', encode(sha256(convert_to(applicability_doc::text, 'UTF8')), 'hex'),
      'encryptedStoresSha256', encode(sha256(convert_to(encrypted_stores_doc::text, 'UTF8')), 'hex'),
      'encryptedStoreFingerprints', (SELECT jsonb_object_agg(key,
        encode(sha256(convert_to(value::text,'UTF8')),'hex')) FROM jsonb_each(encrypted_stores_doc)),
      'guards', (applicability_doc->'pre_cutover_guards') - 'legacy_foreign_keys'
    )::text
    FROM payload;
  $sql$,
  CASE WHEN to_regclass('control.event_outbox') IS NOT NULL THEN $sub$(
    SELECT jsonb_build_object('present', true, 'rows', coalesce(jsonb_agg(
      jsonb_build_object('id', eo.id, 'channel', eo.channel, 'envelope', eo.envelope, 'status', eo.status, 'created_at', eo.created_at)
      ORDER BY eo.id COLLATE "C"
    ), '[]'::jsonb))
    FROM control.event_outbox eo WHERE eo.channel = 'connector_grant_events'
  )$sub$ ELSE $sub$'{"present":false,"rows":[]}'::jsonb$sub$ END,
  CASE WHEN to_regclass('public.document_connector_accounts') IS NOT NULL THEN $sub$(
    SELECT jsonb_build_object('present', true, 'rows', coalesce(jsonb_agg(
      (to_jsonb(dca) - 'token_secret') || jsonb_build_object(
        'token_secret_sha256', CASE WHEN dca.token_secret IS NULL THEN NULL ELSE encode(sha256(convert_to(dca.token_secret, 'UTF8')), 'hex') END
      ) ORDER BY dca.id COLLATE "C"
    ), '[]'::jsonb))
    FROM public.document_connector_accounts dca
  )$sub$ ELSE $sub$'{"present":false,"rows":[]}'::jsonb$sub$ END,
  CASE WHEN to_regclass('cm_identity.identity_invitations') IS NOT NULL THEN $sub$(
    SELECT jsonb_build_object('present', true, 'row_count', count(*)::int) FROM cm_identity.identity_invitations
  )$sub$ ELSE $sub$'{"present":false,"row_count":0}'::jsonb$sub$ END,
  CASE WHEN to_regclass('cm_identity.identity_import_receipts') IS NOT NULL THEN $sub$(
    SELECT jsonb_build_object('present', true, 'row_count', count(*)::int) FROM cm_identity.identity_import_receipts
  )$sub$ ELSE $sub$'{"present":false,"row_count":0}'::jsonb$sub$ END,
  CASE WHEN to_regclass('control.app_cm_identity_cutover') IS NOT NULL THEN $sub$(
    SELECT jsonb_build_object('present', true, 'row_count', count(*)::int) FROM control.app_cm_identity_cutover
  )$sub$ ELSE $sub$'{"present":false,"row_count":0}'::jsonb$sub$ END,
  CASE WHEN to_regclass('public.document_connector_accounts') IS NOT NULL THEN $sub$(
    SELECT jsonb_build_object('present', true, 'rows', coalesce(jsonb_agg(
      jsonb_build_object('id', dca.id, 'value_sha256', encode(sha256(convert_to(dca.token_secret, 'UTF8')), 'hex'))
      ORDER BY dca.id COLLATE "C"
    ), '[]'::jsonb))
    FROM public.document_connector_accounts dca WHERE dca.token_secret LIKE 'enc:%'
  )$sub$ ELSE $sub$'{"present":false,"rows":[]}'::jsonb$sub$ END,
  CASE WHEN to_regclass('public.llm_provider_accounts') IS NOT NULL THEN $sub$(
    SELECT jsonb_build_object('present', true, 'rows', coalesce(jsonb_agg(
      jsonb_build_object('id', lpa.id, 'value_sha256', encode(sha256(convert_to(lpa.token_secret, 'UTF8')), 'hex'))
      ORDER BY lpa.id COLLATE "C"
    ), '[]'::jsonb))
    FROM public.llm_provider_accounts lpa WHERE lpa.token_secret LIKE 'enc:%'
  )$sub$ ELSE $sub$'{"present":false,"rows":[]}'::jsonb$sub$ END,
  CASE WHEN to_regclass('control.connector_revocation_custody') IS NOT NULL THEN $sub$(
    SELECT jsonb_build_object('present', true, 'rows', coalesce(jsonb_agg(
      jsonb_build_object(
        'custody_ref', crc.custody_ref, 'delivery_id', crc.delivery_id,
        'connector_account_id', crc.connector_account_id, 'provider', crc.provider,
        'envelope_version', crc.envelope_version, 'key_ref', crc.key_ref,
        'nonce', crc.nonce, 'ciphertext_sha256', encode(sha256(convert_to(crc.ciphertext, 'UTF8')), 'hex'),
        'auth_tag', crc.auth_tag, 'created_at', crc.created_at
      ) ORDER BY crc.custody_ref COLLATE "C"
    ), '[]'::jsonb))
    FROM control.connector_revocation_custody crc
  )$sub$ ELSE $sub$'{"present":false,"rows":[]}'::jsonb$sub$ END
  )
END \gexec

COMMIT;
