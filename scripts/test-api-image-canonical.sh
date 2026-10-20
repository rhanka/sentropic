#!/usr/bin/env bash
set -euo pipefail
# Canonical API image artifact tests (fix/api-image-canonical-artifact).
#
# Packet cases:
# 1. global-only change with existing tag -> resolve reuses, no collision
# 2. runtime change -> new tag (tag inputs cover every shipped build input)
# 3. same tag with different identity -> still refused by the guard
cd "$(dirname "$0")/.."
mkdir -p .tmp
scratch=$(mktemp -d .tmp/canonical-test.XXXXXX)
trap 'rm -rf "$scratch"' EXIT

REAL_DOCKER="$(command -v docker || echo /usr/bin/docker)"
if [ ! -x "$REAL_DOCKER" ]; then
  echo "Error: docker binary not found at '$REAL_DOCKER'. Docker-First test execution requires docker." >&2
  exit 1
fi

cat > "$scratch/docker" <<MOCK
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "\$*" >> "\$DOCKER_CALL_LOG"
case "\$1" in
  login|push|pull) exit 0 ;;
  image) echo "\$MOCK_LOCAL_DIGEST"; exit 0 ;;
  manifest)
    case "\$RESOLVE_SCENARIO" in
      exists) printf '{"config":{"digest":"%s"}}\n' "\$MOCK_REMOTE_DIGEST"; exit 0 ;;
      exists-different) printf '{"config":{"digest":"%s"}}\n' "\$MOCK_OTHER_DIGEST"; exit 0 ;;
      absent) echo 'Error response from daemon: manifest unknown' >&2; exit 1 ;;
      auth-error) echo 'Error response from daemon: unauthorized: authentication required' >&2; exit 1 ;;
      network-error) echo 'Get "https://registry.test.example/v2/": net/http: request canceled while waiting for connection (Client.Timeout exceeded)' >&2; exit 1 ;;
      stdout-unknown) echo 'Error response from daemon: manifest unknown'; exit 1 ;;
      *) echo "Unknown resolve scenario: \$RESOLVE_SCENARIO" >&2; exit 1 ;;
    esac ;;
  run)
    exec "$REAL_DOCKER" "\$@"
    ;;
  *) echo "Unexpected docker command: \$*" >&2; exit 1 ;;
esac
MOCK
chmod +x "$scratch/docker"

cat > "$scratch/fake-compose" <<'COMPOSE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$DOCKER_CALL_LOG"
exit 0
COMPOSE
chmod +x "$scratch/fake-compose"

PULLED_DIGEST="sha256:0000000000000000000000000000000000000000000000000000000000000001"
OTHER_DIGEST="sha256:9999999999999999999999999999999999999999999999999999999999999999"
TEST_TAG="fa56b6"
TEST_REGISTRY="registry.test.example/sentropic"

run_resolve() {
  local scenario="$1"
  local registry="${2-$TEST_REGISTRY}"
  : > "$scratch/calls"; : > "$scratch/output"
  rm -rf "$scratch/resolve"
  PATH="$PWD/$scratch:$PATH" DOCKER_CALL_LOG="$PWD/$scratch/calls" RESOLVE_SCENARIO="$scenario" \
    MOCK_LOCAL_DIGEST="$PULLED_DIGEST" MOCK_REMOTE_DIGEST="$PULLED_DIGEST" MOCK_OTHER_DIGEST="$OTHER_DIGEST" \
    REGISTRY="$registry" API_IMAGE_NAME="sentropic-api" API_VERSION="$TEST_TAG" \
    API_IMAGE_RECEIPT="$PWD/$scratch/resolve/api-image-id" MANIFEST_DIR="$PWD/$scratch/resolve" \
    DOCKER_COMPOSE="$PWD/$scratch/fake-compose" \
    bash scripts/resolve-api-image.sh > "$scratch/output" 2>&1
}

resolve_reuse() {
  run_resolve exists || { cat "$scratch/output" >&2; echo "FAIL: reuse should succeed" >&2; return 1; }
  grep -q "no rebuild" "$scratch/output" || { echo "FAIL: missing no-rebuild message" >&2; return 1; }
  grep -q "pull $TEST_REGISTRY/sentropic-api:$TEST_TAG" "$scratch/calls" || { echo "FAIL: existing tag was not pulled" >&2; return 1; }
  grep -q "build " "$scratch/calls" && { echo "FAIL: rebuilt despite existing tag" >&2; return 1; }
  test -f "$scratch/resolve/api-image-id" || { echo "FAIL: receipt not recorded" >&2; return 1; }
  test "$(cat "$scratch/resolve/api-image-id")" = "$PULLED_DIGEST" || { echo "FAIL: receipt is not the pulled artifact" >&2; return 1; }
  echo "PASS: existing canonical tag is pulled, recorded, and never rebuilt (global-only reuse)"
}

