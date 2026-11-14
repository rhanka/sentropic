#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_DIR"' EXIT
mkdir "$TEST_DIR/bin"
export T1_CALLS="$TEST_DIR/calls"
cat > "$TEST_DIR/bin/kubectl" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
mode=
for arg in "$@"; do
  case "$arg" in
    create|apply) mode=$arg; printf '%s\n' "$arg" >> "$T1_CALLS" ;;
    --from-literal=*)
      pair=${arg#--from-literal=}
      digest=$(printf '%s' "${pair#*=}" | sha256sum)
      printf '%s:sha256:%s\n' "${pair%%=*}" "${digest%% *}" >> "$T1_CALLS"
      ;;
  esac
done
if [ "$mode" = create ]; then printf '{}'; else cat >/dev/null; fi
STUB
chmod +x "$TEST_DIR/bin/kubectl"

run_bundle() {
  : > "$T1_CALLS"
  PATH="$TEST_DIR/bin:$PATH" make --no-print-directory -s -C "$ROOT" k8s-bundle-secret \
    K8S_ENV_FILE="$TEST_DIR/input.env" K8S_NAMESPACE=synthetic-preprod \
    KUBECONFIG="$TEST_DIR/no-cluster-access" API_PORT=9450 UI_PORT=5650 MAILDEV_UI_PORT=1550 \
    ENV=test-cm-t1-w9 > "$TEST_DIR/output" 2>&1
}
write_env() {
  printf 'JWT_SECRET="%s"\nSECRET_ENCRYPTION_KEY="%s"\nOAUTH_SIGNING_KEK=synthetic-bundle-kek\n' \
    "$1" "$2" > "$TEST_DIR/input.env"
}
assert_digest() {
  local digest
  digest=$(printf '%s' "$2" | sha256sum)
  grep -Fq "$1:sha256:${digest%% *}" "$T1_CALLS"
  if grep -Fq "$2" "$TEST_DIR/output" "$T1_CALLS"; then
    echo "FAIL: synthetic key disclosed ($1)" >&2; exit 1
  fi
}

JWT=$(printf 'j%.0s' {1..32})
ENC=$(printf 'e%.0s' {1..32})
SHORT=$(printf 'x%.0s' {1..31})
for invalid in missing '' x "$SHORT" " $SHORT " "$(printf ' %.0s' {1..32})"; do
  for name in JWT_SECRET SECRET_ENCRYPTION_KEY; do
    if [ "$name" = JWT_SECRET ]; then write_env "$invalid" "$ENC"; else write_env "$JWT" "$invalid"; fi
    if [ "$invalid" = missing ]; then
      sed "/^$name=/d" "$TEST_DIR/input.env" > "$TEST_DIR/missing.env"
      mv "$TEST_DIR/missing.env" "$TEST_DIR/input.env"
    fi
    if run_bundle; then echo "FAIL: incomplete $name accepted" >&2; exit 1; fi
    test ! -s "$T1_CALLS"
    grep -Fq "$name" "$TEST_DIR/output"
  done
done
echo 'PASS: missing/empty/1/31/padded-short/blank keys refused before any kubectl call'

write_env "$JWT" "$ENC"
run_bundle
assert_digest JWT_SECRET "$JWT"
assert_digest SECRET_ENCRYPTION_KEY "$ENC"
grep -Fq OAUTH_SIGNING_KEK "$T1_CALLS"
grep -Fxq apply "$T1_CALLS"
echo 'PASS: 32-character boundary delivers all three names with exact bytes and no values in output'

JWT=" $JWT #literal-suffix= "
ENC=" $ENC #other-suffix= "
write_env "$JWT" "$ENC"
run_bundle
assert_digest JWT_SECRET "$JWT"
assert_digest SECRET_ENCRYPTION_KEY "$ENC"
echo 'PASS: quoted spaces, equals and comment characters preserved byte-for-byte'
