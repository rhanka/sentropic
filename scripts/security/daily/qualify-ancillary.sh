#!/usr/bin/env bash
set -euo pipefail
evidence="$PWD/tmp/security-qualify"
scanner='aquasec/trivy@sha256:2e6c00d711ab4ae41d8a30c2c1fd3bd3b62704c177bb120f95012e939edfb3df'
vulnerability=$(find "$evidence/cache" -mindepth 1 -maxdepth 1 -type d -name 'vulnerability-*')
java=$(find "$evidence/cache" -mindepth 1 -maxdepth 1 -type d -name 'java-*')
common=(--rm --pull=never --read-only --cap-drop=ALL --security-opt=no-new-privileges --user 65532:65532
  --memory=4g --cpus=1 --pids-limit=128 --network=none --env HOME=/tmp
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=256m --tmpfs /cache:rw,nosuid,nodev,noexec,size=16m
  --mount "type=bind,src=$vulnerability/trivy.db,dst=/cache/db/trivy.db,readonly"
  --mount "type=bind,src=$vulnerability/metadata.json,dst=/cache/db/metadata.json,readonly"
  --mount "type=bind,src=$java/trivy-java.db,dst=/cache/java-db/trivy-java.db,readonly"
  --mount "type=bind,src=$java/metadata.json,dst=/cache/java-db/metadata.json,readonly")
flags=(--config /dev/null --ignorefile /dev/null --cache-dir /cache --cache-backend memory
  --scanners vuln --format json --severity UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL --exit-code 0 --parallel 1
  --skip-db-update --skip-java-db-update --offline-scan --skip-version-check --disable-telemetry)
docker run "${common[@]}" --entrypoint sh \
  --mount "type=bind,src=$evidence/main-40832206894/api-image/image.tar,dst=/target/image.tar,readonly" \
  "$scanner" -ec 'test ! -S /var/run/docker.sock; for path in /qualify-root /cache/db/metadata.json /target/image.tar; do if touch "$path"; then exit 1; fi; done; echo "Root, DB and target writes refused; daemon socket absent"' \
  > "$evidence/write-isolation.log" 2>&1
docker image save "$scanner" -o "$evidence/scanner-image.pending.tar"
mv "$evidence/scanner-image.pending.tar" "$evidence/scanner-image.tar"
chmod 444 "$evidence/scanner-image.tar"
/usr/bin/time -v -o "$evidence/scanner-self.time" docker run "${common[@]}" \
  --mount "type=bind,src=$evidence/scanner-image.tar,dst=/target/image.tar,readonly" \
  "$scanner" image "${flags[@]}" --input /target/image.tar > "$evidence/scanner-self-report.json" 2> "$evidence/scanner-self.log"
chmod 555 "$evidence/cosign"
/usr/bin/time -v -o "$evidence/verifier-self.time" docker run "${common[@]}" \
  --mount "type=bind,src=$evidence/cosign,dst=/payload/cosign,readonly" \
  "$scanner" rootfs "${flags[@]}" /payload > "$evidence/verifier-self-report.json" 2> "$evidence/verifier-self.log"
mkdir -p "$evidence/checks"
# Reject traversal, links and special entries before unpacking fixed public data.
tar -tzf "$evidence/checks.tgz" | awk '/(^\/|(^|\/)\.\.(\/|$))/ {bad=1} END {exit bad}'
tar -tvzf "$evidence/checks.tgz" | awk 'substr($0,1,1)!="-" && substr($0,1,1)!="d" {bad=1} END {exit bad}'
tar -xzf "$evidence/checks.tgz" --directory "$evidence/checks" --no-same-owner --no-same-permissions
docker run "${common[@]}" --mount "type=bind,src=$evidence/checks,dst=/rules,readonly" \
  --mount "type=bind,src=$evidence/checks,dst=/cache/policy/content,readonly" \
  --mount "type=bind,src=$PWD,dst=/target,readonly" "$scanner" config --config /dev/null --ignorefile /dev/null \
  --cache-dir /cache --skip-check-update --skip-version-check --disable-telemetry \
  --severity UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL --format json \
  /target/docker-compose.yml > "$evidence/iac-report.json" 2> "$evidence/iac.log"
blocked=0
for report in scanner-self-report verifier-self-report; do
  jq -e '(.Results | length) > 0 and ([.Results[].Vulnerabilities[]? | select(.Severity == "HIGH" or .Severity == "CRITICAL")] | length) == 0' \
    "$evidence/$report.json" >/dev/null || blocked=1
done
jq -e '(.Results | type) == "array" and (.Results | length) > 0' "$evidence/iac-report.json" >/dev/null || blocked=1
if test "$blocked" = 1; then echo 'coverage-blocked: scanner/verifier vulnerabilities or incomplete IaC' >&2; fi
exit "$blocked"
