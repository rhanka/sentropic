-- Two-phase sync fixtures: preprod protocol registries. The eight replica user ids
-- are the CM batch scope (fabricated relay). The four user stubs below only
-- satisfy the protocol FKs (consents, client owners); the sync never reads
-- the users table, which the cutover drops in production.
INSERT INTO users (id, email, display_name, role, account_status, email_verified, created_at, updated_at) VALUES
('efd67056-fb60-42e6-a386-6264c854da55', 'farid@example.invalid', 'Farid', 'user', 'active', true, '2026-01-01', '2026-10-01'),
('preprod-only', 'preprod-only@example.invalid', 'Kept user', 'user', 'active', true, '2026-01-01', '2026-10-01'),
('prod-user-8', 'prod-8@example.invalid', 'Synthetic 8', 'user', 'active', true, '2026-01-01', '2026-10-01'),
('1b9b9e15-2956-4df4-9ee1-a42273f0d096', 'owner@example.invalid', 'Owner', 'admin_app', 'active', true, '2026-01-01', '2026-10-01');
INSERT INTO oauth_clients (id, client_id, name, redirect_uris, allowed_scopes) VALUES
('client-1', 'radar-immobilier-preprod', 'Synthetic radar', ARRAY['https://radar.example.invalid/callback'], ARRAY['openid']),
('client-2', 'synthetic-client', 'Synthetic client', ARRAY['https://client.example.invalid/callback'], ARRAY['openid']);
UPDATE oauth_clients SET client_secret_hash = 'synthetic-preprod-hash' WHERE client_id = 'synthetic-client';
INSERT INTO id_token_signing_keys (kid, public_jwk, private_key_encrypted, active, created_at)
VALUES ('synthetic-signing-key', '{"kty":"OKP","x":"synthetic-public"}', decode('00', 'hex'), true, '2026-01-01');
INSERT INTO authorization_codes (code, client_id, user_id, redirect_uri, scope, code_challenge, code_challenge_method, expires_at)
VALUES ('synthetic-code', 'synthetic-client', 'efd67056-fb60-42e6-a386-6264c854da55', 'https://client.example.invalid/callback', 'openid', 'synthetic-proof', 'S256', '2027-01-01');
INSERT INTO oauth_tokens (jti, token_type, client_id, user_id, scope, audience, expires_at)
VALUES ('synthetic-token', 'access_token', 'synthetic-client', 'efd67056-fb60-42e6-a386-6264c854da55', 'openid', 'synthetic', '2027-01-01');
INSERT INTO oauth_consents (client_id, user_id, scopes)
VALUES ('synthetic-client', 'efd67056-fb60-42e6-a386-6264c854da55', ARRAY['openid']);
INSERT INTO oauth_consents (client_id, user_id, scopes) VALUES
('radar-immobilier-preprod', 'efd67056-fb60-42e6-a386-6264c854da55', ARRAY['openid']),
('radar-immobilier-preprod', 'preprod-only', ARRAY['openid']);
-- 2-IdP: pre-existing workload row with a stale policy (proves convergence without
-- secret rotation) plus an unrelated service client (proves non-interference).
INSERT INTO service_clients (id, client_id, client_secret_hash, display_name, allowed_scopes, resource_indicators, tenant_id, exchange_policy, created_at)
VALUES ('preprod-workload', 'immo-mcp-workload', 'synthetic-preprod-workload-hash', 'Immo MCP workload',
        ARRAY['immo:search'], ARRAY['https://preprod.immo.sent-tech.ca'], 'sentropic',
        '{"enabled": true, "allowedSubjectClients": ["immo-mcp"], "allowedSubjectAudiences": ["https://preprod.immo.sent-tech.ca/mcp"], "allowedTargetAudiences": ["https://preprod.immo.sent-tech.ca"], "actorSub": "immo-mcp-workload", "allowedScopes": ["immo:read"], "maxTtlSeconds": 900, "environment": null, "allowClientCredentials": false}', '2026-01-01'),
       ('preprod-decoy', 'other-svc', 'synthetic-decoy-hash', 'Unrelated service', ARRAY['service:ping'],
        ARRAY['https://preprod.sent-tech.ca'], 'sentropic', NULL, '2026-01-01');
-- Test-only fingerprints compare whole rows, including protected auth data.
CREATE FUNCTION test_assert(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'assertion failed: %', label; END IF; END $$;
CREATE FUNCTION test_fingerprint(tables text[]) RETURNS text LANGUAGE plpgsql AS $$
DECLARE tbl text; fp text; fingerprints text[] := '{}';
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('SELECT md5(coalesce(string_agg(to_jsonb(t)::text, ''|'' ORDER BY to_jsonb(t)::text), '''')) FROM %I t', tbl) INTO fp;
    fingerprints := array_append(fingerprints, tbl || ':' || fp);
  END LOOP;
  RETURN md5(array_to_string(fingerprints, '|'));
END $$;
-- DV5 covers every protocol row the sync must never touch: the mapped consent
-- pair (owner, radar-immobilier-preprod) is converged and the stale Farid grant is
-- removed, so both stay out of the invariant.
CREATE FUNCTION test_dv5() RETURNS text LANGUAGE sql AS $$
  SELECT test_fingerprint(ARRAY['id_token_signing_keys'])
    || (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY id), '')) FROM oauth_clients t WHERE client_id <> 'immo-mcp')
    || (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY code), '')) FROM authorization_codes t)
    || (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY jti), '')) FROM oauth_tokens t)
    || (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY user_id, client_id, tenant_id), '')) FROM oauth_consents t
        WHERE NOT (client_id = 'radar-immobilier-preprod' AND user_id IN ('1b9b9e15-2956-4df4-9ee1-a42273f0d096', 'efd67056-fb60-42e6-a386-6264c854da55')));
$$;
CREATE FUNCTION test_state() RETURNS text LANGUAGE sql AS $$
  SELECT test_fingerprint(ARRAY['oauth_clients', 'oauth_consents', 'service_clients', 'authorization_codes', 'oauth_tokens', 'revoked_tokens', 'id_token_signing_keys']) || test_dv5();
$$;
CREATE TABLE test_before AS SELECT test_state() AS state, test_dv5() AS dv5;
