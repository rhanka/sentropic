# Sourced by sql-test.sh inside the disposable database container.
stage=client-controls
assert_sql 'UPDATE test_before SET state = test_state(), dv5 = test_dv5()'
WRAPPER_CLIENTS='' wrapper
grep -Fq '"clients_upserted":0' /dev/termination-log
grep -Fq '"clients_removed":0' /dev/termination-log
unchanged
WRAPPER_CLIENTS='missing-client' reject_wrapper client_source_missing
for allowlist in 'immo-mcp,immo-mcp' 'immo-mcp,' 'bad/client'; do
  WRAPPER_CLIENTS="$allowlist" reject_wrapper client_policy_invalid
done
WRAPPER_CLIENTS=new-confidential wrapper
grep -Fq '"clients_skipped_confidential":1' /dev/termination-log
grep -Fq '"clients_upserted":0' /dev/termination-log
unchanged
WRAPPER_CLIENTS=synthetic-client wrapper
grep -Fq '"clients_upserted":1' /dev/termination-log
unchanged
SQL_CLIENTS=synthetic-client sync -v dry_run=0
assert_sql "SELECT test_assert((SELECT id = 'client-2' AND client_secret_hash = 'synthetic-preprod-hash' AND name = 'Prod confidential config' AND redirect_uris = ARRAY['https://preprod.sentropic.sent-tech.ca/callback']::text[] FROM oauth_clients WHERE client_id = 'synthetic-client'), 'local confidential ID and secret survive config convergence')"
assert_sql 'UPDATE test_before SET state = test_state(), dv5 = test_dv5()'
SQL_CLIENTS=synthetic-client sync -v dry_run=0
grep -Fxq 'clients_upserted|0' /tmp/sql.log
unchanged
echo 'PASS: empty client allowlist, missing sources, confidential skip, local secret and idempotence'

stage=client-host-policy
for field in redirect_uris resource_indicators; do
  for uri in 'https://immo.sent-tech.ca../mcp' 'https://immo.sent-tech.ca./mcp' 'https://immo..sent-tech.ca/mcp' 'https://999.999.999.999/callback' 'https://127.1/callback' 'https://claude.ai/callback%ZZ'; do
    sql -d app -v uri="$uri" -v field="$field" <<'SQL'
UPDATE oauth_clients SET :"field" = ARRAY[:'uri'] WHERE client_id = 'immo-mcp';
SQL
    refresh_relay
    reject_wrapper client_policy_invalid
  done
  sql -d app -c "UPDATE oauth_clients SET redirect_uris = ARRAY['https://claude.ai/api/mcp/auth_callback'], resource_indicators = ARRAY['https://immo.sent-tech.ca/mcp'] WHERE client_id = 'immo-mcp'"
done
sql -d app -c "UPDATE oauth_clients SET redirect_uris = ARRAY['https://sentropic.sent-tech.ca/callback?next=https://auth.sent-tech.ca/login','https://claude.ai/api/mcp/auth_callback'], resource_indicators = ARRAY['https://IMMO.sent-tech.ca:443/mcp?q=immo.sent-tech.ca'] WHERE client_id = 'immo-mcp'"
refresh_relay
wrapper
grep -Fq '"clients_upserted":1' /dev/termination-log
unchanged
sync -v dry_run=0
assert_sql "SELECT test_assert((SELECT redirect_uris = ARRAY['https://preprod.sentropic.sent-tech.ca/callback?next=https://auth.sent-tech.ca/login','https://claude.ai/api/mcp/auth_callback']::text[] AND resource_indicators = ARRAY['https://preprod.immo.sent-tech.ca:443/mcp?q=immo.sent-tech.ca']::text[] FROM oauth_clients WHERE client_id = 'immo-mcp'), 'only exact owned authority is rewritten; port, path, query and external callback survive')"
assert_sql 'UPDATE test_before SET state = test_state()'
for uri in 'https://unknown.sent-tech.ca/callback' 'https://auth.sent-tech.ca@evil.invalid/callback' 'https://auth.sent-tech.ca/callback#fragment' 'http://auth.sent-tech.ca/callback' 'https://auth.sent-tech.ca:65536/callback' 'https://auth.sent-tech.ca/callback\escape'; do
  sql -d app -v uri="$uri" <<'SQL'
UPDATE oauth_clients SET redirect_uris = ARRAY[:'uri'] WHERE client_id = 'immo-mcp';
SQL
  refresh_relay
  reject_wrapper client_policy_invalid
