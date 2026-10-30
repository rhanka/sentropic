#!/usr/bin/env bash
# Read-only qualification of the latest immutable upstream candidate, without admission.
set -euo pipefail
evidence="$PWD/tmp/security-qualify"
curl --fail --silent --show-error --location --max-time 120 \
  https://github.com/sigstore/cosign/releases/download/v3.1.4/cosign-linux-amd64 -o "$evidence/cosign-latest.pending"
printf '%s  %s\n' 424e2c97d0b45fd7a6b608a87f090f35633f4c23ece5f092d48bba11aaf4bbfa \
  "$evidence/cosign-latest.pending" | sha256sum --check
mv "$evidence/cosign-latest.pending" "$evidence/cosign-latest"
chmod 555 "$evidence/cosign-latest"
vulnerability=$(find "$evidence/cache" -mindepth 1 -maxdepth 1 -type d -name 'vulnerability-*')
java=$(find "$evidence/cache" -mindepth 1 -maxdepth 1 -type d -name 'java-*')
docker run --rm --pull=never --read-only --cap-drop=ALL --security-opt=no-new-privileges --user 65532:65532 \
  --memory=4g --cpus=1 --pids-limit=128 --network=none --env HOME=/tmp \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=256m --tmpfs /cache:rw,nosuid,nodev,noexec,size=16m \
  --mount "type=bind,src=$vulnerability/trivy.db,dst=/cache/db/trivy.db,readonly" \
  --mount "type=bind,src=$vulnerability/metadata.json,dst=/cache/db/metadata.json,readonly" \
  --mount "type=bind,src=$java/trivy-java.db,dst=/cache/java-db/trivy-java.db,readonly" \
  --mount "type=bind,src=$java/metadata.json,dst=/cache/java-db/metadata.json,readonly" \
  --mount "type=bind,src=$evidence/cosign-latest,dst=/payload/cosign,readonly" \
  aquasec/trivy@sha256:2e6c00d711ab4ae41d8a30c2c1fd3bd3b62704c177bb120f95012e939edfb3df rootfs \
  --config /dev/null --ignorefile /dev/null --cache-dir /cache --cache-backend memory --scanners vuln \
  --format json --severity UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL --exit-code 0 --parallel 1 \
  --skip-db-update --skip-java-db-update --offline-scan --skip-version-check --disable-telemetry /payload \
  > "$evidence/verifier-latest-report.json" 2> "$evidence/verifier-latest.log"
docker run --rm --network=none --read-only --cap-drop=ALL --security-opt=no-new-privileges \
  --memory=512m --cpus=1 --pids-limit=128 --user "$(id -u):$(id -g)" \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=32m -e HOME=/tmp -v "$evidence:/evidence:ro" \
  node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 \
  /evidence/cosign-latest verify-blob-attestation --offline \
  --bundle /evidence/bundle-356b2dc09aa14e36a3a6fb88708f224261c1d8f451e502310308800b8e05bfb6.json \
  --trusted-root /evidence/trusted_root.json --type https://sigstore.dev/cosign/sign/v1 \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity https://github.com/aquasecurity/trivy/.github/workflows/reusable-release.yaml@refs/tags/v0.76.1 \
  /evidence/index.json > "$evidence/verifier-latest-offline.json" 2> "$evidence/verifier-latest-offline.log"
