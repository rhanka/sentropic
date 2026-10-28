# Sourced by sql-test.sh inside the disposable database container.
# 2-IdP (R2): replay and non-interference for the workload exchange-policy sync.
stage=service-policy-sync
refresh_relay
# Steady state: the committed policy reruns as a no-op.
sync -v dry_run=0
grep -Fxq 'services_upserted|0' /tmp/sql.log
grep -Fxq 'services_skipped_missing|0' /tmp/sql.log
echo 'PASS: converged workload policy reruns as 0/0'
# A stale policy converges in one committed run without touching the secret.
sql -d preprod -c "UPDATE service_clients SET exchange_policy = '{\"enabled\": true, \"allowedSubjectClients\": [\"immo-mcp\"], \"allowedSubjectAudiences\": [\"https://preprod.immo.sent-tech.ca/mcp\"], \"allowedTargetAudiences\": [\"https://preprod.immo.sent-tech.ca\"], \"actorSub\": \"immo-mcp-workload\", \"allowedScopes\": [\"immo:read\"], \"maxTtlSeconds\": 900, \"environment\": null, \"allowClientCredentials\": false}' WHERE client_id = 'immo-mcp-workload'"
sync
grep -Fq 'DRY RUN: rolled back' /tmp/sql.log
assert_sql "SELECT test_assert((SELECT exchange_policy->>'maxTtlSeconds' = '900' FROM service_clients WHERE client_id = 'immo-mcp-workload'), 'dry-run leaves the stale policy in place')"
sync -v dry_run=0
grep -Fxq 'services_upserted|1' /tmp/sql.log
grep -Fxq 'services_skipped_missing|0' /tmp/sql.log
assert_sql "SELECT test_assert((SELECT id = 'preprod-workload' AND client_secret_hash = 'synthetic-preprod-workload-hash' AND exchange_policy->>'maxTtlSeconds' = '300' AND exchange_policy->'allowedScopes' = '[\"immo:search\"]'::jsonb FROM service_clients WHERE client_id = 'immo-mcp-workload'), 'stale policy converged without secret rotation')"
assert_sql "SELECT test_assert((SELECT client_secret_hash = 'synthetic-decoy-hash' AND exchange_policy IS NULL FROM service_clients WHERE client_id = 'other-svc'), 'unrelated service client untouched')"
echo 'PASS: stale workload policy converges without secret rotation; decoy untouched'
# Replay converges back to a no-op.
sync -v dry_run=0
grep -Fxq 'services_upserted|0' /tmp/sql.log
echo 'PASS: second run is a no-op'
# A missing workload row is skipped, never created (no secret material is minted).
sql -d preprod -c "DELETE FROM service_clients WHERE client_id = 'immo-mcp-workload'"
sync -v dry_run=0
grep -Fxq 'services_upserted|0' /tmp/sql.log
grep -Fxq 'services_skipped_missing|1' /tmp/sql.log
assert_sql "SELECT test_assert(NOT EXISTS (SELECT FROM service_clients WHERE client_id = 'immo-mcp-workload'), 'missing workload is skipped, never created'); SELECT test_assert((SELECT count(*) FROM service_clients) = 1, 'decoy survives the skipped run')"
echo 'PASS: missing workload is skipped, never created'
# A locally supplied Secret bootstraps only the reviewed workload, transactionally.
stage=workload-registration
sql -d preprod -c "ALTER SYSTEM SET log_statement = 'all'"
sql -d preprod -c 'SELECT pg_reload_conf()'
# Deliberately public synthetic fixtures, not generated credentials.
fixture='0000000000000000000000000000000000000000000000000000000000000000'
for invalid in '' synthetic-workload-credential-dev-only synthetic-preprod-workload-credential-for-tests "${fixture}0" "${fixture%0}" "${fixture%0}g" "${fixture%0}A" "$fixture
"; do
  IMMO_MCP_WORKLOAD_CLIENT_SECRET="$invalid" reject 'invalid workload credential' workload_credential_invalid -d preprod -v dry_run=0 -v expected_users=8 -v expected_webauthn=18 -v expected_consents=1 -v expected_clients=4 -f "$import"
