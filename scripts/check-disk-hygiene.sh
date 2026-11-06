#!/usr/bin/env bash
# Dry-run host cleanup for every ENV; Docker is never contacted by this test.
set -euo pipefail
cd "$(dirname "$0")/.."

die() { echo "::error::$*" >&2; exit 1; }
export API_VERSION=fixture UI_VERSION=fixture E2E_VERSION=fixture API_TOOL_VERSION=fixture

for env in default empty dev test-disk-hygiene; do
  args=()
  case "$env" in
    default) ;;
    empty) args+=(ENV=) ;;
    *) args+=("ENV=$env") ;;
  esac
  out="$(make --no-print-directory -n disk-hygiene "${args[@]}")"
  for command in \
    'docker builder prune --all --force --keep-storage 5G' \
    'docker image prune --force' \
    'docker image prune --all --force --filter until=24h'; do
    grep -Fxq "$command" <<<"$out" || die "$env: missing '$command'"
  done
  [[ "$(grep -c '^docker ' <<<"$out")" == 3 ]] || die "$env: unexpected Docker command"
  ! grep -Eq 'volume|system prune|container|compose' <<<"$out" || die "$env: unsafe cleanup"
  echo "ok: $env hygiene dry-run preserves volumes and container-referenced images"
done

out="$(make --no-print-directory -n build-ui-image build-api-image-fresh build-e2e \
  ci-build-api-target ci-build-api-tool-target ci-build-ui-target ci-build-e2e-target \
  ci-build-ui-static-target ci-test-ui dev-ui DISK_HYGIENE_THRESHOLD=90 ENV=test-disk-hygiene)"
awk '
  /bash scripts\/check-disk-space.sh/ {guard = 1}
  /docker (compose .*build|compose up --build|buildx build)/ {
    if (!guard) exit 1
    guard = 0; builds++
  }
  END {if (builds != 10) exit 1}
' <<<"$out" || die 'an explicit image build is missing its disk guard'
echo 'ok: explicit image build recipes include the disk guard'

# Execute recipes against strict stubs; unexpected Docker calls always fail.
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
export DISK_TEST_LOG="$scratch/docker.log" DISK_TEST_ROOT="$scratch"
cat > "$scratch/docker" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$DISK_TEST_LOG"
case "$*" in
  'builder prune --all --force --keep-storage 5G'|'image prune --force'|'image prune --all --force --filter until=24h')
    echo 'Total reclaimed space: 1GB' ;;
  'info --format {{.DockerRootDir}}')
    [[ "${MOCK_INFO_FAIL:-0}" == 0 ]] || exit 1
    [[ "${MOCK_ROOT_EMPTY:-0}" == 0 ]] || exit 0
    echo "$DISK_TEST_ROOT" ;;
  'image inspect '*)
    [[ "${MOCK_IMAGE_PRESENT:-0}" == 1 ]] || exit 1
    echo sha256:fixture ;;
  'pull '*) [[ "${MOCK_PULL_PRESENT:-0}" == 1 ]] ;;
  'manifest inspect '*)
    [[ "${MOCK_MANIFEST_PRESENT:-0}" == 1 ]] && { echo '{}'; exit 0; }
    echo 'manifest unknown' >&2; exit 1 ;;
  'compose '*|'build --target ci-tools '*|'buildx build '*) ;;
  *) echo "Unexpected Docker call: $*" >&2; exit 97 ;;
esac
STUB
cat > "$scratch/df" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
[[ "$*" == "-P $DISK_TEST_ROOT" ]] || exit 97
[[ "${MOCK_DF_FAIL:-0}" == 0 ]] || exit 1
printf '%s\n' 'Filesystem 1024-blocks Used Available Capacity Mounted on' \
  "stub 100 91 9 ${MOCK_USAGE:-91}% /docker"
STUB
chmod +x "$scratch/docker" "$scratch/df"
export PATH="$scratch:$PATH"
export DISK_HYGIENE_THRESHOLD=90 MOCK_USAGE=91 MOCK_IMAGE_PRESENT=0 MOCK_PULL_PRESENT=0
export MOCK_INFO_FAIL=0 MOCK_DF_FAIL=0 MOCK_MANIFEST_PRESENT=0

