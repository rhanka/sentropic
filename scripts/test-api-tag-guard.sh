#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p .h2a/build
scratch=$(mktemp -d .h2a/build/tag-guard-test.XXXXXX)
trap 'rm -rf "$scratch"' EXIT

cat > "$scratch/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$DOCKER_CALL_LOG"
case "$1" in
  login|push) exit 0 ;;
  image) echo "$MOCK_LOCAL_DIGEST"; exit 0 ;;
  manifest)
    case "$GUARD_SCENARIO" in
      exists-different) printf '{"config":{"digest":"%s"}}\n' "$MOCK_REMOTE_DIGEST"; exit 0 ;;
      exists-same) printf '{"config":{"digest":"%s"}}\n' "$MOCK_LOCAL_DIGEST"; exit 0 ;;
      absent) echo 'Error response from daemon: manifest unknown' >&2; exit 1 ;;
      auth-error) echo 'Error response from daemon: unauthorized: authentication required' >&2; exit 1 ;;
      *) echo "Unknown test scenario: $GUARD_SCENARIO" >&2; exit 1 ;;
    esac ;;
  run) shift; while [ "$#" -gt 0 ]; do [ "$1" = node ] && { shift; exec node "$@"; }; shift; done; exit 0 ;;
  *) echo "Unexpected docker command: $*" >&2; exit 1 ;;
esac
MOCK
chmod +x "$scratch/docker"

LOCAL_DIGEST="sha256:0000000000000000000000000000000000000000000000000000000000000001"
REMOTE_DIGEST="sha256:9999999999999999999999999999999999999999999999999999999999999999"
TEST_RECEIPT="$scratch/api-image-id"
printf '%s\n' "$LOCAL_DIGEST" > "$TEST_RECEIPT"

run_guard() {
  : > "$scratch/calls"; : > "$scratch/output"
  PATH="$PWD/$scratch:$PATH" DOCKER_CALL_LOG="$PWD/$scratch/calls" GUARD_SCENARIO="$1" \
  MOCK_LOCAL_DIGEST="$LOCAL_DIGEST" MOCK_REMOTE_DIGEST="$REMOTE_DIGEST" \
  API_IMAGE_RECEIPT="$TEST_RECEIPT" API_IMAGE_REF="$LOCAL_DIGEST" \
  MANIFEST_DIR="$scratch/manifests" API_VERSION="test-content-tag" \
  REGISTRY="registry.test.example/sentropic" \
  make --no-print-directory publish-api-image ENV="${ENV:-test-ci-tag-guard}" > "$scratch/output" 2>&1
}

test_exists_different() {
  ! run_guard exists-different || { echo "FAIL: exists-different should fail" >&2; return 1; }
  grep -q "Production tag collision" "$scratch/output" || { echo "FAIL: missing collision error" >&2; return 1; }
  ! grep -q "push .*sentropic-api:test-content-tag" "$scratch/calls" || { echo "FAIL: pushed on collision" >&2; return 1; }
  echo "PASS: exists-different fails with clear collision message and never pushes"
}

test_exists_same() {
  run_guard exists-same || { cat "$scratch/output" >&2; echo "FAIL: exists-same should succeed" >&2; return 1; }
  grep -q "Skipping push idempotently" "$scratch/output" || { echo "FAIL: missing skip message" >&2; return 1; }
  ! grep -q "push .*sentropic-api:test-content-tag" "$scratch/calls" || { echo "FAIL: pushed on existing tag" >&2; return 1; }
  echo "PASS: exists-same skips push idempotently and never pushes"
}

test_absent() {
  run_guard absent || { cat "$scratch/output" >&2; echo "FAIL: absent should succeed" >&2; return 1; }
  grep -q "is absent from registry. Pushing..." "$scratch/output" || { echo "FAIL: missing push message" >&2; return 1; }
  grep -q "push registry.test.example/sentropic/sentropic-api:test-content-tag" "$scratch/calls" || { echo "FAIL: target not pushed" >&2; return 1; }
  echo "PASS: absent tag publishes successfully"
}

test_auth_error() {
  ! run_guard auth-error || { echo "FAIL: auth-error should fail" >&2; return 1; }
  grep -q "Cannot establish production registry tag identity" "$scratch/output" || { echo "FAIL: missing identity refusal" >&2; return 1; }
  ! grep -q "push .*sentropic-api:test-content-tag" "$scratch/calls" || { echo "FAIL: pushed on auth error" >&2; return 1; }
  echo "PASS: registry error fails closed and never pushes"
}

test_moving_tags() {
  : > "$scratch/calls"; : > "$scratch/output"
  PATH="$PWD/$scratch:$PATH" DOCKER_CALL_LOG="$PWD/$scratch/calls" GUARD_SCENARIO="absent" \
  MOCK_LOCAL_DIGEST="$LOCAL_DIGEST" MOCK_REMOTE_DIGEST="$REMOTE_DIGEST" \
  API_IMAGE_RECEIPT="$TEST_RECEIPT" API_IMAGE_REF="$LOCAL_DIGEST" \
  MANIFEST_DIR="$scratch/manifests" API_VERSION="main" \
  REGISTRY="registry.test.example/sentropic" \
  bash scripts/publish-api-image.sh > "$scratch/output" 2>&1
  grep -q "Moving tag detected" "$scratch/output" || { echo "FAIL: missing moving tag log" >&2; return 1; }
  grep -q "push registry.test.example/sentropic/sentropic-api:main" "$scratch/calls" || { echo "FAIL: moving tag not pushed" >&2; return 1; }
  echo "PASS: moving tags allow explicit updates without collision guard"
}

case "${1:-all}" in
  exists-different) test_exists_different ;;
  exists-same) test_exists_same ;;
  absent) test_absent ;;
  auth-error) test_auth_error ;;
  moving-tags) test_moving_tags ;;
  all) test_exists_different; test_exists_same; test_absent; test_auth_error; test_moving_tags ;;
  *) echo "Expected exists-different, exists-same, absent, auth-error, moving-tags, or all" >&2; exit 1 ;;
esac
