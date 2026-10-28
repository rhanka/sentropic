#!/usr/bin/env bash
set -euo pipefail
cache=$1
mkdir -p "$cache/tools"
archive=gh_2.103.3_linux_amd64.tar.gz
sha=4c806978ffce1cec70853302a56d70ac6da4f19bae7adca4e1a8ab00633dd91d
if [ ! -f "$cache/tools/$archive" ]; then
  curl -fsSL --max-time 120 "https://github.com/cli/cli/releases/download/v2.103.3/$archive" -o "$cache/tools/$archive"
fi
printf '%s  %s\n' "$sha" "$cache/tools/$archive" | sha256sum -c -
tar -xzf "$cache/tools/$archive" -C "$cache/tools"
digest=$(jq -r .runtime.sha256 scripts/decision/kev-manifest.json)
curl -fsSL --max-time 30 "https://api.github.com/repos/ggml-org/llama.cpp/attestations/sha256:$digest" -o "$cache/attestations.json"
jq -e '.attestations | length > 0' "$cache/attestations.json" >/dev/null
jq '.attestations[0].bundle' "$cache/attestations.json" > "$cache/attestation-bundle.json"
GH_PROMPT_DISABLED=1 "$cache/tools/gh_2.103.3_linux_amd64/bin/gh" attestation verify \
  "$cache/llama-b11954-bin-ubuntu-x64.tar.gz" --repo ggml-org/llama.cpp \
  --bundle "$cache/attestation-bundle.json" --deny-self-hosted-runners --format json > "$cache/attestation-verification.json"
printf 'Verified upstream distribution attestation: %s\n' "$cache/attestation-verification.json"
