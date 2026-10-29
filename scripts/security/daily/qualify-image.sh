#!/usr/bin/env bash
# Read image bytes without executing the candidate; run only under the Docker flock.
set -euo pipefail
evidence="$PWD/tmp/security-qualify"
mkdir -p "$evidence"
scanner='aquasec/trivy@sha256:2e6c00d711ab4ae41d8a30c2c1fd3bd3b62704c177bb120f95012e939edfb3df'
verifier_hash='46dbdcb5467a3dfec2526923d0b3365e40c8d9dc00ec23d5aca3437449e8cbfd'
curl --fail --silent --show-error --location --max-time 120 \
  https://github.com/sigstore/cosign/releases/download/v3.0.2/cosign-linux-amd64 \
  -o "$evidence/cosign"
printf '%s  %s\n' "$verifier_hash" "$evidence/cosign" | sha256sum --check
chmod 500 "$evidence/cosign"
/usr/bin/time -v -o "$evidence/scanner-cold-pull.time" docker pull --platform linux/amd64 "$scanner"
/usr/bin/time -v -o "$evidence/scanner-warm-pull.time" docker pull --platform linux/amd64 "$scanner"
docker image inspect "$scanner" > "$evidence/scanner-inspect.json"
container=$(docker create --entrypoint /bin/false "$scanner")
trap 'docker rm "$container" >/dev/null' EXIT
docker export "$container" -o "$evidence/scanner-rootfs.tar"
tar -tf "$evidence/scanner-rootfs.tar" > "$evidence/scanner-files.txt"
tar -xOf "$evidence/scanner-rootfs.tar" usr/local/bin/trivy > "$evidence/trivy"
tar -xOf "$evidence/scanner-rootfs.tar" lib/apk/db/installed > "$evidence/scanner-apk.txt"
sha256sum "$evidence"/{cosign,trivy,scanner-rootfs.tar,scanner-files.txt,scanner-apk.txt} > "$evidence/scanner-content.sha256"
if rg -i '(^|/)(python([0-9.]*)?|pip([0-9.]*)?)(/|$)|site-packages|libpython' "$evidence/scanner-files.txt"; then
  echo 'coverage-blocked: Python content in scanner' >&2
  exit 1
fi
echo 'Scanner filesystem inventory contains no Python interpreter, pip, libpython or site-packages.'
