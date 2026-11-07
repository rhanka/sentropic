#!/usr/bin/env bash
set -euo pipefail
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
cat > "$scratch/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
test "$*" = 'login ghcr.io -u fixture-actor --password-stdin'
password="$(cat)"
test "$password" = fixture-registry-password
touch "$LOGIN_SEEN"
MOCK
chmod +x "$scratch/docker"
run() {
  PATH="$scratch:$PATH" LOGIN_SEEN="$scratch/seen" DOCKER_USERNAME=fixture-actor DOCKER_PASSWORD="$1" \
    make --no-print-directory docker-login REGISTRY=ghcr.io/rhanka ENV="${ENV:?}" > "$scratch/output" 2>&1
}
run fixture-registry-password
test -f "$scratch/seen"
! grep -q fixture-registry-password "$scratch/output"
rm "$scratch/seen"
if run ''; then echo 'FAIL: login accepted an empty token' >&2; exit 1; fi
test ! -f "$scratch/seen"
grep -q 'missing GITHUB_TOKEN' "$scratch/output"
echo 'GHCR login: PASS (real Make recipe, token via stdin, missing-token refusal)'