resolve_absent() {
  run_resolve absent || { cat "$scratch/output" >&2; echo "FAIL: absent should succeed" >&2; return 1; }
  grep -q "absent from registry" "$scratch/output" || { echo "FAIL: missing absent message" >&2; return 1; }
  grep -q "build --no-cache api" "$scratch/calls" || { echo "FAIL: absent tag did not trigger a build" >&2; return 1; }
  test -f "$scratch/resolve/api-image-id" || { echo "FAIL: receipt not recorded after build" >&2; return 1; }
  echo "PASS: absent canonical tag builds once and records the new artifact (runtime-change path)"
}

resolve_local() {
  run_resolve absent "" || { cat "$scratch/output" >&2; echo "FAIL: local mode should succeed" >&2; return 1; }
  grep -q "No REGISTRY configured" "$scratch/output" || { echo "FAIL: missing local-mode message" >&2; return 1; }
  grep -q "build --no-cache api" "$scratch/calls" || { echo "FAIL: local mode did not build" >&2; return 1; }
  echo "PASS: empty REGISTRY keeps the historical local build"
}

resolve_fail_closed() {
  local scenario="$1"
  ! run_resolve "$scenario" || { echo "FAIL: $scenario should fail" >&2; return 1; }
  grep -q "refusing to build" "$scratch/output" || { echo "FAIL: missing fail-closed refusal for $scenario" >&2; return 1; }
  grep -q "build " "$scratch/calls" && { echo "FAIL: built on $scenario" >&2; return 1; }
  test ! -f "$scratch/resolve/api-image-id" || { echo "FAIL: receipt recorded on $scenario" >&2; return 1; }
  echo "PASS: $scenario fails closed without building or recording"
}

guard_collision() {
  : > "$scratch/calls"; : > "$scratch/output"
  rm -rf "$scratch/guard"
  mkdir -p "$scratch/guard"
  printf '%s\n' "$PULLED_DIGEST" > "$scratch/guard/api-image-id"
  ! PATH="$PWD/$scratch:$PATH" DOCKER_CALL_LOG="$PWD/$scratch/calls" RESOLVE_SCENARIO="exists-different" \
    MOCK_LOCAL_DIGEST="$PULLED_DIGEST" MOCK_REMOTE_DIGEST="$PULLED_DIGEST" MOCK_OTHER_DIGEST="$OTHER_DIGEST" \
    API_IMAGE_RECEIPT="$PWD/$scratch/guard/api-image-id" API_IMAGE_REF="$PULLED_DIGEST" \
    MANIFEST_DIR="$PWD/$scratch/guard" API_VERSION="$TEST_TAG" \
    REGISTRY="$TEST_REGISTRY" \
    bash scripts/publish-api-image.sh > "$scratch/output" 2>&1 || { echo "FAIL: collision should fail" >&2; return 1; }
  grep -q "Production tag collision" "$scratch/output" || { echo "FAIL: missing collision error" >&2; return 1; }
  ! grep -q "^push " "$scratch/calls" || { echo "FAIL: pushed on collision" >&2; return 1; }
  echo "PASS: same tag with different identity is still refused and never pushed"
}

hash_inputs() {
  sed -n 's/^export API_VERSION[[:space:]]*?=.*echo "\([^"]*\)".*/\1/p' Makefile | tr ' ' '\n' | sed '/^$/d'
}

tag_inputs_cover_builds() {
  local inputs missing=0 workspace
  inputs="$(hash_inputs)"
  test -n "$inputs" || { echo "FAIL: could not read API_VERSION inputs from Makefile" >&2; return 1; }
  while IFS= read -r line; do
    case "$line" in
      *"--workspace @sentropic/"*" run build"*)
        workspace="${line##*--workspace @sentropic/}"
        workspace="packages/${workspace%% *}"
        if ! grep -Fxq "$workspace" <<< "$inputs"; then
          echo "FAIL: Dockerfile builds $workspace but API_VERSION does not hash it" >&2
          missing=1
        fi
        ;;
    esac
  done < <(grep -o 'npm --workspace @sentropic/[a-z0-9-]* run build' api/Dockerfile)
  test "$missing" -eq 0 || return 1
  for required in api apps/auth-idp apps/llm-gateway e2e/tests/fixtures packages/auth-ui packages/skills packages/mcp-platform packages/llm-gateway .security/audit-gate.mjs .security/audit-allowlist.json .dockerignore package.json package-lock.json; do
    grep -Fxq "$required" <<< "$inputs" || { echo "FAIL: shipped build input '$required' missing from API_VERSION" >&2; return 1; }
  done
  echo "PASS: every shipped build input is hashed into the canonical tag (runtime change -> new tag)"
}

