#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .h2a/build
scratch=$(mktemp -d .h2a/build/tooling-test.XXXXXX)
probe=tools/ci-tooling-hash-probe.txt
test ! -e "$probe"
trap 'rm -rf "$scratch"; rm -f "$probe"' EXIT

# Exercise the real Make recipes without network pulls or image builds.
cat > "$scratch/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$DOCKER_CALL_LOG"
case "$1" in
  image) test "$CACHE_CASE" = hit ;;
  pull) echo 'Error response from daemon: manifest unknown' >&2; exit 1 ;;
  build|save) exit 0 ;;
  *) echo "Unexpected Docker command: $*" >&2; exit 1 ;;
esac
MOCK
chmod +x "$scratch/docker"

run_recipe() {
  PATH="$PWD/$scratch:$PATH" DOCKER_CALL_LOG="$PWD/$scratch/calls" CACHE_CASE="$1" \
    make --no-print-directory "${@:2}" API_TOOL_VERSION=tool-regression ENV="$ENV" \
    > "$scratch/output" 2>&1
}

registry() {
  run_recipe hit build-api-tool-image save-api-tool REGISTRY=
  grep -Fx 'image inspect sentropic-api-tools:tool-regression' "$scratch/calls"
  grep -Fx 'save sentropic-api-tools:tool-regression -o api-tool-image.tar' "$scratch/calls"
  : > "$scratch/calls"
  run_recipe hit build-api-tool-image REGISTRY=registry.example/team
  grep -Fx 'image inspect registry.example/team/sentropic-api-tools:tool-regression' "$scratch/calls"
  echo 'PASS: empty registry and registry prefix produce valid toolbox references'
}

cache() {
  : > "$scratch/calls"
  run_recipe miss build-api-tool-image REGISTRY=registry.example/team
  grep -Fx 'pull registry.example/team/sentropic-api-tools:tool-regression' "$scratch/calls"
  grep -Fx 'build --target ci-tools -f api/Dockerfile -t registry.example/team/sentropic-api-tools:tool-regression .' "$scratch/calls"
  if grep -q 'manifest unknown' "$scratch/output"; then cat "$scratch/output"; return 1; fi
  echo 'PASS: cache miss builds successfully without a misleading pull error'
}

hash() {
  original=$(env -u API_TOOL_VERSION make -s api-tool-version ENV="$ENV")
  printf 'first\n' > "$probe"
  added=$(env -u API_TOOL_VERSION make -s api-tool-version ENV="$ENV")
  test "$original" != "$added"
  printf 'second\n' > "$probe"
  changed=$(env -u API_TOOL_VERSION make -s api-tool-version ENV="$ENV")
  test "$added" != "$changed"
  rm "$probe"
  restored=$(env -u API_TOOL_VERSION make -s api-tool-version ENV="$ENV")
  test "$original" = "$restored"
  echo 'PASS: tools input addition/edit invalidates hash; deletion restores it'
}

case "${1:-all}" in
  registry|cache|hash) "$1" ;;
  all) registry; cache; hash ;;
  *) echo 'Expected registry, cache, hash or all' >&2; exit 1 ;;
esac
