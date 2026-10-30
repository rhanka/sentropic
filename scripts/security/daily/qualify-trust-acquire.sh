#!/usr/bin/env bash
# Independent acquisition from public origins; no operator auth or prior local evidence.
set -euo pipefail
evidence="$PWD/tmp/security-qualify"
mkdir -p "$evidence"
index=790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c
bundle=356b2dc09aa14e36a3a6fb88708f224261c1d8f451e502310308800b8e05bfb6
token=$(curl --fail --silent --show-error --max-time 60 \
  'https://auth.docker.io/token?service=registry.docker.io&scope=repository:aquasec/trivy:pull' | jq -er .token)
fetch_manifest() {
  curl --fail --silent --show-error --max-time 60 -H "Authorization: Bearer $token" \
    -H 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json' \
    "https://registry-1.docker.io/v2/aquasec/trivy/manifests/sha256:$1" -o "$evidence/$2"
  printf '%s  %s\n' "$1" "$evidence/$2" | sha256sum --check
}
fetch_blob() {
  curl --fail --silent --show-error --location --max-time 120 -H "Authorization: Bearer $token" \
    "https://registry-1.docker.io/v2/aquasec/trivy/blobs/$1" -o "$evidence/$2"
  printf '%s  %s\n' "${1#sha256:}" "$evidence/$2" | sha256sum --check
}
fetch_manifest "$index" index.json
platform=$(jq -er '[.manifests[] | select(.platform.os == "linux" and .platform.architecture == "amd64")] | if length == 1 then .[0].digest else error("platform inventory") end' "$evidence/index.json")
test "$platform" = sha256:2e6c00d711ab4ae41d8a30c2c1fd3bd3b62704c177bb120f95012e939edfb3df
fetch_manifest "${platform#sha256:}" manifest.json
config=$(jq -er .config.digest "$evidence/manifest.json")
test "$config" = sha256:ac7fdaf3e1f1442ec467a00d1ec900bc8dc20f694d172b11ff43d32f83162fb6
fetch_blob "$config" config.json
fetch_manifest "$bundle" bundle-manifest.json
blob=$(jq -er 'if (.layers | length) == 1 then .layers[0].digest else error("bundle inventory") end' "$evidence/bundle-manifest.json")
fetch_blob "$blob" "bundle-$bundle.json"
unset token
curl --fail --silent --show-error --location --max-time 120 \
  https://github.com/sigstore/cosign/releases/download/v3.1.4/cosign-linux-amd64 -o "$evidence/cosign.pending"
printf '%s  %s\n' 424e2c97d0b45fd7a6b608a87f090f35633f4c23ece5f092d48bba11aaf4bbfa \
  "$evidence/cosign.pending" | sha256sum --check
mv "$evidence/cosign.pending" "$evidence/cosign"
chmod 555 "$evidence/cosign"
date -u +%FT%TZ > "$evidence/trust-acquired-at.txt"