done
export IMMO_MCP_WORKLOAD_CLIENT_SECRET="$fixture"
fixture_hash=$(printf '%s' "$fixture" | sha256sum); fixture_hash=${fixture_hash%% *}
sync
assert_sql "SELECT test_assert(NOT EXISTS (SELECT FROM service_clients WHERE client_id = 'immo-mcp-workload'), 'registration rolls back in dry-run')"
sync -v dry_run=0
assert_sql "SELECT test_assert((SELECT client_secret_hash = '$fixture_hash' AND allowed_scopes = ARRAY['immo:search'] AND resource_indicators = ARRAY['https://preprod.immo.sent-tech.ca'] AND NOT dpop_bound_access_tokens AND exchange_policy->'allowedSubjectClients' = '[\"immo-mcp\"]'::jsonb AND exchange_policy->'allowedSubjectAudiences' = '[\"https://preprod.immo.sent-tech.ca/mcp\"]'::jsonb AND exchange_policy->'allowedTargetAudiences' = '[\"https://preprod.immo.sent-tech.ca\"]'::jsonb AND exchange_policy->>'allowClientCredentials' = 'false' AND exchange_policy->>'maxTtlSeconds' = '300' FROM service_clients WHERE client_id = 'immo-mcp-workload'), 'registered exact preprod exchange-only policy'); SELECT test_assert((SELECT count(*) FROM service_clients) = 2, 'only the workload was created')"
assert_sql 'CREATE TABLE test_registered_workload AS SELECT * FROM service_clients'
sync -v dry_run=0
assert_sql "SELECT test_assert(NOT EXISTS ((TABLE test_registered_workload EXCEPT TABLE service_clients) UNION ALL (TABLE service_clients EXCEPT TABLE test_registered_workload)), 'registration is byte-identical on replay')"
export IMMO_MCP_WORKLOAD_CLIENT_SECRET='1111111111111111111111111111111111111111111111111111111111111111'
sync
assert_sql "SELECT test_assert((SELECT client_secret_hash = '$fixture_hash' FROM service_clients WHERE client_id = 'immo-mcp-workload'), 'dry-run does not rotate')"
sync -v dry_run=0
rotated_hash=$(printf '%s' "$IMMO_MCP_WORKLOAD_CLIENT_SECRET" | sha256sum); rotated_hash=${rotated_hash%% *}
assert_sql "SELECT test_assert((SELECT c.client_secret_hash = '$rotated_hash' AND c.client_secret_hash <> '$fixture_hash' AND (to_jsonb(c) - 'client_secret_hash') = (to_jsonb(b) - 'client_secret_hash') FROM service_clients c JOIN test_registered_workload b USING (client_id) WHERE c.client_id = 'immo-mcp-workload'), 'rotation replaces only the hash and revokes the old credential')"
assert_sql "UPDATE service_clients SET revoked_at = now() WHERE client_id = 'immo-mcp-workload'"
export IMMO_MCP_WORKLOAD_CLIENT_SECRET="$fixture"
sync -v dry_run=0
assert_sql "SELECT test_assert((SELECT revoked_at IS NOT NULL AND client_secret_hash = '$rotated_hash' FROM service_clients WHERE client_id = 'immo-mcp-workload'), 'revoked workload stays revoked without blocking identity sync')"
grep -Fq 'INSERT INTO service_clients' /tmp/postgres.log
! grep -Fq -e "$fixture" -e '1111111111111111111111111111111111111111111111111111111111111111' /tmp/postgres.log
echo 'PASS: PostgreSQL statement logging contains no clear workload credential'
unset IMMO_MCP_WORKLOAD_CLIENT_SECRET
assert_sql "DELETE FROM service_clients WHERE client_id = 'immo-mcp-workload'; DROP TABLE test_registered_workload"
echo 'PASS: local Secret registration, exact policy, replay, rotation, dry-run and revocation'
# Restore the converged state for later stages.
sql -d preprod -c "INSERT INTO service_clients (id, client_id, client_secret_hash, display_name, allowed_scopes, resource_indicators, tenant_id, exchange_policy, created_at) VALUES ('preprod-workload', 'immo-mcp-workload', 'synthetic-preprod-workload-hash', 'Immo MCP workload', ARRAY['immo:search'], ARRAY['https://preprod.immo.sent-tech.ca'], 'sentropic', '{\"enabled\": true, \"allowedSubjectClients\": [\"immo-mcp\"], \"allowedSubjectAudiences\": [\"https://preprod.immo.sent-tech.ca/mcp\"], \"allowedTargetAudiences\": [\"https://preprod.immo.sent-tech.ca\"], \"actorSub\": \"immo-mcp-workload\", \"allowedScopes\": [\"immo:read\"], \"maxTtlSeconds\": 900, \"environment\": null, \"allowClientCredentials\": false}', '2026-01-01')"
sync -v dry_run=0
grep -Fxq 'services_upserted|1' /tmp/sql.log
assert_sql "SELECT test_assert((SELECT exchange_policy->>'maxTtlSeconds' = '300' FROM service_clients WHERE client_id = 'immo-mcp-workload'), 'restored workload reconverged')"
echo 'PASS: service policy sync replay and non-interference complete'
