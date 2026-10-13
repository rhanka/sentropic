#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p .tmp
scratch=$(mktemp -d .tmp/tag-guard-test.XXXXXX)
trap 'rm -rf "$scratch"' EXIT

REAL_DOCKER="$(command -v docker || echo /usr/bin/docker)"
if [ ! -x "$REAL_DOCKER" ]; then
  echo "Error: docker binary not found at '$REAL_DOCKER'. Docker-First test execution requires docker." >&2
  exit 1
fi

cat > "$scratch/docker" <<MOCK
#!/usr/bin/env bash
set -euo pipefail
REAL_DOCKER="$REAL_DOCKER"
printf '%s\n' "\$*" >> "\$DOCKER_CALL_LOG"
case "\$1" in
  login|push) exit 0 ;;
  image) echo "\$MOCK_LOCAL_DIGEST"; exit 0 ;;
  manifest)
    case "\$GUARD_SCENARIO" in
      exists-different) printf '{"config":{"digest":"%s"}}\n' "\$MOCK_REMOTE_DIGEST"; exit 0 ;;
      exists-same) printf '{"config":{"digest":"%s"}}\n' "\$MOCK_LOCAL_DIGEST"; exit 0 ;;
      no-config-digest) printf '{"schemaVersion":2,"mediaType":"application/vnd.oci.image.index.v1+json","manifests":[{"mediaType":"application/vnd.oci.image.manifest.v1+json","digest":"sha256:1111111111111111111111111111111111111111111111111111111111111111"}]}\n'; exit 0 ;;
      absent) echo 'Error response from daemon: manifest unknown' >&2; exit 1 ;;
      stdout-manifest-unknown) echo 'Error response from daemon: manifest unknown'; exit 1 ;;
      case-variant-manifest-unknown) echo 'Error response from daemon: Manifest Unknown' >&2; exit 1 ;;
      auth-error) echo 'Error response from daemon: unauthorized: authentication required' >&2; exit 1 ;;
      credential-helper-not-found) echo 'error getting credentials - err: exec: "docker-credential-desktop": executable file not found in \$PATH' >&2; exit 1 ;;
      network-error) echo 'Get "https://registry.test.example/v2/": net/http: request canceled while waiting for connection (Client.Timeout exceeded)' >&2; exit 1 ;;
      *) echo "Unknown test scenario: \$GUARD_SCENARIO" >&2; exit 1 ;;
    esac ;;
  run)
    exec "\$REAL_DOCKER" "\$@"
    ;;
  *) echo "Unexpected docker command: \$*" >&2; exit 1 ;;
esac
MOCK
chmod +x "$scratch/docker"

LOCAL_DIGEST="sha256:0000000000000000000000000000000000000000000000000000000000000001"
REMOTE_DIGEST="sha256:9999999999999999999999999999999999999999999999999999999999999999"
TEST_RECEIPT="$scratch/api-image-id"
printf '%s\n' "$LOCAL_DIGEST" > "$TEST_RECEIPT"

