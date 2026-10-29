#!/usr/bin/env bash
# Trusted operator acquisition; credentials are never mounted into a scanner.
set -euo pipefail
evidence="$PWD/tmp/security-qualify"
operator_root=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
source <(rg '^export (REGISTRY|DOCKER_USERNAME|DOCKER_PASSWORD)=' "$operator_root/.env")
export DOCKER_CONFIG
DOCKER_CONFIG=$(mktemp -d "$evidence/auth.XXXXXX")
chmod 700 "$DOCKER_CONFIG"
trap 'rm -rf "$DOCKER_CONFIG"' EXIT
printf '%s' "$DOCKER_PASSWORD" | docker login "$REGISTRY" --username "$DOCKER_USERNAME" --password-stdin >/dev/null
unset DOCKER_PASSWORD
for kind in api api-tool ui; do
  folder="$evidence/main-40832206894/$kind-image"
  receipt="$folder/$kind-image.json"
  ref=$(jq -er .ref "$receipt")
  expected=$(jq -er .archiveDigest "$receipt")
  printf '%s  %s\n' "${expected#sha256:}" "$folder/$kind-image.tar.zst" | sha256sum --check
  docker manifest inspect --verbose "$ref" > "$folder/registry-inspect.json"
  jq -e 'if type == "array" then [.[] | select(.Descriptor.platform.os == "linux" and .Descriptor.platform.architecture == "amd64")] | if length == 1 then .[0] else error("platform inventory") end else . end' \
    "$folder/registry-inspect.json" > "$folder/registry-platform.json"
  actual=$(jq -er .SchemaV2Manifest.config.digest "$folder/registry-platform.json")
  test "$actual" = "$(jq -er .imageId "$receipt")"
  manifest=$(jq -er .Descriptor.digest "$folder/registry-platform.json")
  printf '%s@%s\n' "${ref%:*}" "$manifest" > "$folder/immutable-ref.txt"
  /usr/bin/time -v -o "$folder/decompression.time" zstd -d --force "$folder/$kind-image.tar.zst" -o "$folder/image.tar"
  tar -xOf "$folder/image.tar" manifest.json > "$folder/archive-manifest.json"
done
