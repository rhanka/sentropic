-- Eight users: one duplicate, one preprod-only, and one missing prod user.
INSERT INTO users (id, email, display_name, role, account_status, email_verified, created_at, updated_at) VALUES
('9f11d240-fc75-4d55-80be-1bafcd79eadb', 'owner@example.invalid', 'Duplicate', 'guest', 'approval_expired_readonly', false, '2026-02-01', '2026-02-01'),
('efd67056-fb60-42e6-a386-6264c854da55', 'farid@example.invalid', 'Farid', 'user', 'active', true, '2026-01-01', '2026-10-01'),
('preprod-only', 'preprod-only@example.invalid', 'Kept user', 'user', 'active', true, '2026-01-01', '2026-10-01');
INSERT INTO users (id, email, display_name, role, created_at, updated_at)
SELECT 'prod-user-' || n, 'prod-' || n || '@example.invalid', 'Synthetic ' || n, 'user', '2026-01-01', '2026-10-01'
FROM generate_series(3, 7) n;
INSERT INTO webauthn_credentials (id, credential_id, public_key_cose, counter, user_id, device_name, created_at, last_used_at)
SELECT 'duplicate-cred-' || n, CASE WHEN n <= 7 THEN 'synthetic-credential-' || n ELSE 'preprod-duplicate-only' END,
       'synthetic-old-cose-' || n, 3, '9f11d240-fc75-4d55-80be-1bafcd79eadb', 'Duplicate device', '2026-02-01', '2026-02-01'
FROM generate_series(1, 8) n;
INSERT INTO webauthn_credentials (id, credential_id, public_key_cose, counter, user_id, device_name, created_at, last_used_at)
SELECT 'prod-cred-' || n, 'synthetic-credential-' || n, 'synthetic-old-cose-' || n, 50,
       CASE WHEN n <= 10 THEN 'efd67056-fb60-42e6-a386-6264c854da55' ELSE 'prod-user-' || (3 + (n - 11) % 5) END,
       'Preprod device', '2026-01-01', '2026-10-02'
FROM generate_series(9, 18) n;
INSERT INTO webauthn_credentials (id, credential_id, public_key_cose, counter, user_id, device_name, created_at)
SELECT 'preprod-only-cred-' || n, 'preprod-only-credential-' || n, 'synthetic-public-cose', 0, 'preprod-only', 'Kept device', '2026-01-01'
FROM generate_series(1, 3) n;
INSERT INTO user_sessions (id, user_id, session_token_hash, expires_at, created_at, last_activity_at)
SELECT 'duplicate-session-' || n, '9f11d240-fc75-4d55-80be-1bafcd79eadb', 'synthetic-session-' || n, '2027-01-01', '2026-01-01', '2026-01-01'
FROM generate_series(1, 9) n;
INSERT INTO user_sessions (id, user_id, session_token_hash, expires_at, created_at, last_activity_at)
VALUES ('kept-session', 'efd67056-fb60-42e6-a386-6264c854da55', 'synthetic-kept-session', '2027-01-01', '2026-01-01', '2026-01-01');
INSERT INTO webauthn_challenges (id, challenge, user_id, type, expires_at)
VALUES ('duplicate-challenge', 'synthetic-challenge', '9f11d240-fc75-4d55-80be-1bafcd79eadb', 'registration', '2027-01-01');
INSERT INTO magic_links (id, token_hash, email, user_id, expires_at)
VALUES ('duplicate-link', 'synthetic-link', 'owner@example.invalid', '9f11d240-fc75-4d55-80be-1bafcd79eadb', '2027-01-01');
-- Product FKs in two real tables must survive the duplicate deletion.
INSERT INTO chat_sessions (id, user_id, title) VALUES ('duplicate-chat', '9f11d240-fc75-4d55-80be-1bafcd79eadb', 'Synthetic chat');
INSERT INTO comments (id, workspace_id, context_type, context_id, created_by, assigned_to, thread_id, content)
VALUES ('duplicate-comment', '00000000-0000-0000-0000-000000000001', 'test', 'synthetic',
        '9f11d240-fc75-4d55-80be-1bafcd79eadb', '9f11d240-fc75-4d55-80be-1bafcd79eadb', 'synthetic-thread', 'Synthetic content');
INSERT INTO oauth_clients (id, client_id, name, redirect_uris, allowed_scopes) VALUES
('client-1', 'radar-immobilier-preprod', 'Synthetic radar', ARRAY['https://radar.example.invalid/callback'], ARRAY['openid']),
('client-2', 'synthetic-client', 'Synthetic client', ARRAY['https://client.example.invalid/callback'], ARRAY['openid']);
INSERT INTO id_token_signing_keys (kid, public_jwk, private_key_encrypted, active, created_at)
VALUES ('synthetic-signing-key', '{"kty":"OKP","x":"synthetic-public"}', decode('00', 'hex'), true, '2026-01-01');
INSERT INTO authorization_codes (code, client_id, user_id, redirect_uri, scope, code_challenge, code_challenge_method, expires_at)
VALUES ('synthetic-code', 'synthetic-client', 'efd67056-fb60-42e6-a386-6264c854da55', 'https://client.example.invalid/callback', 'openid', 'synthetic-proof', 'S256', '2027-01-01');
INSERT INTO oauth_tokens (jti, token_type, client_id, user_id, scope, audience, expires_at)
VALUES ('synthetic-token', 'access_token', 'synthetic-client', 'efd67056-fb60-42e6-a386-6264c854da55', 'openid', 'synthetic', '2027-01-01');
INSERT INTO oauth_consents (client_id, user_id, scopes)
VALUES ('synthetic-client', 'efd67056-fb60-42e6-a386-6264c854da55', ARRAY['openid']);
