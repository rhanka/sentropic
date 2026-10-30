#!/usr/bin/env bash
# Exercise repository-controlled scanner config as inert data, never as trusted policy.
set -euo pipefail
evidence="$PWD/tmp/security-qualify"
fixture="$evidence/hostile-config"
mkdir -p "$fixture"
curl --fail --silent --show-error --location --max-time 60 \
  https://repo.maven.apache.org/maven2/org/apache/logging/log4j/log4j-core/2.14.1/log4j-core-2.14.1.jar \
  -o "$fixture/log4j-core-2.14.1.jar"
printf '%s  %s\n' ade7402a70667a727635d5c4c29495f4ff96f061f12539763f6f123973b465b0 \
  "$fixture/log4j-core-2.14.1.jar" | sha256sum --check
printf '%s\n' 'CVE-2021-44228' > "$fixture/.trivyignore"
printf '%s\n' 'scan:' '  skip-dirs: [/payload]' 'ignorefile: /payload/.trivyignore' > "$fixture/trivy.yaml"
vulnerability=$(jq -er .snapshots.vulnerability.path "$evidence/ingestion.json")
java=$(jq -er .snapshots.java.path "$evidence/ingestion.json")
vulnerability="$evidence${vulnerability#/evidence}"
java="$evidence${java#/evidence}"
container=''
trap 'if [[ -n "$container" ]]; then docker rm -f "$container" >/dev/null 2>&1 || true; fi' EXIT
for control in repository-default hardened; do
  flags=()
  if [[ "$control" = hardened ]]; then flags=(--config /dev/null --ignorefile /dev/null); fi
  container=$(docker create --pull=never --read-only --cap-drop=ALL --security-opt=no-new-privileges --user 65532:65532 \
    --memory=4g --cpus=1 --pids-limit=128 --network=none --env HOME=/tmp --workdir /payload \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=256m --tmpfs /cache:rw,nosuid,nodev,noexec,size=16m \
    --mount "type=bind,src=$vulnerability/trivy.db,dst=/cache/db/trivy.db,readonly" \
    --mount "type=bind,src=$vulnerability/metadata.json,dst=/cache/db/metadata.json,readonly" \
    --mount "type=bind,src=$java/trivy-java.db,dst=/cache/java-db/trivy-java.db,readonly" \
    --mount "type=bind,src=$java/metadata.json,dst=/cache/java-db/metadata.json,readonly" \
    --mount "type=bind,src=$fixture,dst=/payload,readonly" \
    aquasec/trivy@sha256:2e6c00d711ab4ae41d8a30c2c1fd3bd3b62704c177bb120f95012e939edfb3df \
    rootfs "${flags[@]}" --cache-dir /cache --cache-backend memory --scanners vuln --format json \
    --severity UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL --exit-code 0 --parallel 1 \
    --skip-db-update --skip-java-db-update --offline-scan --skip-version-check --disable-telemetry /payload)
  docker inspect "$container" | jq '.[0] | {Image,Path,Args,Mounts,HostConfig:{ReadonlyRootfs:.HostConfig.ReadonlyRootfs,CapDrop:.HostConfig.CapDrop,SecurityOpt:.HostConfig.SecurityOpt,NetworkMode:.HostConfig.NetworkMode,Memory:.HostConfig.Memory,NanoCpus:.HostConfig.NanoCpus,PidsLimit:.HostConfig.PidsLimit},Config:{Image:.Config.Image,User:.Config.User,environmentNames:[.Config.Env[]|split("=")[0]]}}' > "$fixture/$control-isolation.json"
  docker start --attach "$container" \
    > "$fixture/$control.json" 2> "$fixture/$control.log"
  docker rm "$container" >/dev/null
  container=''
done
for control in repository-default hardened; do
  jq -e '.SchemaVersion == 2 and .ArtifactName == "/payload" and .ArtifactType == "filesystem"' \
    "$fixture/$control.json" >/dev/null
done
jq -e '[.Results[]?.Vulnerabilities[]? | select(.VulnerabilityID == "CVE-2021-44228")] | length == 0' \
  "$fixture/repository-default.json" >/dev/null
jq -e '[.Results[]?.Vulnerabilities[]? | select(.VulnerabilityID == "CVE-2021-44228" and .InstalledVersion == "2.14.1")] | length > 0' \
  "$fixture/hardened.json" >/dev/null
sha256sum "$fixture"/{log4j-core-2.14.1.jar,.trivyignore,trivy.yaml,repository-default.json,hardened.json} \
  > "$fixture/control.sha256"
