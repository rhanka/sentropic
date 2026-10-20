#!/usr/bin/env bash
# Behavioral refusals run in a disposable root; never replace the user's .env.
set -euo pipefail
test_env="${1:?ENV argument is required}"
repo="$PWD"
mkdir -p "$repo/tmp"
fixture="$(mktemp -d "$repo/tmp/gw-make-contract.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT
cp Makefile "$fixture/Makefile"
mkdir -p "$fixture/tools/gateway-evolution"
cp tools/gateway-evolution/Makefile "$fixture/tools/gateway-evolution/Makefile"
cp tools/gateway-evolution/manifests/tool-only.json "$fixture/manifest.json"
cd "$fixture"
export API_VERSION=fixture UI_VERSION=fixture E2E_VERSION=fixture API_TOOL_VERSION=fixture
unset MAKEFLAGS MFLAGS COMPOSE_PROJECT_NAME API_PORT UI_PORT MAILDEV_UI_PORT
submake=(make --no-print-directory -f tools/gateway-evolution/Makefile)
expect_fail() {
  local description="$1"; shift
  if "$@" >probe.log 2>&1; then
    echo "FAIL: $description unexpectedly passed"; exit 1
  fi
  grep -qE 'ERROR|\*\*\*' probe.log
  echo "ok: $description refused"
}
expect_fail 'missing ENV' "${submake[@]}" gateway-harness-test MODE=pure ARTIFACT_MANIFEST=manifest.json
expect_fail 'ambient ENV' env ENV="$test_env" "${submake[@]}" gateway-harness-test MODE=pure ARTIFACT_MANIFEST=manifest.json
expect_fail 'project mismatch' "${submake[@]}" gateway-harness-test MODE=pure ARTIFACT_MANIFEST=manifest.json COMPOSE_PROJECT_NAME=other ENV="$test_env"
printf 'COMPOSE_PROJECT_NAME=%s\n' "$test_env" > .env
expect_fail '.env project override' "${submake[@]}" gateway-harness-test MODE=pure ARTIFACT_MANIFEST=manifest.json ENV="$test_env"
rm .env
expect_fail 'missing manifest' "${submake[@]}" gateway-harness-test MODE=pure ARTIFACT_MANIFEST=absent.json ENV="$test_env"
expect_fail 'missing explicit ports' "${submake[@]}" gateway-harness-test MODE=behavior ARTIFACT_MANIFEST=manifest.json ENV="$test_env"
expect_fail 'delivery row mismatch' "${submake[@]}" gateway-release-check DELIVERY=pr2 ARTIFACT_MANIFEST=manifest.json API_PORT=9600 UI_PORT=5800 MAILDEV_UI_PORT=1700 GATEWAY_PORT=19600 ENV="$test_env"
"${submake[@]}" -n ps ENV="$test_env" >probe.log
grep -q 'docker compose.* ps' probe.log
echo 'ok: root targets retained'
"${submake[@]}" -n gateway-harness-test MODE=behavior ARTIFACT_MANIFEST=manifest.json API_PORT=9600 UI_PORT=5800 MAILDEV_UI_PORT=1700 GATEWAY_PORT=19600 ENV="$test_env" >probe.log
grep -q 'make-contract.test.sh' probe.log
echo 'ok: behavior runs through Make'
