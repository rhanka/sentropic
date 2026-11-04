#!/bin/sh
# Preprod sync replacement selftest (a4-cm-gaps-r2 §9.2/§10.8): manifest gates of
# the identity-replica-sync runner. DB-less by construction: every bad relay must
# fail before any database handle opens. Run from the repo root:
#   sh deploy/ci/idp-identity-sync/selftest.sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/../../.." && pwd)
RUNNER="$ROOT/api/src/scripts/identity-replica-sync.ts"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT INT TERM

export CM_IDENTITY_DELETION_BUDGETS_JSON='{"reservation":{"deadlineMs":10000,"maxAttempts":1},"deletion":{"deadlineMs":10000,"maxAttempts":1},"diagnostic":{"deadlineMs":10000,"maxAttempts":1},"read":{"deadlineMs":10000,"maxAttempts":1},"workspace":{"deadlineMs":10000,"maxAttempts":1},"replicaExport":{"deadlineMs":10000,"maxAttempts":1},"replicaValidation":{"deadlineMs":10000,"maxAttempts":1},"replicaSync":{"deadlineMs":10000,"maxAttempts":1},"qualificationReceiptRef":"synthetic-selftest-only"}'
export MAX_SNAPSHOT_AGE_S=7200

pass=0; failed=0
expect_code() {
  want="$1"; shift
  dir="$1"; shift
  if (cd "$dir" && "$ROOT/api/node_modules/.bin/tsx" "$RUNNER" "$@" > /dev/null 2>&1); then got=0; else got=$?; fi
  if [ "$got" = "$want" ]; then pass=$((pass + 1)); else failed=$((failed + 1)); printf 'FAIL: want %s got %s in %s\n' "$want" "$got" "$dir" >&2; fi
}

good="$TMP/good"; mkdir -p "$good"
printf 'x' > "$good/identity-replica-batch.json"
printf 'id\n' > "$good/replica-users.csv"
printf 'user_id,client_id,tenant_id,scopes,created_at,updated_at\n' > "$good/consents.csv"
printf 'client_id\n' > "$good/clients.csv"
printf '2030-01-01T00:00:00.000Z,0,0,0,0\n' > "$good/snapshot.csv"
(cd "$good" && sha256sum identity-replica-batch.json replica-users.csv consents.csv clients.csv snapshot.csv > SHA256SUMS)

# 10 invalid_manifest: wrong file set / bad digest shape.
badset="$TMP/badset"; mkdir -p "$badset"
printf 'x' > "$badset/identity-replica-batch.json"
(cd "$badset" && sha256sum identity-replica-batch.json > SHA256SUMS)
expect_code 10 "$badset" --relay-dir="$badset"

# 12 stale_snapshot: well-formed relay, snapshot older than the age limit.
stale="$TMP/stale"; cp -r "$good/." "$stale/"
printf '2000-01-01T00:00:00.000Z,0,0,0,0\n' > "$stale/snapshot.csv"
(cd "$stale" && sha256sum identity-replica-batch.json replica-users.csv consents.csv clients.csv snapshot.csv > SHA256SUMS)
expect_code 12 "$stale" --relay-dir="$stale" --dry-run

# 14 empty_export: well-formed relay, zero accounts.
empty="$TMP/empty"; cp -r "$good/." "$empty/"
(cd "$empty" && sha256sum identity-replica-batch.json replica-users.csv consents.csv clients.csv snapshot.csv > SHA256SUMS)
expect_code 14 "$empty" --relay-dir="$empty" --dry-run

# 11 integrity_failed: tamper after signing.
tampered="$TMP/tampered"; cp -r "$good/." "$tampered/"
printf '2030-01-01T00:00:00.000Z,1,0,1,0\n' > "$tampered/snapshot.csv"
(cd "$good" && cp SHA256SUMS "$tampered/SHA256SUMS")
expect_code 11 "$tampered" --relay-dir="$tampered" --dry-run

printf 'selftest: %s passed, %s failed\n' "$pass" "$failed"
[ "$failed" = 0 ]
