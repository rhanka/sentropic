-- Prod-side identity export (runs in ns `sentropic` as role idp_identity_reader, READ ONLY).
-- Exports identities, explicit consents and client configuration (secret presence only).
-- No sessions, tokens, codes, magic-links, client secret hashes or signing keys.
-- Invoked: psql -XAtq -v ON_ERROR_STOP=1 -f export-prod.sql   (cwd = /work)
\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;  -- one consistent snapshot for every file
\copy (SELECT id, email, display_name, role, account_status, approval_due_at, approved_at, approved_by_user_id, disabled_at, disabled_reason, email_verified, created_at, updated_at FROM users ORDER BY id) TO 'users.csv' WITH (FORMAT csv, HEADER true)
\copy (SELECT id, credential_id, public_key_cose, counter, user_id, device_name, transports_json, uv, created_at, last_used_at FROM webauthn_credentials ORDER BY id) TO 'webauthn.csv' WITH (FORMAT csv, HEADER true)
\copy (SELECT user_id, client_id, tenant_id, scopes, created_at, updated_at FROM oauth_consents ORDER BY user_id, client_id, tenant_id) TO 'consents.csv' WITH (FORMAT csv, HEADER true)
\copy (SELECT c.client_id, p.has_secret, c.name, c.redirect_uris, c.allowed_scopes, c.grant_types, c.response_types, c.token_endpoint_auth_method, c.dpop_bound_access_tokens, c.require_pkce, c.resource_indicators, c.tenant_id, c.owner_user_id, c.created_at, c.updated_at FROM oauth_clients c JOIN idp_oauth_client_secret_presence p USING (client_id) ORDER BY c.client_id) TO 'clients.csv' WITH (FORMAT csv, HEADER true)
\copy (SELECT now() AT TIME ZONE 'UTC', (SELECT count(*) FROM users), (SELECT count(*) FROM webauthn_credentials), (SELECT count(*) FROM oauth_consents), (SELECT count(*) FROM oauth_clients)) TO 'snapshot.csv' WITH (FORMAT csv)
COMMIT;
