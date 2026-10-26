#!/usr/bin/env bash
# W0-close.b: guard tests for k8s-pgbackup-restore with a fake kubectl shim.
# No cluster, no docker, no secrets. Fails closed on any unexpected call.
set -euo pipefail

cd "$(dirname "$0")/.."
scratch=$(mktemp -d .tmp/pgbackup-restore-isolation.XXXXXX)
trap 'rm -rf "$scratch"' EXIT

mkdir -p "$scratch/bin"
cat > "$scratch/bin/kubectl" <<'SHIM'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$KUBECTL_CALL_LOG"
args=("$@")
while [ "${args[0]:-}" = "-n" ]; do args=("${args[@]:2}"); done
case "${args[0]:-} ${args[1]:-}" in
  "auth can-i") printf '%s\n' "$SHIM_CAN_I"; exit 0 ;;
  "get secret") printf '%s\n' "$SHIM_SRC_BUCKET_B64"; exit 0 ;;
  "run "*) echo "shim: refusing cluster write (kubectl run)" >&2; exit 99 ;;
  *) echo "shim: unexpected kubectl call: $*" >&2; exit 98 ;;
esac
SHIM
chmod +x "$scratch/bin/kubectl"

export PATH="$scratch/bin:$PATH"
export KUBECTL_CALL_LOG="$scratch/kubectl.log"
: > "$KUBECTL_CALL_LOG"

KUBECONFIG_REAL="$scratch/kubeconfig"
touch "$KUBECONFIG_REAL"
KEY=pg/20261022T020015Z.sql.gz
SRC_LIVE=sentropic-live-backup
export SHIM_CAN_I=yes
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
  out="$(make --no-print-directory k8s-pgbackup-restore "$@" ENV=test-app-w0-restore 2>&1)" || status=$?
  if [ "$status" -eq 0 ]; then ko "$name: target succeeded, expected a guard failure"; return; fi
  case "$out" in *"$want"*) ;; *) ko "$name: missing message [$want]"; printf '%s\n' "$out"; return ;; esac
  if [ -s "$KUBECTL_CALL_LOG" ]; then ko "$name: kubectl was called before the guard"; cat "$KUBECTL_CALL_LOG"; return; fi
  ok "$name"
}

expect_guard "missing-key" "PG_BACKUP_KEY" KUBECONFIG="$KUBECONFIG_REAL"
expect_guard "bad-shape" "must look like pg/" PG_BACKUP_KEY=prod-2026.dump KUBECONFIG="$KUBECONFIG_REAL"
expect_guard "traversal" "must not contain" PG_BACKUP_KEY=pg/../../x.sql.gz KUBECONFIG="$KUBECONFIG_REAL"
expect_guard "absent-kubeconfig" "KUBECONFIG file not found" PG_BACKUP_KEY="$KEY" KUBECONFIG="$scratch/nope"
expect_guard "prod-namespace" "refusing production namespace" PG_BACKUP_KEY="$KEY" KUBECONFIG="$KUBECONFIG_REAL" RESTORE_NAMESPACE=sentropic
expect_guard "preprod-namespace" "refusing preprod namespace" PG_BACKUP_KEY="$KEY" KUBECONFIG="$KUBECONFIG_REAL" RESTORE_NAMESPACE=sentropic-preprod
expect_guard "live-host" "refusing live Postgres host" PG_BACKUP_KEY="$KEY" KUBECONFIG="$KUBECONFIG_REAL" RESTORE_PGHOST=postgres
expect_guard "live-db" "refusing live database name" PG_BACKUP_KEY="$KEY" KUBECONFIG="$KUBECONFIG_REAL" RESTORE_PGDB=app

# scratch bucket equal to the source: read-only get secret allowed, no run.
: > "$KUBECTL_CALL_LOG"
out="" status=0
out="$(make --no-print-directory k8s-pgbackup-restore PG_BACKUP_KEY="$KEY" KUBECONFIG="$KUBECONFIG_REAL" RESTORE_SCRATCH_BUCKET="$SRC_LIVE" ENV=test-app-w0-restore 2>&1)" || status=$?
if [ "$status" -eq 0 ]; then ko "scratch-equals-source: target succeeded"; fi
case "$out" in *"refusing scratch bucket"*) ;; *) ko "scratch-equals-source: missing message"; printf '%s\n' "$out" ;; esac
case "$(cat "$KUBECTL_CALL_LOG")" in *" run "*) ko "scratch-equals-source: kubectl run was reached" ;; *) ok "scratch-equals-source (read-only get, no run)" ;; esac

# identity without pod rights: can-i check fails, no run.
export SHIM_CAN_I=no
: > "$KUBECTL_CALL_LOG"
out="" status=0
out="$(make --no-print-directory k8s-pgbackup-restore PG_BACKUP_KEY="$KEY" KUBECONFIG="$KUBECONFIG_REAL" ENV=test-app-w0-restore 2>&1)" || status=$?
if [ "$status" -eq 0 ]; then ko "denied-identity: target succeeded"; fi
case "$out" in *"cannot create pods"*) ;; *) ko "denied-identity: missing message"; printf '%s\n' "$out" ;; esac
case "$(cat "$KUBECTL_CALL_LOG")" in *" run "*) ko "denied-identity: kubectl run was reached" ;; *) ok "denied-identity (can-i check, no run)" ;; esac
export SHIM_CAN_I=yes

# valid isolated inputs: guards pass, target reaches run in the restore ns only.
: > "$KUBECTL_CALL_LOG"
out="" status=0
out="$(make --no-print-directory k8s-pgbackup-restore PG_BACKUP_KEY="$KEY" KUBECONFIG="$KUBECONFIG_REAL" ENV=test-app-w0-restore 2>&1)" || status=$?
if [ "$status" -eq 0 ]; then ko "isolated-run: target succeeded without a cluster"; fi
case "$out" in *"Running restore pod"*) ;; *) ko "isolated-run: missing pod message"; printf '%s\n' "$out" ;; esac
log="$(cat "$KUBECTL_CALL_LOG")"
case "$log" in *"-n sentropic-restore-app-cm"*" run "*) ok "isolated-run (restore namespace only)" ;; *) ko "isolated-run: wrong kubectl destination"; printf '%s\n' "$log" ;; esac
case "$log" in *"-n sentropic "*|*"sentropic-preprod"*) ko "isolated-run: live namespace touched" ;; *) ok "isolated-run (no live namespace)" ;; esac

printf 'pass=%d fail=%d\n' "$pass" "$fail"
test "$fail" -eq 0
