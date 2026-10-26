-- Local confidential registry bootstrap; never import a production/dev credential.
-- Basic-only authentication is enforced by the RFC 8693 handler for service_clients.
\getenv workload_secret IMMO_MCP_WORKLOAD_CLIENT_SECRET
\if :{?workload_secret}
  SELECT octet_length(:'workload_secret') >= 32 AND :'workload_secret' NOT LIKE '%-dev-only' AS workload_secret_valid \gset
  \if :workload_secret_valid
    SELECT encode(sha256(convert_to(:'workload_secret', 'UTF8')), 'hex') AS workload_hash \gset
    \unset workload_secret
    SELECT set_config('sync.workload_hash', :'workload_hash', true) \gset
    DO $$
    BEGIN
      IF EXISTS (SELECT FROM service_clients WHERE client_id = 'immo-mcp-workload'
                 AND (client_secret_hash <> current_setting('sync.workload_hash') OR revoked_at IS NOT NULL))
        THEN RAISE EXCEPTION 'workload credential mismatch or revoked; explicit owner rotation required'; END IF;
    END $$;
    INSERT INTO service_clients (id, client_id, client_secret_hash, display_name, allowed_scopes,
                                 resource_indicators, dpop_bound_access_tokens, tenant_id, exchange_policy)
    SELECT gen_random_uuid()::text, client_id, :'workload_hash', 'Radar preprod MCP workload',
           ARRAY['immo:search'], ARRAY['https://preprod.immo.sent-tech.ca'], false, 'sentropic', exchange_policy
    FROM transformed_service_policy WHERE client_id = 'immo-mcp-workload'
    ON CONFLICT (client_id) DO NOTHING;
    \unset workload_hash
  \else
    DO $$ BEGIN RAISE EXCEPTION 'workload credential invalid'; END $$;
  \endif
\endif