done
sql -d app -c "UPDATE oauth_clients SET redirect_uris = ARRAY['https://claude.ai/api/mcp/auth_callback'], resource_indicators = ARRAY['https://preprod.immo.sent-tech.ca/mcp'] WHERE client_id = 'immo-mcp'"
refresh_relay
sync -v dry_run=0
assert_sql "SELECT test_assert((SELECT resource_indicators = ARRAY['https://preprod.immo.sent-tech.ca/mcp']::text[] FROM oauth_clients WHERE client_id = 'immo-mcp'), 'preprod authority stays stable')"
assert_sql 'UPDATE test_before SET state = test_state()'
cp /sql/host-map.csv host-map.original
tail -n 1 /sql/host-map.csv >> /sql/host-map.csv
reject_wrapper client_policy_invalid
mv host-map.original /sql/host-map.csv
echo 'PASS: owned host rewrite, external callback preservation and ambiguous URI/map rejection'

stage=client-classification
sql -d app -c "UPDATE oauth_clients SET token_endpoint_auth_method = 'client_secret_basic', client_secret_hash = 'synthetic-immo-secret' WHERE client_id = 'immo-mcp'"
refresh_relay
reject_wrapper client_policy_invalid
sql -d app -c "UPDATE oauth_clients SET token_endpoint_auth_method = 'none', client_secret_hash = NULL, require_pkce = false WHERE client_id = 'immo-mcp'"
refresh_relay
reject_wrapper client_policy_invalid
sql -d app -c "UPDATE oauth_clients SET require_pkce = true WHERE client_id = 'immo-mcp'"
refresh_relay
cp clients.csv clients.original
sed 's/prod-user-8/missing-preprod-owner/' clients.original > clients.csv
sha256sum users.csv webauthn.csv consents.csv clients.csv snapshot.csv > SHA256SUMS
sync -v dry_run=0
assert_sql "SELECT test_assert((SELECT owner_user_id IS NULL FROM oauth_clients WHERE client_id = 'immo-mcp'), 'absent owner safely becomes null')"
assert_sql 'UPDATE test_before SET state = test_state()'
mv clients.original clients.csv
printf 'tampered\n' >> clients.csv
reject_wrapper integrity_failed
refresh_relay
sync -v dry_run=0
assert_sql 'UPDATE test_before SET state = test_state()'
echo 'PASS: class downgrade fails closed; absent owner becomes null; client checksum rejects tampering'

stage=client-postconditions
sql -d preprod -c "CREATE FUNCTION test_client_tamper() RETURNS trigger LANGUAGE plpgsql AS \$\$ BEGIN NEW.name := 'unexpected'; RETURN NEW; END \$\$; CREATE TRIGGER test_client_tamper BEFORE INSERT OR UPDATE ON oauth_clients FOR EACH ROW EXECUTE FUNCTION test_client_tamper();"
sql -d app -c "UPDATE oauth_clients SET name = 'Changed immo' WHERE client_id = 'immo-mcp'"
refresh_relay
reject_wrapper client_postcondition_failed
sql -d preprod -c 'DROP TRIGGER test_client_tamper ON oauth_clients; DROP FUNCTION test_client_tamper();'
sql -d preprod -c "CREATE FUNCTION test_client_tamper() RETURNS trigger LANGUAGE plpgsql AS \$\$ BEGIN UPDATE oauth_clients SET name = 'unexpected' WHERE client_id = 'radar-immobilier-preprod'; RETURN NEW; END \$\$; CREATE TRIGGER test_client_tamper BEFORE INSERT OR UPDATE ON oauth_clients FOR EACH ROW WHEN (NEW.client_id = 'immo-mcp') EXECUTE FUNCTION test_client_tamper();"
reject_wrapper dv5_invariant_changed
sql -d preprod -c 'DROP TRIGGER test_client_tamper ON oauth_clients; DROP FUNCTION test_client_tamper();'
sql -d app -c "UPDATE oauth_clients SET name = 'Immo MCP', resource_indicators = ARRAY['https://immo.sent-tech.ca/mcp'] WHERE client_id = 'immo-mcp'"
refresh_relay
sync -v dry_run=0
grep -Fxq 'clients_upserted|0' /tmp/sql.log
grep -Fxq 'clients_removed|0' /tmp/sql.log
unchanged
assert_sql "SELECT test_assert(NOT EXISTS (SELECT FROM oauth_clients WHERE client_id = 'new-confidential'), 'confidential skip never creates a passwordless client')"
echo 'PASS: client configuration and unselected whole-row tampering roll back; final client rerun is 0/0'