tag_inputs_exclude_global() {
  local inputs
  inputs="$(hash_inputs)"
  local global_paths=(
    Makefile .github/workflows/ci.yml scripts/publish-api-image.sh scripts/resolve-api-image.sh
    tools spec plan docs rules track deploy BRANCH.md
    ui/src e2e/tests
    packages/chat-ui packages/cited-source-viewer packages/cowork-bridge packages/cowork-desktop
    packages/harness packages/mcp-broker packages/mcp-connector-github
  )
  local path input bad=0
  for path in "${global_paths[@]}"; do
    while IFS= read -r input; do
      [ -n "$input" ] || continue
      if [ "$input" = "$path" ] || [[ "$path" == "$input"/* ]]; then
        echo "FAIL: global-only path '$path' is covered by tag input '$input'" >&2
        bad=1
      fi
    done <<< "$inputs"
  done
  test "$bad" -eq 0 || return 1
  # .dockerignore entries are matched structurally (exact-line); the negation
  # semantics (e2e/* + !e2e/package.json) are verified separately against the
  # real builder, since git check-ignore reads .gitignore, not .dockerignore.
  local ignored=(
    Makefile BRANCH.md .github/ scripts/ tools/ spec/ plan/ docs/ rules/ track/ deploy/
  )
  local entry
  for entry in "${ignored[@]}"; do
    grep -Fxq "$entry" .dockerignore || { echo "FAIL: global-only path '$entry' is not dockerignored" >&2; return 1; }
  done
  # Shared root context: ui and non-consumed packages stay available to the UI
  # build; only e2e test sources are trimmed, keeping toolbox manifests/fixtures.
  for entry in 'e2e/*' '!e2e/package.json' '!e2e/package-lock.json' '!e2e/tests/' 'e2e/tests/*' '!e2e/tests/fixtures/'; do
    grep -Fxq "$entry" .dockerignore || { echo "FAIL: build-context rule '$entry' missing from .dockerignore" >&2; return 1; }
  done
  for entry in 'ui/*' 'apps/llm-gateway/'; do
    grep -Fxq "$entry" .dockerignore && { echo "FAIL: proven consumer '$entry' must stay in the build context" >&2; return 1; }
  done
  echo "PASS: global-only paths stay out of the tag and out of the build context (existing tag reused)"
}

hash_pipeline_sensitive() {
  local probe="$scratch/hashprobe"
  mkdir -p "$probe/a"
  printf 'one' > "$probe/a/f.txt"
  local before after changed
  before="$(find "$probe" -type f | LC_ALL=C sort | xargs cat | sha1sum)"
  printf 'two' > "$probe/a/f.txt"
  after="$(find "$probe" -type f | LC_ALL=C sort | xargs cat | sha1sum)"
  test "$before" != "$after" || { echo "FAIL: content change did not move the hash" >&2; return 1; }
  printf 'one' > "$probe/a/f.txt"
  changed="$(find "$probe" -type f | LC_ALL=C sort | xargs cat | sha1sum)"
  test "$before" = "$changed" || { echo "FAIL: restoring content did not restore the hash" >&2; return 1; }
  echo "PASS: content-hash pipeline moves on change and restores on revert"
}

toolchain_pinned() {
  ! grep -q 'tar@latest' api/Dockerfile || { echo "FAIL: unpinned tar@latest in api/Dockerfile" >&2; return 1; }
  grep -q 'tar@[0-9][0-9.]*' api/Dockerfile || { echo "FAIL: no pinned tar version in api/Dockerfile" >&2; return 1; }
  echo "PASS: floating toolchain inputs are pinned"
}

version_filters_cover() {
  make --no-print-directory check-ci-version-filters > "$scratch/output" 2>&1 || { cat "$scratch/output" >&2; return 1; }
  echo "PASS: ci change-filters cover every canonical tag input"
}

case "${1:-all}" in
  resolve-reuse) resolve_reuse ;;
  resolve-absent) resolve_absent ;;
  resolve-local) resolve_local ;;
  resolve-auth-error) resolve_fail_closed auth-error ;;
  resolve-network-error) resolve_fail_closed network-error ;;
  resolve-stdout-unknown) resolve_fail_closed stdout-unknown ;;
  guard-collision) guard_collision ;;
  tag-inputs-cover-builds) tag_inputs_cover_builds ;;
  tag-inputs-exclude-global) tag_inputs_exclude_global ;;
  hash-pipeline-sensitive) hash_pipeline_sensitive ;;
  toolchain-pinned) toolchain_pinned ;;
  version-filters-cover) version_filters_cover ;;
  resolve)
    resolve_reuse
    resolve_absent
    resolve_local
    resolve_fail_closed auth-error
    resolve_fail_closed network-error
    resolve_fail_closed stdout-unknown
    ;;
  tag-inputs)
    tag_inputs_cover_builds
    tag_inputs_exclude_global
    hash_pipeline_sensitive
    toolchain_pinned
    version_filters_cover
    ;;
  all)
    resolve_reuse
    resolve_absent
    resolve_local
    resolve_fail_closed auth-error
    resolve_fail_closed network-error
    resolve_fail_closed stdout-unknown
    guard_collision
    tag_inputs_cover_builds
    tag_inputs_exclude_global
    hash_pipeline_sensitive
    toolchain_pinned
    version_filters_cover
    ;;
  *) echo "Expected resolve-reuse, resolve-absent, resolve-local, resolve-auth-error, resolve-network-error, resolve-stdout-unknown, guard-collision, tag-inputs-cover-builds, tag-inputs-exclude-global, hash-pipeline-sensitive, toolchain-pinned, version-filters-cover, resolve, tag-inputs, or all" >&2; exit 1 ;;
esac
