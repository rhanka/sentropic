#!/usr/bin/env bash
# Experimental, all-severity scans of authenticated main-CI archives; never service admission.
set -euo pipefail
evidence="$PWD/tmp/security-qualify"
cohort=${SECQUAL_COHORT:-main-40832206894}
[[ "$cohort" = main-40832206894 || "$cohort" = main-40876641000 ]]
scanner='aquasec/trivy@sha256:2e6c00d711ab4ae41d8a30c2c1fd3bd3b62704c177bb120f95012e939edfb3df'
vulnerability=$(find "$evidence/cache" -mindepth 1 -maxdepth 1 -type d -name 'vulnerability-*')
java=$(find "$evidence/cache" -mindepth 1 -maxdepth 1 -type d -name 'java-*')
common=(--pull=never --read-only --cap-drop=ALL --security-opt=no-new-privileges --user 65532:65532
  --memory=4g --cpus=1 --pids-limit=128 --network=none --env HOME=/tmp
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=256m --tmpfs /cache:rw,nosuid,nodev,noexec,size=16m
  --mount "type=bind,src=$vulnerability/trivy.db,dst=/cache/db/trivy.db,readonly"
  --mount "type=bind,src=$vulnerability/metadata.json,dst=/cache/db/metadata.json,readonly"
  --mount "type=bind,src=$java/trivy-java.db,dst=/cache/java-db/trivy-java.db,readonly"
  --mount "type=bind,src=$java/metadata.json,dst=/cache/java-db/metadata.json,readonly")
flags=(--config /dev/null --ignorefile /dev/null --cache-dir /cache --cache-backend memory
  --scanners vuln --format json --severity UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL --exit-code 0 --parallel 1
  --skip-db-update --skip-java-db-update --offline-scan --skip-version-check --disable-telemetry)
blocked=0
active_container=''
cleanup() {
  if [[ -n "$active_container" ]]; then docker rm -f "$active_container" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT
for kind in api api-tool ui; do
  folder="$evidence/$cohort/$kind-image"
  for temperature in cold warm; do
    name="test-sec-qualify-$$-$kind-$temperature"
    start=$(date +%s%N)
    docker run -d --name "$name" "${common[@]}" \
      --mount "type=bind,src=$folder/image.tar,dst=/target/image.tar,readonly" \
      "$scanner" image "${flags[@]}" --platform linux/amd64 --input /target/image.tar >/dev/null
    active_container=$name
    docker inspect "$name" | jq '[.[] | {Path,Args,Mounts,HostConfig:{ReadonlyRootfs:.HostConfig.ReadonlyRootfs,CapDrop:.HostConfig.CapDrop,SecurityOpt:.HostConfig.SecurityOpt,NetworkMode:.HostConfig.NetworkMode,Memory:.HostConfig.Memory,NanoCpus:.HostConfig.NanoCpus,PidsLimit:.HostConfig.PidsLimit},user:.Config.User,environmentNames:[.Config.Env[]|split("=")[0]]}]' > "$folder/$temperature-isolation.json"
    docker top "$name" -eo pid,ppid,comm,args > "$folder/$temperature-processes.txt" || true
    docker stats --no-stream --format '{{json .}}' "$name" > "$folder/$temperature-stats.json" || true
    status=$(docker wait "$name")
    docker logs "$name" > "$folder/$temperature-report.json" 2> "$folder/$temperature-stderr.log"
    elapsed=$(( ( $(date +%s%N) - start ) / 1000000 ))
    printf '{"exitCode":%s,"elapsedMs":%s}\n' "$status" "$elapsed" > "$folder/$temperature-execution.json"
    docker inspect --format '{{json .State}}' "$name" > "$folder/$temperature-state.json"
    docker rm "$name" >/dev/null
    active_container=''
    test "$status" = 0 || blocked=1
    jq -e '.SchemaVersion == 2 and (.Results | length) > 0' "$folder/$temperature-report.json" >/dev/null || blocked=1
  done
done
exit "$blocked"
