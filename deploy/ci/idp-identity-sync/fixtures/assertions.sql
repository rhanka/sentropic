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
CREATE FUNCTION test_dv5() RETURNS text LANGUAGE sql AS $$
  SELECT test_fingerprint(ARRAY['id_token_signing_keys'])
    || (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY id), '')) FROM oauth_clients t WHERE client_id <> 'immo-mcp')
    || (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY code), '')) FROM authorization_codes t WHERE user_id <> '9f11d240-fc75-4d55-80be-1bafcd79eadb')
    || (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY jti), '')) FROM oauth_tokens t WHERE user_id <> '9f11d240-fc75-4d55-80be-1bafcd79eadb')
    || (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY user_id, client_id, tenant_id), '')) FROM oauth_consents t WHERE user_id <> '9f11d240-fc75-4d55-80be-1bafcd79eadb' AND (client_id <> 'radar-immobilier-preprod' OR user_id = 'preprod-only'))
    || (SELECT md5(to_jsonb(s)::text) FROM user_sessions s WHERE id = 'kept-session');
$$;
CREATE FUNCTION test_state() RETURNS text LANGUAGE sql AS $$
  SELECT test_fingerprint(ARRAY['oauth_clients', 'users', 'webauthn_credentials', 'user_sessions', 'webauthn_challenges', 'magic_links', 'chat_sessions', 'comments', 'authorization_codes', 'oauth_tokens', 'oauth_consents', 'revoked_tokens']) || test_dv5();
$$;
CREATE TABLE test_before AS SELECT test_state() AS state, test_dv5() AS dv5;
SELECT test_assert((SELECT count(*) FROM users) = 8, 'baseline users 8');
SELECT test_assert((SELECT count(*) FROM webauthn_credentials) = 21, 'baseline credentials 21');
SELECT test_assert((SELECT count(*) FROM user_sessions WHERE user_id = '9f11d240-fc75-4d55-80be-1bafcd79eadb') = 9, 'baseline duplicate sessions 9');
SELECT test_assert((SELECT count(*) FROM webauthn_credentials WHERE user_id = '9f11d240-fc75-4d55-80be-1bafcd79eadb') = 8, 'baseline duplicate credentials 8');
SELECT test_assert((SELECT count(*) FROM oauth_clients) = 2 AND (SELECT count(*) FROM id_token_signing_keys WHERE active) = 1, 'baseline DV5 counts');
