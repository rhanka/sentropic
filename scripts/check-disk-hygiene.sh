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
