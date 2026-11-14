#!/bin/sh
# Container-only acceptance on the actual legacy migrations, no cluster.
set -eu
export PGDATA=/tmp/t3-pg PGHOST=/tmp PGUSER=postgres
trap 'su postgres -c '\''pg_ctl -D "$PGDATA" -m immediate stop'\'' >/dev/null 2>&1 || :' EXIT
mkdir -p "$PGDATA"; chown postgres:postgres "$PGDATA"
su postgres -c 'initdb -D "$PGDATA" --auth=trust' >/tmp/init.log 2>&1
su postgres -c 'pg_ctl -D "$PGDATA" -l /tmp/pg.log -o "-k /tmp -c listen_addresses=" -w start' >/tmp/start.log 2>&1
sql() { psql -XqAt -v ON_ERROR_STOP=1 "$@"; }
# The gate qualifies the prod minor only. Behind a floating tag the same image name once gave a newer
# minor, whose dumps carry column options the prod server refuses.
version=$(sql -c 'show server_version')
[ "$version" = "${T3_PG_VERSION:?}" ] || { echo "postgres_version_mismatch: server $version, expected $T3_PG_VERSION"; exit 1; }
case "$(pg_dump --version)" in *" $T3_PG_VERSION") ;; *) echo "postgres_version_mismatch: $(pg_dump --version)"; exit 1;; esac
echo "PASS: server and pg_dump are PostgreSQL $T3_PG_VERSION"
for migration in /migrations/*.sql; do sql -f "$migration" >/tmp/migrate.log 2>&1; done
sql -f /migrations/control/0013_oauth_refresh_tokens.sql >/tmp/migrate.log 2>&1
inspect() { sql -f /tests/cutover-applicability-v1.sql; }
baseline=$(inspect)
case "$baseline" in *'"ok": true'*) ;; *) echo applicability_failed; exit 1;; esac
# Ordinary ephemeral sessions and proofs are intentionally outside the durable projection.
sql -c "INSERT INTO settings (key,value) VALUES ('t3-plain','same')"
[ "$(inspect)" = "$baseline" ]
sql -c "INSERT INTO settings (key,value) VALUES ('t3-encrypted','enc:aaaa')"
encrypted=$(inspect)
[ "$encrypted" != "$baseline" ]
sql -c "UPDATE settings SET value='enc:bbbb' WHERE key='t3-encrypted'"
[ "$(inspect)" != "$encrypted" ]
sql -c "DELETE FROM settings WHERE key='t3-encrypted'"
[ "$(inspect)" = "$baseline" ]
sql -c "INSERT INTO settings (key,value) VALUES ('remote_session_revocation:t3','{}')"
[ "$(inspect)" != "$baseline" ]
sql -c "DELETE FROM settings WHERE key='remote_session_revocation:t3'"
sql -c 'CREATE SCHEMA control; CREATE TABLE control.event_outbox (id text,channel text,envelope jsonb,status text,created_at text)'
present=$(inspect)
sql -c "INSERT INTO control.event_outbox VALUES ('t3','connector_grant_events','{}','queued','now')"
[ "$(inspect)" != "$present" ]
# Full-byte stability in every encrypted store, including equal-length mutations.
for store in document_connector_accounts llm_provider_accounts; do
  if [ "$store" = document_connector_accounts ]; then
    sql -c "SET session_replication_role=replica; INSERT INTO document_connector_accounts(id,workspace_id,user_id,token_secret) VALUES ('t3-store','t3-workspace','t3-user','enc:aaaa')"
  else
    sql -c "INSERT INTO llm_provider_accounts(id,target_provider_id,transport_provider_id,token_secret) VALUES ('t3-store','synthetic','synthetic','enc:aaaa')"
  fi
  original=$(inspect)
  sql -c "UPDATE $store SET token_secret='enc:bbbb' WHERE id='t3-store'"
  [ "$(inspect)" != "$original" ]
  sql -c "DELETE FROM $store WHERE id='t3-store'"
done
sql -c 'CREATE TABLE control.connector_revocation_custody(custody_ref text,delivery_id text,connector_account_id text,provider text,envelope_version text,key_ref text,nonce text,ciphertext text,auth_tag text,created_at text)'
sql -c "INSERT INTO control.connector_revocation_custody VALUES ('t3','delivery','account','synthetic','1','ref','nonce','aaaa','tag','now')"
original=$(inspect)
sql -c "UPDATE control.connector_revocation_custody SET ciphertext='bbbb'"
[ "$(inspect)" != "$original" ]
sql -c 'DELETE FROM control.connector_revocation_custody'
echo 'PASS: all four encrypted stores detect same-length mutations'
sql -c "SET session_replication_role=replica; INSERT INTO authorization_codes(code,client_id,user_id,redirect_uri,scope,code_challenge,code_challenge_method,expires_at) VALUES ('t3-offline','t3-client','t3-user','https://app.restore-a4.test/callback','offline_access','aaaa','S256',now()+interval '1 hour')"
original=$(inspect)
sql -c "UPDATE authorization_codes SET code_challenge='bbbb' WHERE code='t3-offline'"
[ "$(inspect)" != "$original" ]
sql -c "DELETE FROM authorization_codes WHERE code='t3-offline'"
echo 'PASS: offline PKCE-only mutation changes durable applicability'
# Round-trip all schemas and real column/default ACLs through the delivered restore generator.
# Prod schema shape (rehearsal r9): pg_trgm keeps its types in public, and pg_dump empties search_path
# for the whole restore session, so a search_path-sensitive catalogue can never equal its P-0 capture.
sql -c 'CREATE EXTENSION pg_trgm'
# Objects that shadow pg_catalog when a session lists their schema first.
sql -c 'CREATE SCHEMA t3_shadow; CREATE FUNCTION t3_shadow.sha256(bytea) RETURNS bytea LANGUAGE sql AS $f$ SELECT $1 $f$; CREATE FUNCTION t3_shadow.second(text,text) RETURNS text LANGUAGE sql AS $f$ SELECT $2 $f$; CREATE OPERATOR t3_shadow.|| (LEFTARG=text, RIGHTARG=text, FUNCTION=t3_shadow.second)'
sql -c 'CREATE ROLE t3_reader; GRANT USAGE ON SCHEMA public TO t3_reader; GRANT SELECT (client_id) ON oauth_clients TO t3_reader; ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO t3_reader; CREATE SCHEMA artifacts; CREATE TABLE artifacts.t3_empty(id text)'
acl=$(sql -f /tests/t3-acl.sql)
for path in '' pg_catalog t3_shadow,pg_catalog,public; do
  [ "$(PGOPTIONS="-c search_path=$path" sql -f /tests/t3-acl.sql)" = "$acl" ] || { echo "acl_catalogue_search_path_dependent: $path"; exit 1; }
done
echo 'PASS: ACL catalogue is identical under the default, empty, pinned and shadowing search paths'
sed '/^SELECT pg_catalog\.encode/,$d' /tests/t3-acl.sql > /tmp/catalog.sql
echo 'SELECT * FROM entries ORDER BY kind,name;' >> /tmp/catalog.sql
sql -f /tmp/catalog.sql > /tmp/t3-catalog-before
# Schema-only dump without the per-run restrict key and server-stamped column options.
schema() { pg_dump --schema-only | sed '/^\\\(un\)\{0,1\}restrict /d; / SET (pg_attver=[0-9]*);$/d'; }
schema > /tmp/t3-schema-before
pg_dump --no-owner --no-privileges > /tmp/t3-source.sql
# pg_dump emits these fixture ACL statements on single lines; production uses the quote-aware parser.
pg_dump --schema-only | sed -n '/^ALTER .* OWNER TO /p; /^GRANT /p; /^REVOKE /p; /^ALTER DEFAULT PRIVILEGES /p' > /tmp/t3-acl.sql
sql -f /tests/t3-public-acl.sql >> /tmp/t3-acl.sql
sql -c 'CREATE SCHEMA cm_identity; CREATE TABLE cm_identity.after_commit(id text)'
sql --single-transaction -v baseline_acl="$acl" -f /restore.sql >/tmp/restore.log 2>&1 || { diff -u /tmp/t3-catalog-before /tmp/t3-catalog-after || :; tail -n 3 /tmp/restore.log; exit 1; }
[ "$(sql -f /tests/t3-acl.sql)" = "$acl" ]
schema > /tmp/t3-schema-after
diff /tmp/t3-schema-before /tmp/t3-schema-after >/dev/null || { echo restored_schema_differs; exit 1; }
echo 'PASS: full restore catalogue matches and the schema-only dump is identical'
if sql --single-transaction -v baseline_acl="$(printf '%064d' 0)" -f /restore.sql >/tmp/refuse.log 2>&1; then exit 1; fi
[ "$(sql -f /tests/t3-acl.sql)" = "$acl" ]
echo 'PASS: full multi-schema restore, column/default ACL parity, atomic refusal on mismatch'
sql -c 'DROP TABLE public.users CASCADE' >/tmp/drop.log 2>&1
case "$(inspect)" in *'"ok": false'*) ;; *) exit 1;; esac
echo 'PASS: real legacy SQL, optional relations, same-length ciphertext, remote and connector drift, missing sources'
