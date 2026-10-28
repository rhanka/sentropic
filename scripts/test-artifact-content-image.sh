#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "FAIL: $*" >&2; exit 1; }
scratch=$(mktemp -d .tmp/content-image.XXXXXX)
trap 'rm -rf "$scratch"' EXIT

content_hash() {
  local inputs input probe="$scratch/hash" before changed restored
  inputs=$(sed -n 's/^export API_VERSION[[:space:]]*?=.*echo "\([^"]*\)".*/\1/p' Makefile)
  grep -Fxq apps/artifact-content <<< "${inputs// /$'\n'}" || fail 'content sources are absent from API_VERSION'
  mkdir -p "$probe/apps"
  # Use the actual Make hash expression with isolated content bytes; never edit the worktree sources.
  grep '^export API_VERSION ' Makefile > "$probe/Makefile"
  printf 'version:\n\t@echo $(API_VERSION)\n' >> "$probe/Makefile"
  for input in $inputs; do
    [ "$input" = apps/artifact-content ] && continue
    mkdir -p "$probe/$(dirname "$input")"
    ln -s "$PWD/$input" "$probe/$input"
  done
  cp -R apps/artifact-content "$probe/apps/"
  hash_version() { env -u API_VERSION make -s -C "$probe" version ENV="${ENV:?}"; }
  before=$(hash_version)
  printf '\n// isolated content-only hash witness\n' >> "$probe/apps/artifact-content/src/index.ts"
  changed=$(hash_version)
  [ "$before" != "$changed" ] || fail 'content-only edit did not invalidate the canonical tag'
  cp apps/artifact-content/src/index.ts "$probe/apps/artifact-content/src/index.ts"
  restored=$(hash_version)
  [ "$before" = "$restored" ] || fail 'restoring content did not restore the canonical tag'
  mkdir -p "$probe/apps/artifact-content/dist"
  printf 'stale generated bundle' > "$probe/apps/artifact-content/dist/index.js"
  [ "$before" = "$(hash_version)" ] || fail 'generated content bundle perturbs the source hash'
  grep -Fxq 'apps/artifact-content/dist/' .dockerignore || fail 'generated content bundle enters the build context'
  echo 'PASS: content-only edits invalidate the canonical image; generated bundles do not'
}

content_filters() {
  awk '/^            api:$/ { api=1; next } api && /^            [a-z_]+:/ { exit } api { print }' \
    .github/workflows/ci.yml | grep -Fq "'apps/artifact-content/**'" || fail 'content-only edit does not trigger the API CI lane'
  grep -Fq "'scripts/test-artifact-content-image.sh'" .github/workflows/ci.yml || fail 'content-image test edits do not trigger CI'
  echo 'PASS: content-only and test-only changes trigger canonical image qualification'
}

case "${1:-static}" in
  hash) content_hash ;;
  filters) content_filters ;;
  static) content_hash; content_filters ;;
  *) fail 'Expected hash, filters or static' ;;
esac
