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
# Restore the converged state for later stages.
sql -d preprod -c "INSERT INTO service_clients (id, client_id, client_secret_hash, display_name, allowed_scopes, resource_indicators, tenant_id, exchange_policy, created_at) VALUES ('preprod-workload', 'immo-mcp-workload', 'synthetic-preprod-workload-hash', 'Immo MCP workload', ARRAY['immo:search'], ARRAY['https://preprod.immo.sent-tech.ca'], 'sentropic', '{\"enabled\": true, \"allowedSubjectClients\": [\"immo-mcp\"], \"allowedSubjectAudiences\": [\"https://preprod.immo.sent-tech.ca/mcp\"], \"allowedTargetAudiences\": [\"https://preprod.immo.sent-tech.ca\"], \"actorSub\": \"immo-mcp-workload\", \"allowedScopes\": [\"immo:read\"], \"maxTtlSeconds\": 900, \"environment\": null, \"allowClientCredentials\": false}', '2026-01-01')"
sync -v dry_run=0
grep -Fxq 'services_upserted|1' /tmp/sql.log
assert_sql "SELECT test_assert((SELECT exchange_policy->>'maxTtlSeconds' = '300' FROM service_clients WHERE client_id = 'immo-mcp-workload'), 'restored workload reconverged')"
echo 'PASS: service policy sync replay and non-interference complete'
