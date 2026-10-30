#!/usr/bin/env bash
# Trusted operator acquisition; credentials are never mounted into a scanner.
set -euo pipefail
evidence="$PWD/tmp/security-qualify"
cohort=${SECQUAL_COHORT:-main-40832206894}
[[ "$cohort" = main-40832206894 || "$cohort" = main-40876641000 ]]
operator_root=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
source scripts/security/daily/operator-env.sh
read_operator_env "$operator_root/.env"
export DOCKER_CONFIG
DOCKER_CONFIG=$(mktemp -d "$evidence/auth.XXXXXX")
chmod 700 "$DOCKER_CONFIG"
trap 'rm -rf "$DOCKER_CONFIG"' EXIT
printf '%s' "$DOCKER_PASSWORD" | docker login "$REGISTRY" --username "$DOCKER_USERNAME" --password-stdin >/dev/null
unset DOCKER_PASSWORD
blocked=0
for kind in api api-tool ui; do
  folder="$evidence/$cohort/$kind-image"
  receipt="$folder/$kind-image.json"
  ref=$(jq -er .ref "$receipt")
  expected=$(jq -er .archiveDigest "$receipt")
  printf '%s  %s\n' "${expected#sha256:}" "$folder/$kind-image.tar.zst" | sha256sum --check
  if docker manifest inspect --verbose "$ref" > "$folder/registry-inspect.json" 2> "$folder/registry-error.log"; then
  jq -e 'if type == "array" then [.[] | select(.Descriptor.platform.os == "linux" and .Descriptor.platform.architecture == "amd64")] | if length == 1 then .[0] else error("platform inventory") end else . end' \
    "$folder/registry-inspect.json" > "$folder/registry-platform.json"
  actual=$(jq -er .SchemaV2Manifest.config.digest "$folder/registry-platform.json")
  if test "$actual" != "$(jq -er .imageId "$receipt")"; then
    jq --arg registryConfig "$actual" '{sourceSha,runId,ref,archiveConfig:.imageId,registryConfig:$registryConfig,status:"coverage-blocked: registry/archive config mismatch"}' \
      "$receipt" > "$folder/provenance-mismatch.json"
    blocked=1
  fi
  manifest=$(jq -er .Descriptor.digest "$folder/registry-platform.json")
  printf '%s@%s\n' "${ref%:*}" "$manifest" > "$folder/immutable-ref.txt"
  else
    blocked=1
    printf '%s\n' 'coverage-blocked: registry lookup failed; see registry-error.log' > "$folder/registry-blocked.txt"
  fi
  /usr/bin/time -v -o "$folder/decompression.time" zstd -d --force "$folder/$kind-image.tar.zst" -o "$folder/image.tar"
  tar -xOf "$folder/image.tar" manifest.json > "$folder/archive-manifest.json"
done
exit "$blocked"
