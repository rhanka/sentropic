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
sql -d app -f "$prod/reader-role.sql"
sql -d app -c "DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'idp_identity_reader' AND rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AND NOT rolinherit AND rolconnlimit = 2 AND rolconfig @> ARRAY['default_transaction_read_only=on','statement_timeout=60s']) THEN RAISE EXCEPTION 'reader attributes'; END IF;
  IF (SELECT count(*) FROM information_schema.column_privileges WHERE grantee = 'idp_identity_reader' AND table_name = 'users') <> 13 OR (SELECT count(*) FROM information_schema.column_privileges WHERE grantee = 'idp_identity_reader' AND table_name = 'webauthn_credentials') <> 10 THEN RAISE EXCEPTION 'reader column grants'; END IF;
END \$\$;"
reject 'reader cannot read oauth clients' 'permission denied' -d app -U idp_identity_reader -c 'SELECT * FROM oauth_clients'
reject 'reader cannot write identities' 'read-only transaction' -d app -U idp_identity_reader -c "UPDATE users SET role = 'guest'"
stage=export
cd /tmp/relay
sql -d app -U idp_identity_reader -f "$prod/export-prod.sql"
IFS=, read -r snapshot users credentials < snapshot.csv
[ "$users" = 8 ] && [ "$credentials" = 18 ]
[ "$(wc -l < users.csv)" -eq 9 ] && [ "$(wc -l < webauthn.csv)" -eq 19 ]
echo 'PASS: read-only snapshot users=8 credentials=18'
pair='9f11d240-fc75-4d55-80be-1bafcd79eadb>1b9b9e15-2956-4df4-9ee1-a42273f0d096'
sync() { sql -d preprod -v expected_users="$users" -v expected_webauthn="$credentials" "$@" -f "$import"; }
unchanged() { assert_sql 'SELECT test_assert(test_state() = (SELECT state FROM test_before), '\''all state rolled back'\'')'; }
stage=dry-run
sync -v allowed_rekey="$pair"
grep -Fxq 'DRY RUN: rolled back' /tmp/sql.log
grep -Fxq 'rekeyed|1' /tmp/sql.log
grep -Fxq 'rekey_dropped_sessions|9' /tmp/sql.log
grep -Fxq 'rekey_moved_webauthn|8' /tmp/sql.log
grep -Fxq 'post_users|9' /tmp/sql.log
grep -Fxq 'post_webauthn|22' /tmp/sql.log
unchanged
sync -v dry_run=1 -v allowed_rekey="$pair"
unchanged
echo 'PASS: default and explicit dry-run rolled back; audit users=9 credentials=22 rekeyed=1 dropped_sessions=9'
reject 'empty rekey allowlist fails closed' 're-key not covered by allowed_rekey' -d preprod -v dry_run=0 -v expected_users=8 -v expected_webauthn=18 -f "$import"
unchanged
reject 'unknown rekey pair fails closed' 're-key not covered by allowed_rekey' -d preprod -v dry_run=0 -v allowed_rekey='unknown>unknown' -v expected_users=8 -v expected_webauthn=18 -f "$import"
unchanged
reject 'manifest mismatch fails closed' 'export row count does not match manifest' -d preprod -v expected_users=9 -v expected_webauthn=18 -f "$import"
unchanged
# Test-only trigger tampers inside the import transaction after inv_before is captured.
stage=install-dv5-tamper
sql -d preprod -c "CREATE FUNCTION test_tamper() RETURNS trigger LANGUAGE plpgsql AS \$\$ BEGIN UPDATE oauth_clients SET client_secret_hash = 'synthetic-tamper'; RETURN NEW; END \$\$; CREATE TRIGGER test_tamper BEFORE INSERT OR UPDATE ON users FOR EACH ROW EXECUTE FUNCTION test_tamper();"
reject 'DV5 tampering fails closed' 'post: DV5 invariant changed' -d preprod -v dry_run=0 -v allowed_rekey="$pair" -v expected_users=8 -v expected_webauthn=18 -f "$import"
unchanged
sql -d preprod -c 'DROP TRIGGER test_tamper ON users; DROP FUNCTION test_tamper();'
stage=commit
sync -v dry_run=0 -v allowed_rekey="$pair"
grep -Fxq COMMITTED /tmp/sql.log
sql -d preprod -f "$fixtures/assert-committed.sql"
assert_sql 'UPDATE test_before SET state = test_state()'
echo 'PASS: committed users=9 credentials=22 collisions=0; product FKs and DV5 preserved'
stage=idempotent-rerun
sync -v dry_run=0
grep -Fxq 'rekeyed|0' /tmp/sql.log
unchanged
echo 'PASS: rerun with empty allowlist is a no-op'
