#!/usr/bin/env bash
# Known-vulnerable Java bytes are scan data only; never execute or install this fixture.
set -euo pipefail
evidence="$PWD/tmp/security-qualify"
fixture="$evidence/java-fixture"
mkdir -p "$fixture"
base=https://repo.maven.apache.org/maven2/org/apache/logging/log4j/log4j-core/2.14.1/log4j-core-2.14.1.jar
curl --fail --silent --show-error --location --max-time 60 "$base" -o "$fixture/.download"
printf '%s  %s\n' ade7402a70667a727635d5c4c29495f4ff96f061f12539763f6f123973b465b0 \
  "$fixture/.download" | sha256sum --check
mv "$fixture/.download" "$fixture/log4j-core-2.14.1.jar"
chmod 444 "$fixture/log4j-core-2.14.1.jar"
sha256sum "$fixture/log4j-core-2.14.1.jar" > "$fixture/fixture.sha256"
scanner='aquasec/trivy@sha256:2e6c00d711ab4ae41d8a30c2c1fd3bd3b62704c177bb120f95012e939edfb3df'
vulnerability=$(find "$evidence/cache" -mindepth 1 -maxdepth 1 -type d -name 'vulnerability-*')
java=$(find "$evidence/cache" -mindepth 1 -maxdepth 1 -type d -name 'java-*')
docker run --rm --pull=never --read-only --cap-drop=ALL --security-opt=no-new-privileges --user 65532:65532 \
  --memory=4g --cpus=1 --pids-limit=128 --network=none --env HOME=/tmp \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=256m --tmpfs /cache:rw,nosuid,nodev,noexec,size=16m \
  --mount "type=bind,src=$vulnerability/trivy.db,dst=/cache/db/trivy.db,readonly" \
  --mount "type=bind,src=$vulnerability/metadata.json,dst=/cache/db/metadata.json,readonly" \
  --mount "type=bind,src=$java/trivy-java.db,dst=/cache/java-db/trivy-java.db,readonly" \
  --mount "type=bind,src=$java/metadata.json,dst=/cache/java-db/metadata.json,readonly" \
  --mount "type=bind,src=$fixture,dst=/payload,readonly" "$scanner" rootfs --debug \
  --config /dev/null --ignorefile /dev/null --cache-dir /cache --cache-backend memory --scanners vuln \
  --format json --severity UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL --exit-code 0 --parallel 1 \
  --skip-db-update --skip-java-db-update --offline-scan --skip-version-check --disable-telemetry /payload \
  > "$fixture/report.json" 2> "$fixture/stderr.log"
jq -e '[.Results[].Vulnerabilities[]? | select(.VulnerabilityID == "CVE-2021-44228" and .InstalledVersion == "2.14.1")] | length > 0' "$fixture/report.json" >/dev/null
