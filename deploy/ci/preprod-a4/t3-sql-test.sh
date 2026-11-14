#!/bin/sh
# Container-only acceptance on the actual legacy migrations, no cluster.
set -eu
export PGDATA=/tmp/t3-pg PGHOST=/tmp PGUSER=postgres
trap 'su postgres -c '\''pg_ctl -D "$PGDATA" -m immediate stop'\'' >/dev/null 2>&1 || :' EXIT
mkdir -p "$PGDATA"; chown postgres:postgres "$PGDATA"
su postgres -c 'initdb -D "$PGDATA" --auth=trust' >/tmp/init.log 2>&1
su postgres -c 'pg_ctl -D "$PGDATA" -l /tmp/pg.log -o "-k /tmp -c listen_addresses=" -w start' >/tmp/start.log 2>&1
sql() { psql -XqAt -v ON_ERROR_STOP=1 "$@"; }
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
# Round-trip all schemas and real column/default ACLs through the delivered restore generator.
sql -c 'CREATE ROLE t3_reader; GRANT SELECT (client_id) ON oauth_clients TO t3_reader; ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO t3_reader; CREATE SCHEMA artifacts; CREATE TABLE artifacts.t3_empty(id text)'
acl=$(sql -f /tests/t3-acl.sql)
pg_dump --no-owner --no-privileges > /tmp/t3-source.sql
# Fixture grants are intentionally narrow: production capture uses t3-acl.mjs.
cat > /tmp/t3-acl.sql <<'ACL'
GRANT SELECT (client_id) ON public.oauth_clients TO t3_reader;
ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO t3_reader;
ACL
sql -c 'CREATE SCHEMA cm_identity; CREATE TABLE cm_identity.after_commit(id text)'
sql --single-transaction -v baseline_acl="$acl" -f /restore.sql >/tmp/restore.log 2>&1 || { cat /tmp/restore.log; exit 1; }
[ "$(sql -f /tests/t3-acl.sql)" = "$acl" ]
if sql --single-transaction -v baseline_acl="$(printf '%064d' 0)" -f /restore.sql >/tmp/refuse.log 2>&1; then exit 1; fi
[ "$(sql -f /tests/t3-acl.sql)" = "$acl" ]
echo 'PASS: full multi-schema restore, column/default ACL parity, atomic refusal on mismatch'
sql -c 'DROP TABLE public.users CASCADE' >/tmp/drop.log 2>&1
case "$(inspect)" in *'"ok": false'*) ;; *) exit 1;; esac
echo 'PASS: real legacy SQL, optional relations, same-length ciphertext, remote and connector drift, missing sources'
