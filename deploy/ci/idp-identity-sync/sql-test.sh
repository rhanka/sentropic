#!/bin/sh
# Two-phase sync acceptance (a4-cm-gaps-r2 §9.2): the CM identity itself is
# converged by the replica-sync runner (covered by its own dry-run selftest);
# this suite fabricates the runner relay outputs and runs the SQL protocol leg
# for real. Runs only inside the one-off postgres image, with no network.
set -eu
stage=bootstrap
trap 'code=$?; su postgres -c '\''pg_ctl -D "$PGDATA" -m immediate stop'\'' >/dev/null 2>&1 || :; [ "$code" -eq 0 ] || echo "FAIL: $stage (details withheld; IDs/counts only)"; exit "$code"' EXIT
export PGDATA=/tmp/idp-sync-pg PGHOST=/tmp PGUSER=postgres
mkdir -p "$PGDATA" /tmp/relay
chown postgres:postgres "$PGDATA"
su postgres -c 'initdb -D "$PGDATA" --auth=trust' >/tmp/init.log 2>&1
printf "listen_addresses = ''\n" >> "$PGDATA/postgresql.conf"
su postgres -c 'pg_ctl -D "$PGDATA" -l /tmp/postgres.log -o "-k /tmp" -w start' >/tmp/start.log 2>&1
sql() { (
  for arg do
    if [ "$arg" = "$import" ]; then
      . /workspace/deploy/k8s/overlays/preprod/idp-identity-sync/workload-credential.sh
      prepare_workload_credential || { echo workload_credential_invalid >&2; exit 1; }
    fi
  done
  unset IMMO_MCP_WORKLOAD_CLIENT_SECRET
  psql -XAtq -v ON_ERROR_STOP=1 "$@"
) > /tmp/sql.log 2>&1; }
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
OWNER=1b9b9e15-2956-4df4-9ee1-a42273f0d096
FARID=efd67056-fb60-42e6-a386-6264c854da55
stage=migrations
createdb identity_schema
for migration in /workspace/api/drizzle/*.sql; do sql -d identity_schema -f "$migration"; done
sql -d identity_schema -f /workspace/api/drizzle/control/0013_oauth_refresh_tokens.sql
createdb -T identity_schema app
createdb -T identity_schema preprod
# Phase-1 schema stand-in: the CM sync runner converges cm_identity before the
# protocol phase runs. The test double carries the replica owner ids only; the
# real table is owned by the custody schema asset, never by this suite.
sql -d preprod -c 'CREATE SCHEMA IF NOT EXISTS cm_identity'
sql -d preprod -c 'CREATE TABLE cm_identity.identity_user_accounts (user_id text PRIMARY KEY)'
sql -d preprod -c "INSERT INTO cm_identity.identity_user_accounts VALUES ('prod-user-8')"
stage=fixtures
sql -d app -f "$fixtures/prod.sql"
sql -d preprod -f "$fixtures/preprod.sql" -f "$fixtures/assertions.sql"
echo 'PASS: migrations and protocol fixtures loaded'
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
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'idp_identity_reader' AND rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AND rolinherit AND rolconnlimit = 2 AND rolconfig @> ARRAY['default_transaction_read_only=on','statement_timeout=60s']) THEN RAISE EXCEPTION 'reader attributes'; END IF;
  IF (SELECT count(*) FROM information_schema.column_privileges WHERE grantee = 'idp_identity_reader' AND table_name = 'users') <> 0 OR (SELECT count(*) FROM information_schema.column_privileges WHERE grantee = 'idp_identity_reader' AND table_name = 'webauthn_credentials') <> 0 THEN RAISE EXCEPTION 'legacy identity grants must be revoked'; END IF;
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
mkdir -p /sql /work
cp "$prod/export-prod.sql" /sql/export-prod.sql
export_bundle() { PGDATABASE=app PGUSER=idp_identity_reader sh "$prod/export-prod.sh" > /tmp/export.log 2>&1; }
export_bundle
[ "$(head -n 1 consents.csv)" = 'user_id,client_id,tenant_id,scopes,created_at,updated_at' ]
[ "$(wc -l < consents.csv)" -eq 2 ]
[ "$(head -n 1 clients.csv)" = 'client_id,has_secret,name,redirect_uris,allowed_scopes,grant_types,response_types,token_endpoint_auth_method,dpop_bound_access_tokens,require_pkce,resource_indicators,tenant_id,owner_user_id,created_at,updated_at' ]
[ ! -e users.csv ] && [ ! -e webauthn.csv ] && [ ! -e snapshot.csv ]
! grep -Fq -e 'synthetic-prod-hash' -e 'synthetic-new-prod-hash' -e 'prod-immo' -e 'prod-confidential' -e 'synthetic-prod-workload-hash' /tmp/relay/*
echo 'PASS: protocol-only export consents=1 clients=4, no secrets, no runner files'
mkdir -p /sql
cp "$map" /sql/client-map.csv
for policy in workload-credential.sh host-map.csv client-policy.sql sync-clients.sql client-postcondition.sql service-policy.sql register-workload.sql sync-services.sql; do
  cp "/workspace/deploy/k8s/overlays/preprod/idp-identity-sync/$policy" "/sql/$policy"
done
# Runner relay fabrication (runner-unit-tested; the shell contract is real):
# five files, SHA256SUMS, and the phase-1 stdout log the wrapper consumes.
refresh_relay() {
  export_bundle
  { echo id; echo "$OWNER"; echo "$FARID"; for n in 3 4 5 6 7 8; do echo "prod-user-$n"; done; } > replica-users.csv
  consents=$(($(wc -l < consents.csv) - 1)); clients=$(($(wc -l < clients.csv) - 1))
  snap_ts=$(date -u +'%Y-%m-%d %H:%M:%S')
  printf '%s,8,18,%s,%s\n' "$snap_ts" "$consents" "$clients" > snapshot.csv
  printf '{}\n' > identity-replica-batch.json
  sha256sum identity-replica-batch.json replica-users.csv consents.csv clients.csv snapshot.csv > SHA256SUMS
  { echo 'synced_accounts|8'; echo 'synced_credentials|18'; echo "synced_consents|$consents"; echo 'DRY RUN: rolled back'; printf '{"outcome":"rolled_back","counts":{"synced_accounts":8,"synced_credentials":18,"synced_consents":%s}}\n' "$consents"; } > /work/cm-sync.log
  IFS=, read -r snap_ts accounts credentials consents clients < snapshot.csv
}
sync() { sql -d preprod -v expected_accounts="$accounts" -v expected_consents="$consents" -v expected_clients="$clients" -v allowed_clients="${SQL_CLIENTS-immo-mcp}" "$@" -f "$import"; }
unchanged() { assert_sql 'SELECT test_assert(test_state() = (SELECT state FROM test_before), '\''all state rolled back'\'')'; }
stage=dry-run
refresh_relay
sync
grep -Fxq 'consents_upserted|1' /tmp/sql.log
grep -Fxq 'consents_removed|1' /tmp/sql.log
grep -Fxq 'clients_upserted|1' /tmp/sql.log
grep -Fxq 'clients_removed|0' /tmp/sql.log
grep -Fxq 'clients_skipped_confidential|0' /tmp/sql.log
grep -Fxq 'services_upserted|1' /tmp/sql.log
grep -Fxq 'services_skipped_missing|0' /tmp/sql.log
unchanged
sync -v dry_run=1
grep -Fxq 'DRY RUN: rolled back' /tmp/sql.log
grep -Fxq 'consents_upserted|1' /tmp/sql.log
unchanged
echo 'PASS: default and explicit dry-run converge protocol rows and roll back'
stage=pod-import-wrapper
mkdir -p /work /sql
ln -s "$import" /sql/import-preprod.sql
refresh_relay
export_bundle
IFS=, read -r snapshot accounts credentials consents clients < snapshot.csv
wrapper() {
  (
    export PGDATABASE=preprod DRY_RUN="${WRAPPER_DRY_RUN-1}" MAX_SNAPSHOT_AGE_S="${WRAPPER_AGE-7200}" ALLOWED_CLIENTS="${WRAPPER_CLIENTS-immo-mcp}"
    PATH="${WRAPPER_PATH-$PATH}" sh /workspace/deploy/k8s/overlays/preprod/idp-identity-sync/import-preprod.sh
  ) > /tmp/wrapper.log 2>&1
}
reject_wrapper() {
  stage="pod wrapper $1"
  if wrapper; then exit 1; fi
  grep -Fxq "{\"outcome\":\"failed\",\"code\":\"$1\"}" /dev/termination-log
  [ "$(cat /tmp/wrapper.log)" = "$1" ]
  unchanged
  echo "PASS: $stage"
}
wrapper
grep -Fq '"outcome":"rolled_back"' /dev/termination-log
grep -Fq '"consents_upserted":1' /dev/termination-log
grep -Fq '"consents_removed":1' /dev/termination-log
grep -Fq '"clients_upserted":1' /dev/termination-log
grep -Fq '"services_upserted":1' /dev/termination-log
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
for file in replica-users.csv consents.csv clients.csv snapshot.csv identity-replica-batch.json; do
  sed "/ $file\$/d" checksums.original > SHA256SUMS
  reject_wrapper invalid_manifest
done
cp checksums.original SHA256SUMS
sed -n '/ clients.csv$/p' checksums.original >> SHA256SUMS
reject_wrapper invalid_manifest
cp checksums.original SHA256SUMS
sha256sum /sql/client-map.csv | sed 's@/sql/@@' >> SHA256SUMS
reject_wrapper invalid_manifest
cp checksums.original SHA256SUMS
cp consents.csv consents.original
printf 'tampered\n' >> consents.csv
reject_wrapper integrity_failed
mv consents.original consents.csv
cp snapshot.csv snapshot.original
printf '%s,8,18,2,4\n' "$snap_ts" > snapshot.csv
sha256sum identity-replica-batch.json replica-users.csv consents.csv clients.csv snapshot.csv > SHA256SUMS
reject_wrapper manifest_mismatch
mv snapshot.original snapshot.csv
sha256sum identity-replica-batch.json replica-users.csv consents.csv clients.csv snapshot.csv > SHA256SUMS
WRAPPER_DRY_RUN=invalid reject_wrapper invalid_dry_run
WRAPPER_AGE=invalid reject_wrapper invalid_age_limit
cp SHA256SUMS checksums.original
printf 'invalid manifest\n' > SHA256SUMS
reject_wrapper invalid_manifest
mv checksums.original SHA256SUMS
cp snapshot.csv snapshot.original
for ending in '' '\r\n'; do
  printf '%s,8,18,1,4%b' "$snap_ts" "$ending" > snapshot.csv
  sha256sum identity-replica-batch.json replica-users.csv consents.csv clients.csv snapshot.csv > SHA256SUMS
  wrapper; grep -Fq '"outcome":"rolled_back"' /dev/termination-log; unchanged
done
printf '%s\r,8\r,18\r,1\r,4\r\n' "$snap_ts" > snapshot.csv
sha256sum identity-replica-batch.json replica-users.csv consents.csv clients.csv snapshot.csv > SHA256SUMS
wrapper; grep -Fq '"outcome":"rolled_back"' /dev/termination-log; unchanged
echo 'PASS: snapshot EOF and trailing CR fields are accepted'
for code in invalid_counts invalid_timestamp; do
  if [ "$code" = invalid_counts ]; then printf '%s,8,18,invalid,4\n' "$snap_ts"; else printf 'invalid,8,18,1,4\n'; fi > snapshot.csv
  sha256sum identity-replica-batch.json replica-users.csv consents.csv clients.csv snapshot.csv > SHA256SUMS
  reject_wrapper "$code"
done
mv snapshot.original snapshot.csv
sha256sum identity-replica-batch.json replica-users.csv consents.csv clients.csv snapshot.csv > SHA256SUMS
for code in empty_export sql_error; do
  if [ "$code" = empty_export ]; then
    cp replica-users.csv replica-users.original
    head -n 1 replica-users.original > replica-users.csv
  else
    cp consents.csv consents.original
    printf 'private@example.invalid\n' >> consents.csv
  fi
  sha256sum identity-replica-batch.json replica-users.csv consents.csv clients.csv snapshot.csv > SHA256SUMS
  reject_wrapper "$code"
  if [ "$code" = empty_export ]; then mv replica-users.original replica-users.csv; else mv consents.original consents.csv; fi
done
sha256sum identity-replica-batch.json replica-users.csv consents.csv clients.csv snapshot.csv > SHA256SUMS
# Exercise safe classification and filtering without changing the import SQL.
mkdir -p /tmp/mock-bin
cat > /tmp/mock-bin/psql <<'MOCK'
#!/bin/sh
printf '%s\n' "${MOCK_STDERR:-}" >&2
[ "${MOCK_SUCCESS:-0}" = 1 ]
MOCK
chmod +x /tmp/mock-bin/psql
WRAPPER_PATH="/tmp/mock-bin:$PATH" MOCK_STDERR='ERROR:  canceling statement due to lock timeout' reject_wrapper lock_timeout
WRAPPER_PATH="/tmp/mock-bin:$PATH" MOCK_SUCCESS=1 reject_wrapper invalid_audit
cp replica-users.csv replica-users.original
printf 'tampered\n' >> replica-users.csv
reject_wrapper integrity_failed
mv replica-users.original replica-users.csv
echo 'PASS: pod wrapper rejects checksum tampering'
cp snapshot.csv snapshot.original
printf '2000-01-01 00:00:00,8,18,1,4\n' > snapshot.csv
sha256sum identity-replica-batch.json replica-users.csv consents.csv clients.csv snapshot.csv > SHA256SUMS
reject_wrapper stale_snapshot
mv snapshot.original snapshot.csv
sha256sum identity-replica-batch.json replica-users.csv consents.csv clients.csv snapshot.csv > SHA256SUMS
unchanged
echo 'PASS: pod wrapper rejects stale snapshot'
cp snapshot.csv snapshot.original
printf '%s,9,18,1,4\n' "$snap_ts" > snapshot.csv
sha256sum identity-replica-batch.json replica-users.csv consents.csv clients.csv snapshot.csv > SHA256SUMS
reject_wrapper manifest_mismatch
mv snapshot.original snapshot.csv
sha256sum identity-replica-batch.json replica-users.csv consents.csv clients.csv snapshot.csv > SHA256SUMS
reject 'manifest mismatch fails closed' 'export row count does not match manifest' -d preprod -v dry_run=0 -v expected_accounts=9 -v expected_consents=1 -v expected_clients=4 -v allowed_clients=immo-mcp -f "$import"
unchanged
stage=install-dv5-tamper
sql -d preprod -c "CREATE FUNCTION test_tamper() RETURNS trigger LANGUAGE plpgsql AS \$\$ BEGIN UPDATE oauth_clients SET client_secret_hash = 'synthetic-tamper' WHERE client_id = 'synthetic-client'; RETURN NEW; END \$\$; CREATE TRIGGER test_tamper BEFORE INSERT OR UPDATE ON oauth_consents FOR EACH ROW EXECUTE FUNCTION test_tamper();"
reject_wrapper dv5_invariant_changed
reject 'DV5 tampering fails closed' 'post: DV5 invariant changed' -d preprod -v dry_run=0 -v expected_accounts=8 -v expected_consents=1 -v expected_clients=4 -v allowed_clients=immo-mcp -f "$import"
unchanged
sql -d preprod -c 'DROP TRIGGER test_tamper ON oauth_consents; DROP FUNCTION test_tamper();'
sql -d preprod -c "CREATE FUNCTION test_tamper() RETURNS trigger LANGUAGE plpgsql AS \$\$ BEGIN UPDATE oauth_clients SET name = 'synthetic-tamper' WHERE client_id = 'synthetic-client'; RETURN NEW; END \$\$; CREATE TRIGGER test_tamper BEFORE INSERT OR UPDATE ON oauth_consents FOR EACH ROW EXECUTE FUNCTION test_tamper();"
reject 'non-desired-row tampering fails DV5' 'post: DV5 invariant changed' -d preprod -v dry_run=0 -v expected_accounts=8 -v expected_consents=1 -v expected_clients=4 -v allowed_clients=immo-mcp -f "$import"
unchanged
sql -d preprod -c 'DROP TRIGGER test_tamper ON oauth_consents; DROP FUNCTION test_tamper();'
sql -d preprod -c "CREATE FUNCTION test_tamper() RETURNS trigger LANGUAGE plpgsql AS \$\$ BEGIN UPDATE oauth_clients SET redirect_uris = ARRAY['https://tampered.example.invalid/callback'] WHERE client_id = 'immo-mcp'; RETURN NEW; END \$\$; CREATE TRIGGER test_tamper BEFORE INSERT OR UPDATE ON oauth_consents FOR EACH ROW EXECUTE FUNCTION test_tamper();"
reject 'converged-config tampering fails the client postcondition' 'client post-condition failed' -d preprod -v dry_run=0 -v expected_accounts=8 -v expected_consents=1 -v expected_clients=4 -v allowed_clients=immo-mcp -f "$import"
unchanged
sql -d preprod -c 'DROP TRIGGER test_tamper ON oauth_consents; DROP FUNCTION test_tamper();'
sql -d preprod -c "CREATE FUNCTION test_tamper() RETURNS trigger LANGUAGE plpgsql AS \$\$ BEGIN UPDATE id_token_signing_keys SET public_jwk = '{}'::jsonb; RETURN NEW; END \$\$; CREATE TRIGGER test_tamper BEFORE INSERT OR UPDATE ON oauth_consents FOR EACH ROW EXECUTE FUNCTION test_tamper();"
reject 'signing-key tampering fails closed' 'post: DV5 invariant changed' -d preprod -v dry_run=0 -v expected_accounts=8 -v expected_consents=1 -v expected_clients=4 -v allowed_clients=immo-mcp -f "$import"
unchanged
sql -d preprod -c 'DROP TRIGGER test_tamper ON oauth_consents; DROP FUNCTION test_tamper();'
