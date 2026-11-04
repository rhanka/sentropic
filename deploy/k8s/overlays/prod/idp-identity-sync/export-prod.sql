-- Prod-side protocol export (runs in ns `sentropic` as role idp_identity_reader, READ ONLY).
-- Exports the app protocol registries for the relay: explicit consents (scopes live
-- here, not in CM) and client configuration (secret presence only).
-- CM identity itself is exported by the identity-replica-export runner (api image),
-- which adds identity-replica-batch.json, replica-users.csv and snapshot.csv to the
-- same relay dir AFTER this leg, then writes SHA256SUMS.
-- No users, no WebAuthn, no sessions, tokens, codes, magic-links, client secret
-- hashes or signing keys.
-- Invoked: psql -XAtq -v ON_ERROR_STOP=1 -f export-prod.sql   (cwd = /work)
\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;  -- one consistent snapshot for both files
\copy (SELECT user_id, client_id, tenant_id, scopes, created_at, updated_at FROM oauth_consents ORDER BY user_id, client_id, tenant_id) TO 'consents.csv' WITH (FORMAT csv, HEADER true)
\copy (SELECT c.client_id, p.has_secret, c.name, c.redirect_uris, c.allowed_scopes, c.grant_types, c.response_types, c.token_endpoint_auth_method, c.dpop_bound_access_tokens, c.require_pkce, c.resource_indicators, c.tenant_id, c.owner_user_id, c.created_at, c.updated_at FROM oauth_clients c JOIN idp_oauth_client_secret_presence p USING (client_id) ORDER BY c.client_id) TO 'clients.csv' WITH (FORMAT csv, HEADER true)
COMMIT;
