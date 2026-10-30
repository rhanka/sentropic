#!/usr/bin/env bash
set -euo pipefail
evidence="$PWD/tmp/security-qualify"
bash scripts/security/daily/qualify-trust-acquire.sh
node_image='node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6'
fresh=$(mktemp -d "$evidence/tuf-home.XXXXXX")
chmod 700 "$fresh"
common=(--rm --pull=never --read-only --cap-drop=ALL --security-opt=no-new-privileges
  --memory=512m --cpus=1 --pids-limit=128 --user "$(id -u):$(id -g)"
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=32m)
# The approved slim image has no system CA bundle. Use its pinned Node/Mozilla roots.
docker run "${common[@]}" --network=none "$node_image" node -e \
  "process.stdout.write(require('node:tls').rootCertificates.join('\\n') + '\\n')" > "$evidence/tls-roots.pem"
# Cosign verifies fresh TUF metadata starting from its hash-pinned release's embedded root.
# No previous ~/.sigstore or operator home is mounted into this container.
docker run "${common[@]}" --network=bridge -e HOME=/tuf -e SSL_CERT_FILE=/evidence/tls-roots.pem \
  -v "$evidence/cosign:/evidence/cosign:ro" -v "$evidence/tls-roots.pem:/evidence/tls-roots.pem:ro" \
  -v "$fresh:/tuf" "$node_image" \
  /evidence/cosign initialize --mirror https://tuf-repo-cdn.sigstore.dev \
  > "$evidence/tuf-initialize.json" 2> "$evidence/tuf-initialize.log"
mapfile -t roots < <(find "$fresh" -type f -name trusted_root.json)
test "${#roots[@]}" = 1
cp "${roots[0]}" "$evidence/trusted_root.json"
printf '%s\n' "${fresh#"$evidence/"}" > "$evidence/tuf-home.txt"
verify() {
docker run "${common[@]}" --network=none -e HOME=/tmp -v "$evidence/cosign:/evidence/cosign:ro" \
  -v "$evidence/${1##*/}:$1:ro" -v "$evidence/${2##*/}:$2:ro" -v "$evidence/${3##*/}:$3:ro" "$node_image" \
  /evidence/cosign verify-blob-attestation --bundle "$3" --trusted-root "$2" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity https://github.com/aquasecurity/trivy/.github/workflows/reusable-release.yaml@refs/tags/v0.76.1 \
  --type https://sigstore.dev/cosign/sign/v1 "$1" > "$evidence/$4.stdout.json" 2> "$evidence/$4.log"
}
bundle=/evidence/bundle-356b2dc09aa14e36a3a6fb88708f224261c1d8f451e502310308800b8e05bfb6.json
verify /evidence/index.json /evidence/trusted_root.json "$bundle" offline-verification
printf '%s\n' '{"trial":"offline exact index","exitCode":0}' > "$evidence/trust-trials.jsonl"
cp "$evidence/index.json" "$evidence/changed-index.json"
printf '\n' >> "$evidence/changed-index.json"
docker run "${common[@]}" --network=none -v "$evidence:/evidence:ro" -v "$evidence:/controls" -v "$PWD:/workspace:ro" "$node_image" \
  node /workspace/scripts/security/daily/qualify-trust-controls.mjs
for trial in changed-index changed-root changed-bundle; do
  input=/evidence/index.json
  root=/evidence/trusted_root.json
  signature=$bundle
  case "$trial" in
    changed-index) input=/evidence/changed-index.json ;;
    changed-root) root=/evidence/wrong-root.json ;;
    changed-bundle) signature=/evidence/wrong-bundle.json ;;
  esac
  if verify "$input" "$root" "$signature" "$trial"; then
    echo "coverage-blocked: $trial unexpectedly verified" >&2; exit 1
  else
    status=$?
    printf '{"trial":"%s","exitCode":%s}\n' "$trial" "$status" >> "$evidence/trust-trials.jsonl"
  fi
done
date -u +%FT%TZ > "$evidence/trust-verified-at.txt"
sha256sum "$evidence/cosign" \
  "$evidence"/{index,manifest,config,trusted_root}.json > "$evidence/signature-material.sha256"
