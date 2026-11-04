-- Post-commit assertions for the two-phase sync: protocol convergence only.
SELECT test_assert((SELECT scopes = ARRAY['openid', 'profile', 'email'] AND created_at = '2026-01-01' AND updated_at = '2026-10-01' FROM oauth_consents WHERE user_id = '1b9b9e15-2956-4df4-9ee1-a42273f0d096' AND client_id = 'radar-immobilier-preprod' AND tenant_id = 'sentropic'), 'owner prod consent converged with exact scopes and timestamps');
SELECT test_assert(NOT EXISTS (SELECT FROM oauth_consents WHERE user_id = 'efd67056-fb60-42e6-a386-6264c854da55' AND client_id = 'radar-immobilier-preprod'), 'Farid without prod consent must consent');
SELECT test_assert((SELECT count(*) FROM oauth_consents WHERE user_id = 'preprod-only' AND client_id = 'radar-immobilier-preprod') = 1, 'preprod-only consent kept');
SELECT test_assert((SELECT count(*) FROM oauth_consents WHERE user_id = 'efd67056-fb60-42e6-a386-6264c854da55' AND client_id = 'synthetic-client') = 1, 'unmapped consent kept');
SELECT test_assert((SELECT client_secret_hash IS NULL AND token_endpoint_auth_method = 'none' AND require_pkce
  AND redirect_uris = ARRAY['https://claude.ai/api/mcp/auth_callback']::text[]
  AND allowed_scopes = ARRAY['immo:read','immo:search','immo:documents:read','immo:artifacts:read','immo:artifacts:write','offline_access']::text[]
  AND grant_types = ARRAY['authorization_code','refresh_token']::text[]
  AND resource_indicators = ARRAY['https://preprod.immo.sent-tech.ca/mcp']::text[]
  AND tenant_id = 'sentropic' AND owner_user_id = 'prod-user-8'
  FROM oauth_clients WHERE client_id = 'immo-mcp'), 'immo-mcp public PKCE, external callback, preprod resource, preprod-only artifact scopes and synced owner');
SELECT test_assert((SELECT id = 'preprod-workload' AND client_secret_hash = 'synthetic-preprod-workload-hash'
  AND exchange_policy = '{"enabled": true, "allowedSubjectClients": ["immo-mcp"], "allowedSubjectAudiences": ["https://preprod.immo.sent-tech.ca/mcp"], "allowedTargetAudiences": ["https://preprod.immo.sent-tech.ca"], "actorSub": "immo-mcp-workload", "allowedScopes": ["immo:search"], "maxTtlSeconds": 300, "environment": null, "allowClientCredentials": false}'::jsonb
  FROM service_clients WHERE client_id = 'immo-mcp-workload'), 'workload policy converged to preprod audiences without secret rotation');
SELECT test_assert((SELECT client_secret_hash = 'synthetic-decoy-hash' AND exchange_policy IS NULL
  FROM service_clients WHERE client_id = 'other-svc'), 'unrelated service client untouched');
SELECT test_assert((SELECT count(*) FROM service_clients) = 2, 'no service row created or removed');
SELECT test_assert(test_dv5() = (SELECT dv5 FROM test_before), 'full DV5 fingerprints unchanged');
