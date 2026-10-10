-- Changed-row upserts retain the local row ID and confidential secret hash.
WITH written AS (
  INSERT INTO oauth_clients (id, client_id, name, redirect_uris, allowed_scopes, grant_types, response_types,
                             token_endpoint_auth_method, dpop_bound_access_tokens, require_pkce,
                             resource_indicators, tenant_id, owner_user_id, created_at, updated_at)
  SELECT gen_random_uuid()::text, client_id, name, redirect_uris, allowed_scopes, grant_types, response_types,
         token_endpoint_auth_method, dpop_bound_access_tokens, require_pkce,
         resource_indicators, tenant_id, owner_user_id, created_at, updated_at FROM desired_clients
  ON CONFLICT (client_id) DO UPDATE SET
    name = EXCLUDED.name, redirect_uris = EXCLUDED.redirect_uris, allowed_scopes = EXCLUDED.allowed_scopes,
    grant_types = EXCLUDED.grant_types, response_types = EXCLUDED.response_types,
    token_endpoint_auth_method = EXCLUDED.token_endpoint_auth_method,
    dpop_bound_access_tokens = EXCLUDED.dpop_bound_access_tokens, require_pkce = EXCLUDED.require_pkce,
    resource_indicators = EXCLUDED.resource_indicators, tenant_id = EXCLUDED.tenant_id,
    owner_user_id = EXCLUDED.owner_user_id, created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at
  WHERE (oauth_clients.name, oauth_clients.redirect_uris, oauth_clients.allowed_scopes,
         oauth_clients.grant_types, oauth_clients.response_types, oauth_clients.token_endpoint_auth_method,
         oauth_clients.dpop_bound_access_tokens, oauth_clients.require_pkce, oauth_clients.resource_indicators,
         oauth_clients.tenant_id, oauth_clients.owner_user_id, oauth_clients.created_at, oauth_clients.updated_at)
    IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.redirect_uris, EXCLUDED.allowed_scopes,
                      EXCLUDED.grant_types, EXCLUDED.response_types, EXCLUDED.token_endpoint_auth_method,
                      EXCLUDED.dpop_bound_access_tokens, EXCLUDED.require_pkce, EXCLUDED.resource_indicators,
                      EXCLUDED.tenant_id, EXCLUDED.owner_user_id, EXCLUDED.created_at, EXCLUDED.updated_at)
  RETURNING 1
)
SELECT 'clients_upserted', count(*) FROM written;
SELECT 'clients_removed', 0; -- No managed deletion allowlist is enabled.
