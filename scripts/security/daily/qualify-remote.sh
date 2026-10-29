#!/usr/bin/env bash
# Refusal trials only: no broad registry credential or shared daemon enters the scanner.
set -euo pipefail
evidence="$PWD/tmp/security-qualify"
scanner='aquasec/trivy@sha256:2e6c00d711ab4ae41d8a30c2c1fd3bd3b62704c177bb120f95012e939edfb3df'
vulnerability=$(find "$evidence/cache" -mindepth 1 -maxdepth 1 -type d -name 'vulnerability-*')
java=$(find "$evidence/cache" -mindepth 1 -maxdepth 1 -type d -name 'java-*')
ref=$(cat "$evidence/main-40832206894/api-image/immutable-ref.txt")
start=$(date +%s%N)
set +e
timeout 120 docker run --rm --name test-sec-qualify-remote --pull=never --read-only --cap-drop=ALL \
  --security-opt=no-new-privileges --user 65532:65532 --memory=4g --cpus=1 --pids-limit=128 \
  --env HOME=/tmp --tmpfs /tmp:rw,nosuid,nodev,noexec,size=256m --tmpfs /cache:rw,nosuid,nodev,noexec,size=16m \
  --mount "type=bind,src=$vulnerability/trivy.db,dst=/cache/db/trivy.db,readonly" \
  --mount "type=bind,src=$vulnerability/metadata.json,dst=/cache/db/metadata.json,readonly" \
  --mount "type=bind,src=$java/trivy-java.db,dst=/cache/java-db/trivy-java.db,readonly" \
  --mount "type=bind,src=$java/metadata.json,dst=/cache/java-db/metadata.json,readonly" \
  "$scanner" image --config /dev/null --ignorefile /dev/null --cache-dir /cache --cache-backend memory \
  --scanners vuln --format json --severity UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL --exit-code 0 --parallel 1 \
  --skip-db-update --skip-java-db-update --offline-scan --skip-version-check --disable-telemetry \
  --image-src remote --platform linux/amd64 "$ref" > "$evidence/remote-report.json" 2> "$evidence/remote.log"
status=$?
set -e
docker rm -f test-sec-qualify-remote >/dev/null 2>&1 || true
printf '{"exitCode":%s,"elapsedMs":%s,"sourceProvenanceQualified":false}\n' "$status" "$(( ( $(date +%s%N) - start ) / 1000000 ))" > "$evidence/remote-execution.json"
docker run --rm --network=none --read-only --cap-drop=ALL --security-opt=no-new-privileges \
  --user 65532:65532 --memory=512m --cpus=1 --pids-limit=128 \
  node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 \
  sh -ec 'test ! -e /var/run/docker.sock; for binary in docker buildctl buildkitd python python3 pip pip3; do if command -v "$binary"; then exit 1; fi; done; echo "No daemon socket, builder or Python executable in approved Node sandbox"' \
  > "$evidence/rebuild-probe.log"
test "$status" != 0
echo 'coverage-blocked: remote pull lacks a scoped credential; isolated image builder is unavailable' >&2
exit 1
