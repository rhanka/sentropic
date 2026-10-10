-- Synthetic measured prod topology: eight users and eighteen public credentials.
INSERT INTO users (id, email, display_name, role, account_status, email_verified, created_at, updated_at) VALUES
('1b9b9e15-2956-4df4-9ee1-a42273f0d096', 'owner@example.invalid', 'Owner', 'admin_app', 'active', true, '2026-01-01', '2026-10-01'),
('efd67056-fb60-42e6-a386-6264c854da55', 'farid@example.invalid', 'Farid', 'user', 'active', true, '2026-01-01', '2026-10-01');
INSERT INTO users (id, email, display_name, role, account_status, email_verified, created_at, updated_at)
SELECT 'prod-user-' || n, 'prod-' || n || '@example.invalid', 'Synthetic ' || n, 'user', 'active', true, '2026-01-01', '2026-10-01'
FROM generate_series(3, 8) n;
UPDATE users SET approved_by_user_id = '1b9b9e15-2956-4df4-9ee1-a42273f0d096' WHERE id <> '1b9b9e15-2956-4df4-9ee1-a42273f0d096';
INSERT INTO webauthn_credentials (id, credential_id, public_key_cose, counter, user_id, device_name, transports_json, uv, created_at, last_used_at)
SELECT 'prod-cred-' || n, 'synthetic-credential-' || n, 'synthetic-public-cose-' || n, 10,
       CASE WHEN n <= 8 THEN '1b9b9e15-2956-4df4-9ee1-a42273f0d096'
            WHEN n <= 10 THEN 'efd67056-fb60-42e6-a386-6264c854da55'
            ELSE 'prod-user-' || (3 + (n - 11) % 6) END,
       'Synthetic device', '["internal"]', true, '2026-01-01', '2026-10-01'
FROM generate_series(1, 18) n;
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
