#!/usr/bin/env bash
# Opt-in guard for the filesystem backing this host's Docker image store.
set -euo pipefail

threshold="${DISK_HYGIENE_THRESHOLD:-}"
[[ -n "$threshold" ]] || exit 0
if [[ ! "$threshold" =~ ^[0-9]{1,3}$ ]] || (( 10#$threshold < 1 || 10#$threshold > 100 )); then
  echo 'Error: DISK_HYGIENE_THRESHOLD must be an integer from 1 to 100 (use 90), or empty to disable.' >&2
  exit 1
fi

docker_root="$(docker info --format '{{.DockerRootDir}}')"
if [[ -z "$docker_root" ]]; then
  echo 'Error: cannot locate the Docker image store; refusing local image build.' >&2
  exit 1
fi
usage="$(LC_ALL=C df -P "$docker_root" | awk 'NR == 2 {gsub(/%/, "", $(NF-1)); print $(NF-1)}')"
if [[ ! "$usage" =~ ^[0-9]{1,3}$ ]]; then
  echo 'Error: cannot read Docker filesystem usage; refusing local image build.' >&2
  exit 1
fi
if (( 10#$usage > 10#$threshold )); then
  echo "Error: refusing local image build: Docker filesystem is ${usage}% used (threshold ${threshold}%). Run make disk-hygiene or use CI." >&2
  exit 1
fi
