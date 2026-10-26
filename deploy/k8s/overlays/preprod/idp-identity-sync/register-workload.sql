-- Local confidential registry convergence; only the client-side hash reaches psql.
-- Basic-only authentication is enforced by the RFC 8693 handler for service_clients.
\getenv workload_hash IMMO_MCP_WORKLOAD_CLIENT_SECRET_HASH
\if :{?workload_hash}
    INSERT INTO service_clients (id, client_id, client_secret_hash, display_name, allowed_scopes,
                                 resource_indicators, dpop_bound_access_tokens, tenant_id, exchange_policy)
    SELECT gen_random_uuid()::text, client_id, :'workload_hash', 'Radar preprod MCP workload',
           ARRAY['immo:search'], ARRAY['https://preprod.immo.sent-tech.ca'], false, 'sentropic', exchange_policy
    FROM transformed_service_policy WHERE client_id = 'immo-mcp-workload'
    ON CONFLICT (client_id) DO UPDATE SET client_secret_hash = EXCLUDED.client_secret_hash
      WHERE service_clients.revoked_at IS NULL
        AND service_clients.client_secret_hash IS DISTINCT FROM EXCLUDED.client_secret_hash;
    \unset workload_hash
\endif
