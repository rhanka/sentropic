#!/usr/bin/env bash
set -euo pipefail
evidence="$PWD/tmp/security-qualify"
previous=/home/antoinefa/src/sentropic/.tmp/sec-s2b-evidence
for file in index.json manifest.json config.json bundle-356b2dc09aa14e36a3a6fb88708f224261c1d8f451e502310308800b8e05bfb6.json; do
  cp "$previous/$file" "$evidence/$file"
done
cp "$previous/sigstore-root/tuf-repo-cdn.sigstore.dev/targets/trusted_root.json" "$evidence/trusted_root.json"
sha256sum "$evidence"/{index,manifest,config,trusted_root}.json > "$evidence/signature-material.sha256"
node_image='node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6'
docker run --rm --network=none --read-only --cap-drop=ALL --security-opt=no-new-privileges \
  --memory=512m --cpus=1 --pids-limit=128 --user "$(id -u):$(id -g)" \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=32m -e HOME=/tmp \
  -v "$evidence:/evidence:ro" "$node_image" /evidence/cosign verify-blob-attestation \
  --offline --bundle /evidence/bundle-356b2dc09aa14e36a3a6fb88708f224261c1d8f451e502310308800b8e05bfb6.json \
  --trusted-root /evidence/trusted_root.json \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity https://github.com/aquasecurity/trivy/.github/workflows/reusable-release.yaml@refs/tags/v0.76.1 \
  --type https://sigstore.dev/cosign/sign/v1 /evidence/index.json \
  > "$evidence/offline-verification.json" 2> "$evidence/offline-verification.log"
