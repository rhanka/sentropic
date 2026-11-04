-- Two-phase sync fixtures: the prod protocol registries only. Identity lives in
-- the CM batch (fabricated by the test relay). The single user stub below only
-- satisfies the oauth_consents FK; the sync never reads the users table.
INSERT INTO users (id, email, display_name, role, account_status, email_verified, created_at, updated_at) VALUES
('1b9b9e15-2956-4df4-9ee1-a42273f0d096', 'owner@example.invalid', 'Owner', 'admin_app', 'active', true, '2026-01-01', '2026-10-01'),
('prod-user-8', 'prod-8@example.invalid', 'Synthetic 8', 'user', 'active', true, '2026-01-01', '2026-10-01');
INSERT INTO oauth_clients (id, client_id, name, redirect_uris, allowed_scopes)
VALUES ('prod-radar', 'radar-immobilier', 'Synthetic radar', ARRAY['https://radar.example.invalid/callback'], ARRAY['openid', 'profile', 'email']);
INSERT INTO oauth_consents (user_id, client_id, tenant_id, scopes, created_at, updated_at)
VALUES ('1b9b9e15-2956-4df4-9ee1-a42273f0d096', 'radar-immobilier', 'sentropic', ARRAY['openid', 'profile', 'email'], '2026-01-01', '2026-10-01');
INSERT INTO oauth_clients (id, client_id, name, redirect_uris, allowed_scopes, token_endpoint_auth_method,
                           require_pkce, resource_indicators, tenant_id, owner_user_id, created_at, updated_at)
VALUES ('prod-immo', 'immo-mcp', 'Immo MCP', ARRAY['https://claude.ai/api/mcp/auth_callback'],
        ARRAY['immo:read','immo:search','immo:documents:read'], 'none', true,
        ARRAY['https://immo.sent-tech.ca/mcp'], NULL, 'prod-user-8', '2026-01-01', '2026-10-01');
INSERT INTO oauth_clients (id, client_id, name, redirect_uris, allowed_scopes, client_secret_hash)
VALUES ('prod-confidential', 'synthetic-client', 'Prod confidential config', ARRAY['https://sentropic.sent-tech.ca/callback'], ARRAY['openid'], 'synthetic-prod-hash'),
       ('prod-new-confidential', 'new-confidential', 'Needs independent secret', ARRAY['https://auth.sent-tech.ca/callback'], ARRAY['openid'], 'synthetic-new-prod-hash');
