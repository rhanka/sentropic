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
  run_recipe hit build-api-tool-image REGISTRY=
  grep -Fx 'image inspect sentropic-api-tools:tool-regression' "$scratch/calls"
  make -n save-api-tool REGISTRY= API_TOOL_VERSION=tool-regression ENV="$ENV" > "$scratch/save"
  grep -F 'ci-save-image IMAGE_KIND=api-tool IMAGE_REF=sentropic-api-tools:tool-regression' "$scratch/save"
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

layers() {
  if grep '^FROM node:' api/Dockerfile e2e/Dockerfile | grep -Ev '@sha256:[a-f0-9]{64}'; then
    echo 'FAIL: Node base digest must be part of the image input key' >&2; return 1
  fi
  make -n ci-build-api ci-build-api-tool ci-build-ui ci-build-e2e CI_IMAGE_CACHE=1 REGISTRY=registry.example/team ENV="$ENV" > "$scratch/builds"
  for kind in api api-tool ui e2e; do
    grep -F -- "--cache-from type=gha,scope=br78-v1-$kind-linux/amd64" "$scratch/builds"
    grep -F -- "--cache-to type=gha,scope=br78-v1-$kind-linux/amd64,mode=max" "$scratch/builds"
  done
  make -n ci-build-api CI_IMAGE_CACHE=0 ENV="$ENV" > "$scratch/cold"
  grep -F -- '--no-cache --load' "$scratch/cold"
  if grep -Fq -- '--cache-from' "$scratch/cold"; then return 1; fi
  for cache_enabled in 0 1; do
    make -n ci-test-ui CI_IMAGE_CACHE="$cache_enabled" ENV="$ENV" > "$scratch/ui-tests"
    grep -F -- '--no-cache-filter=ui-tests' "$scratch/ui-tests"
    grep -F -- '--target ui-test-output' "$scratch/ui-tests"
  done
  echo 'PASS: distinct persistent layer scopes and explicit cold-cache mode'
  echo 'PASS: UI tests execute afresh in both warm and cold image modes'
}

case "${1:-all}" in
  registry|cache|hash|layers) "$1" ;;
  all) registry; cache; hash; layers ;;
  *) echo 'Expected registry, cache, hash, layers or all' >&2; exit 1 ;;
esac