run_guard() {
  local scenario="$1"
  local reg="${2-registry.test.example/sentropic}"
  local ver="${3-test-content-tag}"
  : > "$scratch/calls"; : > "$scratch/output"
  PATH="$PWD/$scratch:$PATH" DOCKER_CALL_LOG="$PWD/$scratch/calls" GUARD_SCENARIO="$scenario" \
  MOCK_LOCAL_DIGEST="$LOCAL_DIGEST" MOCK_REMOTE_DIGEST="$REMOTE_DIGEST" \
  API_IMAGE_RECEIPT="$TEST_RECEIPT" API_IMAGE_REF="$LOCAL_DIGEST" \
  MANIFEST_DIR="$scratch/manifests" API_VERSION="$ver" \
  REGISTRY="$reg" \
  make --no-print-directory publish-api-image REGISTRY="$reg" ENV="${ENV:-test-ci-tag-guard}" > "$scratch/output" 2>&1
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

test_stdout_manifest_unknown() {
  ! run_guard stdout-manifest-unknown || { echo "FAIL: stdout-manifest-unknown should fail" >&2; return 1; }
  grep -q "Cannot establish production registry tag identity" "$scratch/output" || { echo "FAIL: missing identity refusal" >&2; return 1; }
  ! grep -q "push .*sentropic-api:test-content-tag" "$scratch/calls" || { echo "FAIL: pushed on stdout-only manifest unknown" >&2; return 1; }
  echo "PASS: manifest unknown on stdout is not treated as absent (stderr-only isolation)"
}

test_case_variant_manifest_unknown() {
  ! run_guard case-variant-manifest-unknown || { echo "FAIL: case-variant-manifest-unknown should fail" >&2; return 1; }
  grep -q "Cannot establish production registry tag identity" "$scratch/output" || { echo "FAIL: missing identity refusal" >&2; return 1; }
  grep -q "Manifest Unknown" "$scratch/output" || { echo "FAIL: missing stderr case variant in output" >&2; return 1; }
  ! grep -q "push .*sentropic-api:test-content-tag" "$scratch/calls" || { echo "FAIL: pushed on case variant" >&2; return 1; }
  echo "PASS: case variant (Manifest Unknown) is not treated as absent (case-sensitive matching)"
}

test_auth_error() {
  ! run_guard auth-error || { echo "FAIL: auth-error should fail" >&2; return 1; }
  grep -q "Cannot establish production registry tag identity" "$scratch/output" || { echo "FAIL: missing identity refusal" >&2; return 1; }
  ! grep -q "push .*sentropic-api:test-content-tag" "$scratch/calls" || { echo "FAIL: pushed on auth error" >&2; return 1; }
  echo "PASS: registry error fails closed and never pushes"
}

test_credential_helper_not_found() {
  ! run_guard credential-helper-not-found || { echo "FAIL: credential-helper-not-found should fail" >&2; return 1; }
  grep -q "Cannot establish production registry tag identity" "$scratch/output" || { echo "FAIL: missing identity refusal" >&2; return 1; }
  grep -q "executable file not found" "$scratch/output" || { echo "FAIL: missing credential helper error output" >&2; return 1; }
  ! grep -q "push .*sentropic-api:test-content-tag" "$scratch/calls" || { echo "FAIL: pushed on credential helper error" >&2; return 1; }
  echo "PASS: credential-helper-not-found fails closed without treating not-found as absent"
}

test_network_error() {
  ! run_guard network-error || { echo "FAIL: network-error should fail" >&2; return 1; }
  grep -q "Cannot establish production registry tag identity" "$scratch/output" || { echo "FAIL: missing identity refusal" >&2; return 1; }
  grep -q "Client.Timeout exceeded" "$scratch/output" || { echo "FAIL: missing timeout error output" >&2; return 1; }
  ! grep -q "push .*sentropic-api:test-content-tag" "$scratch/calls" || { echo "FAIL: pushed on network error" >&2; return 1; }
  echo "PASS: network error fails closed and never pushes"
}

test_no_config_digest() {
  ! run_guard no-config-digest || { echo "FAIL: no-config-digest should fail" >&2; return 1; }
  grep -q "could not extract config digest from manifest" "$scratch/output" || { echo "FAIL: missing digest extraction error" >&2; return 1; }
  ! grep -q "push .*sentropic-api:test-content-tag" "$scratch/calls" || { echo "FAIL: pushed on missing config digest" >&2; return 1; }
  echo "PASS: existing manifest without config digest fails closed and never pushes"
}

test_empty_registry() {
  ! run_guard absent "" || { echo "FAIL: empty registry should fail" >&2; return 1; }
  grep -q "REGISTRY is not set" "$scratch/output" || { echo "FAIL: missing empty registry error" >&2; return 1; }
  ! grep -q "push " "$scratch/calls" || { echo "FAIL: pushed when registry empty" >&2; return 1; }
  echo "PASS: empty registry configuration fails closed and never pushes"
}

test_moving_tags() {
  ! run_guard absent "registry.test.example/sentropic" "main" || { echo "FAIL: moving tags should fail in publish-api-image" >&2; return 1; }
  grep -q "Cannot use publish-api-image for moving tag 'main'" "$scratch/output" || { echo "FAIL: missing moving tag refusal error" >&2; return 1; }
  ! grep -q "push .*sentropic-api:main" "$scratch/calls" || { echo "FAIL: moving tag pushed through publish-api-image" >&2; return 1; }
  echo "PASS: moving tags are rejected by publish-api-image and directed to publish-api-main-image"
}

case "${1:-all}" in
  exists-different) test_exists_different ;;
  exists-same) test_exists_same ;;
  absent) test_absent ;;
  stdout-manifest-unknown) test_stdout_manifest_unknown ;;
  case-variant-manifest-unknown) test_case_variant_manifest_unknown ;;
  auth-error) test_auth_error ;;
  credential-helper-not-found) test_credential_helper_not_found ;;
  network-error) test_network_error ;;
  no-config-digest) test_no_config_digest ;;
  empty-registry) test_empty_registry ;;
  moving-tags) test_moving_tags ;;
  all)
    test_exists_different
    test_exists_same
    test_absent
    test_stdout_manifest_unknown
    test_case_variant_manifest_unknown
    test_auth_error
    test_credential_helper_not_found
    test_network_error
    test_no_config_digest
    test_empty_registry
    test_moving_tags
    ;;
  *) echo "Expected exists-different, exists-same, absent, stdout-manifest-unknown, case-variant-manifest-unknown, auth-error, credential-helper-not-found, network-error, no-config-digest, empty-registry, moving-tags, or all" >&2; exit 1 ;;
esac
