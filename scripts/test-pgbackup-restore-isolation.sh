#!/usr/bin/env bash
# W0-close.b R1: guard tests for k8s-pgbackup-restore with a fake kubectl shim.
# No cluster, no docker, no secrets. Fails closed on any unexpected call.
set -euo pipefail

cd "$(dirname "$0")/.."
scratch=$(mktemp -d "$PWD/.tmp/pgbackup-restore-isolation.XXXXXX")
trap 'rm -rf "$scratch"' EXIT

mkdir -p "$scratch/bin"
cat > "$scratch/bin/kubectl" <<'SHIM'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$KUBECTL_CALL_LOG"
ns=""
args=("$@")
while [ "${args[0]:-}" = "-n" ]; do ns="${args[1]:-}"; args=("${args[@]:2}"); done
case "${args[0]:-} ${args[1]:-}" in
  "auth can-i")
    case "$ns" in sentropic|sentropic-preprod) printf '%s\n' "$SHIM_PROD_CAN_I" ;; *) printf '%s\n' "$SHIM_CAN_I" ;; esac
    exit 0 ;;
  "get secret") printf '%s\n' "$SHIM_SRC_BUCKET_B64"; exit 0 ;;
  "run "*) printf '%s\n' "$*" >> "$KUBECTL_RUN_ARGS"; echo "shim: refusing cluster write (kubectl run)" >&2; exit 99 ;;
  *) echo "shim: unexpected kubectl call: $*" >&2; exit 98 ;;
esac
SHIM
chmod +x "$scratch/bin/kubectl"

export PATH="$scratch/bin:$PATH"
export KUBECTL_CALL_LOG="$scratch/kubectl.log"
export KUBECTL_RUN_ARGS="$scratch/run-args.log"
: > "$KUBECTL_CALL_LOG"
: > "$KUBECTL_RUN_ARGS"

KUBECONFIG_REAL="$scratch/kubeconfig"
touch "$KUBECONFIG_REAL"
KEY=pg/20261022T020015Z.sql.gz
SRC_LIVE=sentropic-live-backup
export SHIM_CAN_I=yes
export SHIM_PROD_CAN_I=no
export SHIM_SRC_BUCKET_B64
SHIM_SRC_BUCKET_B64="$(printf '%s' "$SRC_LIVE" | base64)"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf 'ok: %s\n' "$1"; }
ko() { fail=$((fail + 1)); printf 'FAIL: %s\n' "$1"; }

# expect_guard <name> <message-fragment> [make vars...]: must fail, log empty.
expect_guard() {
  local name="$1" want="$2"; shift 2
  : > "$KUBECTL_CALL_LOG"
  local out status=0
  out="$(make --no-print-directory k8s-pgbackup-restore RESTORE_KUBECONFIG="$KUBECONFIG_REAL" "$@" ENV=test-app-w0-restore 2>&1)" || status=$?
  if [ "$status" -eq 0 ]; then ko "$name: target succeeded, expected a guard failure"; return; fi
  case "$out" in *"$want"*) ;; *) ko "$name: missing message [$want]"; printf '%s\n' "$out"; return ;; esac
  if [ -s "$KUBECTL_CALL_LOG" ]; then ko "$name: kubectl was called before the guard"; cat "$KUBECTL_CALL_LOG"; return; fi
  ok "$name"
}

expect_guard "missing-key" "PG_BACKUP_KEY"
expect_guard "bad-shape" "must match" PG_BACKUP_KEY=prod-2026.dump
expect_guard "traversal" "must match" PG_BACKUP_KEY=pg/../../x.sql.gz
expect_guard "injection-key" "must match" 'PG_BACKUP_KEY=pg/x"},{"name":"PGHOST","value":"postgres.sql.gz'
expect_guard "prod-namespace" "refusing production namespace" PG_BACKUP_KEY="$KEY" RESTORE_NAMESPACE=sentropic
expect_guard "preprod-namespace" "refusing preprod namespace" PG_BACKUP_KEY="$KEY" RESTORE_NAMESPACE=sentropic-preprod
expect_guard "default-namespace" "isolated restore namespace" PG_BACKUP_KEY="$KEY" RESTORE_NAMESPACE=default
expect_guard "live-host" "refusing live Postgres host" PG_BACKUP_KEY="$KEY" RESTORE_PGHOST=postgres
expect_guard "host-case" "refusing live Postgres host" PG_BACKUP_KEY="$KEY" RESTORE_PGHOST=Postgres.sentropic.svc.cluster.local
expect_guard "host-ip" "IP-literal" PG_BACKUP_KEY="$KEY" RESTORE_PGHOST=10.244.0.5
expect_guard "live-db" "refusing live database name" PG_BACKUP_KEY="$KEY" RESTORE_PGDB=app
expect_guard "db-case" "lowercase" PG_BACKUP_KEY="$KEY" RESTORE_PGDB=App
expect_guard "bad-secret" "valid secret name" PG_BACKUP_KEY="$KEY" RESTORE_READ_SECRET='sentropic-pgbackup";evil'
expect_guard "bad-user" "valid role name" PG_BACKUP_KEY="$KEY" RESTORE_PGUSER='app";evil'
expect_guard "bad-port" "numeric" PG_BACKUP_KEY="$KEY" RESTORE_PGPORT=abc
expect_guard "bad-sha" "64-char hex" PG_BACKUP_KEY="$KEY" PG_BACKUP_SHA256=zzz
expect_guard "absent-restore-kubeconfig-file" "RESTORE_KUBECONFIG file not found" PG_BACKUP_KEY="$KEY" RESTORE_KUBECONFIG="$scratch/nope"

