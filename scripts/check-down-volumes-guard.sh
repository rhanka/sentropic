#!/usr/bin/env bash
# Assert the `make down-volumes` guard (BRDV-EX1, owner-approved 2026-11-02):
#   - ENV=dev, an empty ENV and any non test-*/e2e-* ENV are REFUSED with a clear
#     error, and no compose down command is ever printed or executed;
#   - test-*/e2e-* ENV values dry-run (`make -n`) to `down --volumes --remove-orphans`
#     on the same compose project as `make down`, ARTIFACTS_COMPOSE family included.
#
# Refusal cases really execute the target, but the guard is the first recipe line
# and exits 1 before any docker compose call, so no stack is ever touched.
# Allowed cases are asserted with `make -n` (dry-run) only.

set -euo pipefail

cd "$(dirname "$0")/.."

fail=0

note() { printf '%s\n' "$*"; }
err()  { printf '::error::%s\n' "$*"; fail=1; }

# expect_refused <label> <make-args...>
expect_refused() {
  local label="$1"; shift
  local out rc
  set +e
  out="$(make --no-print-directory down-volumes "$@" 2>&1)"
  rc=$?
  set -e
  if [ "$rc" -eq 0 ]; then
    err "$label: 'make down-volumes $*' unexpectedly SUCCEEDED"
    return
  fi
  if grep -q 'down --volumes' <<<"$out"; then
    err "$label: 'make down-volumes $*' failed but still printed a compose down command:"
    note "$out"
    return
  fi
  if ! grep -q 'refuses ENV=' <<<"$out"; then
    err "$label: 'make down-volumes $*' failed (rc=$rc) without the refusal message:"
    note "$out"
    return
  fi
  note "ok: $label refused (rc=$rc): $(grep 'refuses ENV=' <<<"$out" | head -1)"
}

# expect_dry_run <label> <expected-substring> <make-args...>
expect_dry_run() {
  local label="$1" want="$2"; shift 2
  local out rc
  set +e
  out="$(make --no-print-directory -n down-volumes "$@" 2>&1)"
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    err "$label: dry-run 'make -n down-volumes $*' failed (rc=$rc):"
    note "$out"
    return
  fi
  if ! grep -qF "$want" <<<"$out"; then
    err "$label: dry-run 'make -n down-volumes $*' does not contain '$want':"
    note "$out"
    return
  fi
  note "ok: $label dry-run contains '$want'"
}

# Refusals: dev, empty, and non-test names. None may print a compose command.
expect_refused 'ENV=dev'     ENV=dev
expect_refused 'empty ENV'   ENV=
expect_refused 'ENV=prod'    ENV=prod
expect_refused 'ENV=staging' ENV=staging

# Allowed: standard compose project (same files as `make down`), dry-run only.
expect_dry_run 'ENV=test-guard' 'docker-compose.test.yml down --volumes --remove-orphans' ENV=test-guard
expect_dry_run 'ENV=e2e-guard'  'docker-compose.test.yml down --volumes --remove-orphans' ENV=e2e-guard

# Allowed: ARTIFACTS_COMPOSE family (same ifneq selection as `make down`).
expect_dry_run 'ENV=test-mem-e10 (ARTIFACTS_COMPOSE family)' 'docker-compose.immo-861.yml down --volumes --remove-orphans' ENV=test-mem-e10

if [ "$fail" -ne 0 ]; then
  note "❌ down-volumes guard assertions FAILED."
  exit 1
fi
note "✅ down-volumes guard OK: empty/dev/non-test refused before any compose call; test-*/e2e-* dry-run 'down --volumes --remove-orphans' (ARTIFACTS_COMPOSE family included)."