expect_make() {
  local expected="$1" label="$2" rc=0; shift 2
  : > "$DISK_TEST_LOG"
  out="$(make --no-print-directory "$@" DOCKER_COMPOSE='docker compose' \
    REGISTRY= API_IMAGE_RECEIPT="$scratch/image-id" ENV=test-disk-hygiene 2>&1)" || rc=$?
  if [[ "$expected" == pass ]]; then
    [[ "$rc" == 0 ]] || die "$label unexpectedly failed: $out"
  else
    [[ "$rc" != 0 ]] || die "$label unexpectedly succeeded"
    ! grep -Eq '^compose .*build|^build(x)? ' "$DISK_TEST_LOG" || die "$label started a build"
  fi
  echo "ok: $label"
}

expect_make pass 'cleanup executes only the three safe prunes and reports freed space' disk-hygiene
[[ "$(grep -c 'Total reclaimed space: 1GB' <<<"$out")" == 3 ]] || die 'missing reclaimed-space output'
[[ "$(wc -l < "$DISK_TEST_LOG")" == 3 ]] || die 'unexpected cleanup operation'

for usage in 89 90 91; do
  export MOCK_USAGE="$usage"
  expected=pass; [[ "$usage" != 91 ]] || expected=fail
  expect_make "$expected" "build at ${usage}% with threshold 90" build-ui-image
done
grep -q 'refusing local image build' <<<"$out" || die 'missing high-disk refusal'
for threshold in invalid 0 101 -1; do
  expect_make fail "invalid threshold '$threshold'" build-ui-image "DISK_HYGIENE_THRESHOLD=$threshold"
  [[ ! -s "$DISK_TEST_LOG" ]] || die 'invalid threshold contacted Docker'
done
expect_make pass 'empty threshold disables guard' build-ui-image DISK_HYGIENE_THRESHOLD=
! grep -q '^info ' "$DISK_TEST_LOG" || die 'disabled guard inspected disk'
export MOCK_INFO_FAIL=1
expect_make fail 'Docker info failure refuses build' build-ui-image
export MOCK_INFO_FAIL=0 MOCK_DF_FAIL=1
expect_make fail 'df failure refuses build' build-ui-image
export MOCK_DF_FAIL=0 MOCK_ROOT_EMPTY=1
expect_make fail 'empty Docker root refuses build' build-ui-image
export MOCK_ROOT_EMPTY=0
expect_make fail 'custom threshold 80 refuses usage 91' build-ui-image DISK_HYGIENE_THRESHOLD=80
export MOCK_DF_FAIL=0 MOCK_USAGE=unknown
expect_make fail 'unreadable usage refuses build' build-ui-image
export MOCK_USAGE=91
expect_make fail 'fresh API build refuses high disk' build-api-image-fresh
expect_make fail 'canonical API cache miss refuses high disk' build-api-image
expect_make fail 'toolbox cache miss refuses high disk' build-api-tool-image
expect_make fail 'Buildx producer refuses high disk' ci-build-api-tool-target
export MOCK_USAGE=90
expect_make pass 'Buildx producer proceeds at threshold' ci-build-api-tool-target
export MOCK_USAGE=91
export MOCK_IMAGE_PRESENT=1
expect_make pass 'local toolbox reuse works above threshold' build-api-tool-image
export MOCK_IMAGE_PRESENT=0 MOCK_PULL_PRESENT=1
expect_make pass 'registry toolbox reuse works above threshold' build-api-tool-image

# Canonical registry reuse must remain available even if disk inspection fails.
export MOCK_MANIFEST_PRESENT=1 MOCK_IMAGE_PRESENT=1 MOCK_INFO_FAIL=1
: > "$DISK_TEST_LOG"
REGISTRY=fixture.invalid API_IMAGE_RECEIPT="$scratch/image-id" MANIFEST_DIR="$scratch/manifest" \
  DOCKER_COMPOSE='docker compose' bash scripts/resolve-api-image.sh > "$scratch/reuse.log"
[[ "$(cat "$scratch/image-id")" == sha256:fixture ]] || die 'canonical reuse lost its receipt'
! grep -Eq '^info |^compose .*build' "$DISK_TEST_LOG" || die 'canonical reuse checked/builds disk'
echo 'ok: canonical registry reuse works without disk inspection'
echo 'Disk hygiene self-test passed; no real Docker operations were performed.'
