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
  snap_ts=$(date -u +'%Y-%m-%d %H:%M:%S')
  printf '%s,8,18,1,4\n' "$snap_ts" > snapshot.csv
  printf '{}\n' > identity-replica-batch.json
  sha256sum identity-replica-batch.json replica-users.csv consents.csv clients.csv snapshot.csv > SHA256SUMS
  { echo 'synced_accounts|8'; echo 'synced_credentials|18'; echo 'synced_consents|1'; echo 'DRY RUN: rolled back'; printf '{"outcome":"rolled_back","counts":{"synced_accounts":8,"synced_credentials":18,"synced_consents":1}}\n'; } > /work/cm-sync.log
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
