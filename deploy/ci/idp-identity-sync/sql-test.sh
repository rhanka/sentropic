#!/bin/sh
# Runs only inside the one-off postgres image, with no network or published ports.
set -eu
stage=bootstrap
trap 'code=$?; su postgres -c '\''pg_ctl -D "$PGDATA" -m immediate stop'\'' >/dev/null 2>&1 || :; [ "$code" -eq 0 ] || echo "FAIL: $stage (details withheld; IDs/counts only)"; exit "$code"' EXIT
export PGDATA=/tmp/idp-sync-pg PGHOST=/tmp PGUSER=postgres
mkdir -p "$PGDATA" /tmp/relay
chown postgres:postgres "$PGDATA"
su postgres -c 'initdb -D "$PGDATA" --auth=trust' >/tmp/init.log 2>&1
printf "listen_addresses = ''\n" >> "$PGDATA/postgresql.conf"
su postgres -c 'pg_ctl -D "$PGDATA" -l /tmp/postgres.log -o "-k /tmp" -w start' >/tmp/start.log 2>&1
sql() { psql -XAtq -v ON_ERROR_STOP=1 "$@" > /tmp/sql.log 2>&1; }
assert_sql() { sql -d preprod -c "$1"; }
reject() {
  stage=$1; expected=$2; shift 2
  if sql "$@"; then echo "FAIL: $stage unexpectedly succeeded"; exit 1; fi
  grep -Fq "$expected" /tmp/sql.log
  echo "PASS: $stage"
}
fixtures=/workspace/deploy/ci/idp-identity-sync/fixtures
prod=/workspace/deploy/k8s/overlays/prod/idp-identity-sync
import=/workspace/deploy/k8s/overlays/preprod/idp-identity-sync/import-preprod.sql
map=/workspace/deploy/k8s/overlays/preprod/idp-identity-sync/client-map.csv
stage=migrations
createdb identity_schema
for migration in /workspace/api/drizzle/*.sql; do sql -d identity_schema -f "$migration"; done
createdb -T identity_schema app
createdb -T identity_schema preprod
stage=fixtures
sql -d app -f "$fixtures/prod.sql"
sql -d preprod -f "$fixtures/preprod.sql" -f "$fixtures/assertions.sql"
echo 'PASS: migrations and baseline users=8/8 credentials=18/21'
reject 'reader rejects unset password' 'RO_PASSWORD env empty/unset' -d app -f "$prod/reader-role.sql"
RO_PASSWORD='' reject 'reader rejects empty password' 'RO_PASSWORD env empty/unset' -d app -f "$prod/reader-role.sql"
sql -d app -c "DO \$\$ BEGIN IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'idp_identity_reader') THEN RAISE EXCEPTION 'empty password created role'; END IF; END \$\$;"
# Generate disposable test credentials in-container; never stored in the repository or printed.
RO_PASSWORD=$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n'); export RO_PASSWORD
stage=reader-provisioning
sql -d app -f "$prod/reader-role.sql"
sql -d app -c 'GRANT SELECT (client_secret_hash) ON oauth_clients TO idp_identity_reader'
sql -d app -f "$prod/reader-role.sql"
sql -d app -c "DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'idp_identity_reader' AND rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AND NOT rolinherit AND rolconnlimit = 2 AND rolconfig @> ARRAY['default_transaction_read_only=on','statement_timeout=60s']) THEN RAISE EXCEPTION 'reader attributes'; END IF;
  IF (SELECT count(*) FROM information_schema.column_privileges WHERE grantee = 'idp_identity_reader' AND table_name = 'users') <> 13 OR (SELECT count(*) FROM information_schema.column_privileges WHERE grantee = 'idp_identity_reader' AND table_name = 'webauthn_credentials') <> 10 THEN RAISE EXCEPTION 'reader column grants'; END IF;
END \$\$;"
sql -d app -c "DO \$\$ BEGIN
  IF (SELECT count(*) FROM information_schema.column_privileges WHERE grantee = 'idp_identity_reader' AND table_name = 'oauth_clients') <> 14 OR (SELECT count(*) FROM information_schema.column_privileges WHERE grantee = 'idp_identity_reader' AND table_name = 'idp_oauth_client_secret_presence') <> 2 THEN RAISE EXCEPTION 'reader client grants'; END IF;
END \$\$;"
reject 'reader cannot read unexported client IDs' 'permission denied' -d app -U idp_identity_reader -c 'SELECT * FROM oauth_clients'
reject 'reader cannot read client secret hashes' 'permission denied' -d app -U idp_identity_reader -c 'SELECT client_secret_hash FROM oauth_clients'
sql -d app -U idp_identity_reader -c 'SELECT user_id, client_id, tenant_id, scopes, created_at, updated_at FROM oauth_consents'
sql -d app -c "DO \$\$ BEGIN IF (SELECT count(*) FROM information_schema.column_privileges WHERE grantee = 'idp_identity_reader' AND table_name = 'oauth_consents') <> 6 THEN RAISE EXCEPTION 'reader consent grants'; END IF; END \$\$;"
reject 'reader cannot write identities' 'read-only transaction' -d app -U idp_identity_reader -c "UPDATE users SET role = 'guest'"
stage=export
cd /tmp/relay
sql -d app -U idp_identity_reader -f "$prod/export-prod.sql"
IFS=, read -r snapshot users credentials consents clients < snapshot.csv
[ "$users" = 8 ] && [ "$credentials" = 18 ] && [ "$consents" = 1 ] && [ "$clients" = 4 ]
[ "$(wc -l < users.csv)" -eq 9 ] && [ "$(wc -l < webauthn.csv)" -eq 19 ]
[ "$(head -n 1 clients.csv)" = 'client_id,has_secret,name,redirect_uris,allowed_scopes,grant_types,response_types,token_endpoint_auth_method,dpop_bound_access_tokens,require_pkce,resource_indicators,tenant_id,owner_user_id,created_at,updated_at' ]
! grep -Fq -e 'synthetic-prod-hash' -e 'synthetic-new-prod-hash' -e 'prod-immo' -e 'prod-confidential' /tmp/relay/*
echo 'PASS: read-only snapshot users=8 credentials=18'
mkdir -p /sql
cp "$map" /sql/client-map.csv
for policy in host-map.csv client-policy.sql sync-clients.sql client-postcondition.sql; do
  cp "/workspace/deploy/k8s/overlays/preprod/idp-identity-sync/$policy" "/sql/$policy"
done
pair='9f11d240-fc75-4d55-80be-1bafcd79eadb>1b9b9e15-2956-4df4-9ee1-a42273f0d096'
sync() { sql -d preprod -v expected_users="$users" -v expected_webauthn="$credentials" -v expected_consents="$consents" -v expected_clients="$clients" -v allowed_clients="${SQL_CLIENTS-immo-mcp}" "$@" -f "$import"; }
unchanged() { assert_sql 'SELECT test_assert(test_state() = (SELECT state FROM test_before), '\''all state rolled back'\'')'; }
stage=dry-run
SQL_CLIENTS='' sync -v allowed_rekey="$pair"
grep -Fxq 'clients_upserted|0' /tmp/sql.log
unchanged
sync -v allowed_rekey="$pair"
grep -Fxq 'DRY RUN: rolled back' /tmp/sql.log
grep -Fxq 'rekeyed|1' /tmp/sql.log
grep -Fxq 'rekey_dropped_sessions|9' /tmp/sql.log
grep -Fxq 'rekey_moved_webauthn|8' /tmp/sql.log
grep -Fxq 'post_users|9' /tmp/sql.log
grep -Fxq 'post_webauthn|22' /tmp/sql.log
grep -Fxq 'consents_upserted|1' /tmp/sql.log
grep -Fxq 'consents_removed|1' /tmp/sql.log
unchanged
sync -v dry_run=1 -v allowed_rekey="unknown>unknown, $pair "
unchanged
echo 'PASS: default and explicit dry-run rolled back; audit users=9 credentials=22 rekeyed=1 dropped_sessions=9'
stage=pod-import-wrapper
mkdir -p /work /sql
ln -s "$import" /sql/import-preprod.sql
sha256sum users.csv webauthn.csv consents.csv clients.csv snapshot.csv > SHA256SUMS
refresh_relay() {
  sql -d app -U idp_identity_reader -f "$prod/export-prod.sql"
  IFS=, read -r snapshot users credentials consents clients < snapshot.csv
  sha256sum users.csv webauthn.csv consents.csv clients.csv snapshot.csv > SHA256SUMS
}
wrapper() {
  (
    export PGDATABASE=preprod DRY_RUN="${WRAPPER_DRY_RUN-1}" ALLOWED_REKEY="${WRAPPER_REKEY-$pair}" MAX_SNAPSHOT_AGE_S="${WRAPPER_AGE-7200}" ALLOWED_CLIENTS="${WRAPPER_CLIENTS-immo-mcp}"
    [ "${WRAPPER_UNSET_REKEY-0}" = 0 ] || unset ALLOWED_REKEY
    PATH="${WRAPPER_PATH-$PATH}" sh /workspace/deploy/k8s/overlays/preprod/idp-identity-sync/import-preprod.sh
  ) > /tmp/wrapper.log 2>&1
}
reject_wrapper() {
  stage="pod wrapper $1"
  if wrapper; then exit 1; fi
  extra=''
  [ "$1" != rekey_not_allowed ] || extra=",\"rejected_rekey_pairs\":[${WRAPPER_PAIRS-\"$pair\"}]"
  grep -Fxq "{\"outcome\":\"failed\",\"code\":\"$1\"$extra}" /dev/termination-log
  [ "$(cat /tmp/wrapper.log)" = "$1" ]
  unchanged
  echo "PASS: $stage"
}
wrapper
grep -Fq '"outcome":"rolled_back"' /dev/termination-log
grep -Fq '"post_users":9' /dev/termination-log
grep -Fq '"post_webauthn":22' /dev/termination-log
grep -Fq '"consents_upserted":1' /dev/termination-log
grep -Fq '"consents_removed":1' /dev/termination-log
grep -Fq '"old_id":"9f11d240-fc75-4d55-80be-1bafcd79eadb"' /dev/termination-log
unchanged
echo 'PASS: actual pod import wrapper emits safe rolled-back JSON audit'
cp /sql/client-map.csv map.original
mv /sql/client-map.csv map.absent
reject_wrapper sql_error
mv map.absent /sql/client-map.csv
for mode in missing duplicate shared_target empty zero_bytes; do
  cp "$map" /sql/client-map.csv
  case "$mode" in
    missing) sed 's/radar-immobilier-preprod/missing-client/' "$map" > /sql/client-map.csv ;;
    duplicate) tail -n 1 "$map" >> /sql/client-map.csv ;;
    shared_target) printf 'other-prod-client,radar-immobilier-preprod\n' >> /sql/client-map.csv ;;
    empty) head -n 1 "$map" > /sql/client-map.csv ;;
    zero_bytes) : > /sql/client-map.csv ;;
  esac
  reject_wrapper consent_client_missing
done
mv map.original /sql/client-map.csv
sql -d preprod -c "CREATE FUNCTION test_consent_tamper() RETURNS trigger LANGUAGE plpgsql AS \$\$ BEGIN NEW.scopes := ARRAY['unexpected']; RETURN NEW; END \$\$; CREATE TRIGGER test_consent_tamper BEFORE INSERT OR UPDATE ON oauth_consents FOR EACH ROW EXECUTE FUNCTION test_consent_tamper();"
reject_wrapper consent_postcondition_failed
sql -d preprod -c 'DROP TRIGGER test_consent_tamper ON oauth_consents; DROP FUNCTION test_consent_tamper();'
cp SHA256SUMS checksums.original
sed '/ consents.csv$/d' checksums.original > SHA256SUMS
reject_wrapper invalid_manifest
cp checksums.original SHA256SUMS
sha256sum /sql/client-map.csv | sed 's@/sql/@@' >> SHA256SUMS
reject_wrapper invalid_manifest
mv checksums.original SHA256SUMS
cp consents.csv consents.original
printf 'tampered\n' >> consents.csv
reject_wrapper integrity_failed
mv consents.original consents.csv
cp snapshot.csv snapshot.original
printf '%s,8,18,2,4\n' "$snapshot" > snapshot.csv
sha256sum users.csv webauthn.csv consents.csv clients.csv snapshot.csv > SHA256SUMS
reject_wrapper manifest_mismatch
mv snapshot.original snapshot.csv
sha256sum users.csv webauthn.csv consents.csv clients.csv snapshot.csv > SHA256SUMS
WRAPPER_DRY_RUN=invalid reject_wrapper invalid_dry_run
WRAPPER_AGE=invalid reject_wrapper invalid_age_limit
WRAPPER_UNSET_REKEY=1 reject_wrapper rekey_not_allowed
cp SHA256SUMS checksums.original
printf 'invalid manifest\n' > SHA256SUMS
reject_wrapper invalid_manifest
mv checksums.original SHA256SUMS
cp snapshot.csv snapshot.original
for ending in '' '\r\n'; do
  printf '%s,8,18,1,4%b' "$snapshot" "$ending" > snapshot.csv
  sha256sum users.csv webauthn.csv consents.csv clients.csv snapshot.csv > SHA256SUMS
  wrapper; grep -Fq '"outcome":"rolled_back"' /dev/termination-log; unchanged
done
printf '%s\r,8\r,18\r,1\r,4\r\n' "$snapshot" > snapshot.csv
sha256sum users.csv webauthn.csv consents.csv clients.csv snapshot.csv > SHA256SUMS
wrapper; grep -Fq '"outcome":"rolled_back"' /dev/termination-log; unchanged
echo 'PASS: snapshot EOF and trailing CR fields are accepted'
for code in invalid_counts invalid_timestamp; do
  if [ "$code" = invalid_counts ]; then printf '%s,8,18,invalid,4\n' "$snapshot"; else printf 'invalid,8,18,1,4\n'; fi > snapshot.csv
  sha256sum users.csv webauthn.csv consents.csv clients.csv snapshot.csv > SHA256SUMS
  reject_wrapper "$code"
done
mv snapshot.original snapshot.csv
for code in empty_export sql_error; do
  cp users.csv users.original
  if [ "$code" = empty_export ]; then head -n 1 users.original > users.csv; else printf 'private@example.invalid\n' >> users.csv; fi
  sha256sum users.csv webauthn.csv consents.csv clients.csv snapshot.csv > SHA256SUMS
  reject_wrapper "$code"
  mv users.original users.csv
done
sha256sum users.csv webauthn.csv consents.csv clients.csv snapshot.csv > SHA256SUMS
# Exercise safe classification and filtering without changing the import SQL.
mkdir -p /tmp/mock-bin
cat > /tmp/mock-bin/psql <<'MOCK'
#!/bin/sh
printf '%s\n' "${MOCK_STDERR:-}" >&2
[ "${MOCK_SUCCESS:-0}" = 1 ]
MOCK
chmod +x /tmp/mock-bin/psql
WRAPPER_PATH="/tmp/mock-bin:$PATH" MOCK_STDERR='ERROR:  canceling statement due to lock timeout' reject_wrapper lock_timeout
for text in 'a prod user id is missing' 'a prod email is not bound to its prod id' 'a prod credential is missing or bound to another user'; do
  WRAPPER_PATH="/tmp/mock-bin:$PATH" MOCK_STDERR="ERROR:  post: $text" reject_wrapper postcondition_failed
done
WRAPPER_PATH="/tmp/mock-bin:$PATH" MOCK_SUCCESS=1 reject_wrapper invalid_audit
pair2='00000000-0000-4000-8000-000000000003>00000000-0000-4000-8000-000000000004'
WRAPPER_PATH="/tmp/mock-bin:$PATH" sep=, MOCK_STDERR="ERROR:  re-key not covered by allowed_rekey: $pair,$pair2,00000000-0000-4000-8000-00000000000A>00000000-0000-4000-8000-00000000000B,private@example.invalid" WRAPPER_PAIRS="\"$pair\",\"$pair2\"" reject_wrapper rekey_not_allowed
WRAPPER_PATH="/tmp/mock-bin:$PATH" MOCK_STDERR='ERROR:  re-key not covered by allowed_rekey: private@example.invalid' WRAPPER_PAIRS='' reject_wrapper rekey_not_allowed
cp users.csv users.original
printf 'tampered\n' >> users.csv
reject_wrapper integrity_failed
mv users.original users.csv
echo 'PASS: pod wrapper rejects checksum tampering'
cp snapshot.csv snapshot.original
printf '2000-01-01 00:00:00,8,18,1,4\n' > snapshot.csv
sha256sum users.csv webauthn.csv consents.csv clients.csv snapshot.csv > SHA256SUMS
reject_wrapper stale_snapshot
mv snapshot.original snapshot.csv
sha256sum users.csv webauthn.csv consents.csv clients.csv snapshot.csv > SHA256SUMS
unchanged
echo 'PASS: pod wrapper rejects stale snapshot'
WRAPPER_REKEY='' reject_wrapper rekey_not_allowed
WRAPPER_REKEY='unknown>unknown' reject_wrapper rekey_not_allowed
cp snapshot.csv snapshot.original
printf '%s,9,18,1,4\n' "$snapshot" > snapshot.csv
sha256sum users.csv webauthn.csv consents.csv clients.csv snapshot.csv > SHA256SUMS
reject_wrapper manifest_mismatch
mv snapshot.original snapshot.csv
sha256sum users.csv webauthn.csv consents.csv clients.csv snapshot.csv > SHA256SUMS
reject 'empty rekey allowlist fails closed' 're-key not covered by allowed_rekey' -d preprod -v dry_run=0 -v expected_users=8 -v expected_webauthn=18 -v expected_consents=1 -v expected_clients=4 -f "$import"
unchanged
reject 'unknown rekey pair fails closed' 're-key not covered by allowed_rekey' -d preprod -v dry_run=0 -v allowed_rekey='unknown>unknown' -v expected_users=8 -v expected_webauthn=18 -v expected_consents=1 -v expected_clients=4 -f "$import"
unchanged
reject 'manifest mismatch fails closed' 'export row count does not match manifest' -d preprod -v expected_users=9 -v expected_webauthn=18 -v expected_consents=1 -v expected_clients=4 -f "$import"
unchanged
# Test-only trigger tampers inside the import transaction after inv_before is captured.
stage=install-dv5-tamper
sql -d preprod -c "CREATE FUNCTION test_tamper() RETURNS trigger LANGUAGE plpgsql AS \$\$ BEGIN UPDATE oauth_clients SET client_secret_hash = 'synthetic-tamper'; RETURN NEW; END \$\$; CREATE TRIGGER test_tamper BEFORE INSERT OR UPDATE ON users FOR EACH ROW EXECUTE FUNCTION test_tamper();"
reject_wrapper dv5_invariant_changed
reject 'DV5 tampering fails closed' 'post: DV5 invariant changed' -d preprod -v dry_run=0 -v allowed_rekey="$pair" -v expected_users=8 -v expected_webauthn=18 -v expected_consents=1 -v expected_clients=4 -f "$import"
unchanged
sql -d preprod -c 'DROP TRIGGER test_tamper ON users; DROP FUNCTION test_tamper();'
for mutation in "UPDATE oauth_clients SET name = 'synthetic-tamper'" "UPDATE id_token_signing_keys SET public_jwk = '{}'::jsonb"; do
  sql -d preprod -c "CREATE FUNCTION test_tamper() RETURNS trigger LANGUAGE plpgsql AS \$\$ BEGIN $mutation; RETURN NEW; END \$\$; CREATE TRIGGER test_tamper BEFORE INSERT OR UPDATE ON users FOR EACH ROW EXECUTE FUNCTION test_tamper();"
  reject 'whole-row DV5 tampering fails closed' 'post: DV5 invariant changed' -d preprod -v dry_run=0 -v allowed_rekey="$pair" -v expected_users=8 -v expected_webauthn=18 -v expected_consents=1 -v expected_clients=4 -f "$import"
  unchanged
  sql -d preprod -c 'DROP TRIGGER test_tamper ON users; DROP FUNCTION test_tamper();'
done
stage=commit
sync -v dry_run=0 -v allowed_rekey="$pair"
grep -Fxq COMMITTED /tmp/sql.log
sql -d preprod -f "$fixtures/assert-committed.sql"
psql -XAtq -v ON_ERROR_STOP=1 -d preprod -c "SELECT to_jsonb(c) FROM oauth_clients c WHERE client_id = 'immo-mcp'" > /acceptance/immo-client.json
assert_sql 'UPDATE test_before SET state = test_state()'
echo 'PASS: committed users=9 credentials=22 collisions=0; product FKs and DV5 preserved'
stage=idempotent-rerun
sync -v dry_run=0
grep -Fxq 'rekeyed|0' /tmp/sql.log
grep -Fxq 'consents_upserted|0' /tmp/sql.log
grep -Fxq 'consents_removed|0' /tmp/sql.log
unchanged
echo 'PASS: rerun with empty allowlist is a no-op'
WRAPPER_UNSET_REKEY=1 wrapper
grep -Fq '"rekeyed":0' /dev/termination-log
unchanged
echo 'PASS: unset allowlist remains valid without collisions'
stage=consent-scope-change
sql -d app -c "UPDATE oauth_consents SET scopes = ARRAY['openid'], updated_at = '2026-10-03'"
refresh_relay
wrapper
grep -Fq '"consents_upserted":1' /dev/termination-log
grep -Fq '"consents_removed":0' /dev/termination-log
unchanged
sync -v dry_run=0
assert_sql "SELECT test_assert((SELECT scopes = ARRAY['openid'] AND updated_at = '2026-10-03' FROM oauth_consents WHERE user_id = '1b9b9e15-2956-4df4-9ee1-a42273f0d096' AND client_id = 'radar-immobilier-preprod' AND tenant_id = 'sentropic'), 'prod scope change applied')"
assert_sql 'UPDATE test_before SET state = test_state()'
sync -v dry_run=0
grep -Fxq 'consents_upserted|0' /tmp/sql.log
grep -Fxq 'consents_removed|0' /tmp/sql.log
unchanged
echo 'PASS: consent scope change rolls back in dry-run, commits and reruns as 0/0'
stage=consent-tenant-and-revocation
sql -d app -c "INSERT INTO oauth_consents (user_id, client_id, tenant_id, scopes) VALUES ('1b9b9e15-2956-4df4-9ee1-a42273f0d096', 'radar-immobilier', 'other-tenant', ARRAY['openid', 'email'])"
refresh_relay
sync -v dry_run=0
assert_sql "SELECT test_assert((SELECT scopes = ARRAY['openid', 'email'] FROM oauth_consents WHERE user_id = '1b9b9e15-2956-4df4-9ee1-a42273f0d096' AND client_id = 'radar-immobilier-preprod' AND tenant_id = 'other-tenant'), 'consent tenant preserved')"
sql -d app -c "DELETE FROM oauth_consents WHERE tenant_id = 'sentropic'"
refresh_relay
sync -v dry_run=0
grep -Fxq 'consents_upserted|0' /tmp/sql.log
grep -Fxq 'consents_removed|1' /tmp/sql.log
assert_sql "SELECT test_assert(NOT EXISTS (SELECT FROM oauth_consents WHERE user_id = '1b9b9e15-2956-4df4-9ee1-a42273f0d096' AND client_id = 'radar-immobilier-preprod' AND tenant_id = 'sentropic'), 'prod revocation applied'); SELECT test_assert((SELECT count(*) FROM oauth_consents WHERE tenant_id = 'other-tenant') = 1, 'other tenant grant retained')"
assert_sql 'SELECT test_assert(test_dv5() = (SELECT dv5 FROM test_before), '\''protected clients, keys and grants unchanged'\'')'
echo 'PASS: tenant grants remain separate; prod revocation removes only its mapped grant'
. /workspace/deploy/ci/idp-identity-sync/clients-test.sh
