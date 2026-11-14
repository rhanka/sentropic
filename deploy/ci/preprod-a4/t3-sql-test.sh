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
sql -c 'DROP TABLE public.users CASCADE' >/tmp/drop.log 2>&1
case "$(inspect)" in *'"ok": false'*) ;; *) exit 1;; esac
echo 'PASS: real legacy SQL, optional relations, same-length ciphertext, remote and connector drift, missing sources'