# No RESTORE_KUBECONFIG at all: must fail before any kubectl call.
: > "$KUBECTL_CALL_LOG"
out="" status=0
out="$(make --no-print-directory k8s-pgbackup-restore PG_BACKUP_KEY="$KEY" ENV=test-app-w0-restore 2>&1)" || status=$?
if [ "$status" -eq 0 ]; then ko "no-restore-kubeconfig: target succeeded"; fi
case "$out" in *"RESTORE_KUBECONFIG is required"*) ;; *) ko "no-restore-kubeconfig: missing message"; printf '%s\n' "$out" ;; esac
if [ -s "$KUBECTL_CALL_LOG" ]; then ko "no-restore-kubeconfig: kubectl was called"; else ok "no-restore-kubeconfig (no default identity)"; fi

# Default prod-admin kubeconfig path: refused even though it is a set value.
: > "$KUBECTL_CALL_LOG"
out="" status=0
out="$(make --no-print-directory k8s-pgbackup-restore PG_BACKUP_KEY="$KEY" RESTORE_KUBECONFIG="$HOME/.kube/poc.yaml" ENV=test-app-w0-restore 2>&1)" || status=$?
if [ "$status" -eq 0 ]; then ko "default-kubeconfig: target succeeded"; fi
case "$out" in *"refusing default kubeconfig"*) ;; *) ko "default-kubeconfig: missing message"; printf '%s\n' "$out" ;; esac
if [ -s "$KUBECTL_CALL_LOG" ]; then ko "default-kubeconfig: kubectl was called"; else ok "default-kubeconfig refused"; fi

# Admin-capable identity: negative prod/preprod can-i checks must refuse it.
export SHIM_PROD_CAN_I=yes
: > "$KUBECTL_CALL_LOG"
out="" status=0
out="$(make --no-print-directory k8s-pgbackup-restore PG_BACKUP_KEY="$KEY" RESTORE_KUBECONFIG="$KUBECONFIG_REAL" ENV=test-app-w0-restore 2>&1)" || status=$?
if [ "$status" -eq 0 ]; then ko "admin-identity: target succeeded"; fi
case "$out" in *"refusing"*) ;; *) ko "admin-identity: missing message"; printf '%s\n' "$out" ;; esac
case "$(cat "$KUBECTL_CALL_LOG")" in *" run "*) ko "admin-identity: kubectl run was reached" ;; *) ok "admin-identity refused (negative can-i, no run)" ;; esac
export SHIM_PROD_CAN_I=no

# Valid isolated inputs: guards pass, run reaches the restore namespace only.
: > "$KUBECTL_CALL_LOG"
: > "$KUBECTL_RUN_ARGS"
out="" status=0
out="$(make --no-print-directory k8s-pgbackup-restore PG_BACKUP_KEY="$KEY" RESTORE_KUBECONFIG="$KUBECONFIG_REAL" ENV=test-app-w0-restore 2>&1)" || status=$?
if [ "$status" -eq 0 ]; then ko "isolated-run: target succeeded without a cluster"; fi
case "$out" in *"Running restore pod"*) ;; *) ko "isolated-run: missing pod message"; printf '%s\n' "$out" ;; esac
log="$(cat "$KUBECTL_CALL_LOG")"
case "$log" in *"-n sentropic-restore-app-cm"*" run "*) ok "isolated-run (restore namespace only)" ;; *) ko "isolated-run: wrong kubectl destination"; printf '%s\n' "$log" ;; esac
# Negative identity checks are read-only can-i probes; only writes are forbidden outside the restore namespace.
case "$log" in *"auth can-i"*) ok "isolated-run (negative identity checks ran)" ;; *) ko "isolated-run: negative can-i checks missing"; printf '%s\n' "$log" ;; esac
if printf '%s\n' "$log" | grep ' run ' | grep -vq -- '-n sentropic-restore-app-cm'; then ko "isolated-run: kubectl write outside restore namespace"; printf '%s\n' "$log"; else ok "isolated-run (no live writes)"; fi

# Pod spec: the main container must not call s5cmd and must fail closed.
line="$(cat "$KUBECTL_RUN_ARGS")"
init_part="${line%%\"containers\"*}"
main_part="${line##*\"containers\"}"
case "$init_part" in *s5cmd*"ls --etag"*) ok "pod-spec (init collects listing)" ;; *) ko "pod-spec: init must run s5cmd ls --etag" ;; esac
case "$main_part" in *s5cmd*) ko "pod-spec: main container calls s5cmd" ;; *) ok "pod-spec (no s5cmd in main)" ;; esac
for marker in ON_ERROR_STOP pipefail "gzip -t" PG_BACKUP_SHA256; do
  case "$main_part" in *"$marker"*) ok "pod-spec (main has $marker)" ;; *) ko "pod-spec: main lacks $marker" ;; esac
done

printf 'pass=%d fail=%d\n' "$pass" "$fail"
test "$fail" -eq 0
