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
    case " $SHIM_NS_NO " in *" $ns "*) printf 'no\n' ;; *) case "$ns" in sentropic|sentropic-preprod) printf '%s\n' "$SHIM_PROD_CAN_I" ;; *) printf '%s\n' "$SHIM_CAN_I" ;; esac ;; esac
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
export SHIM_NS_NO=""
: > "$KUBECTL_CALL_LOG"
: > "$KUBECTL_RUN_ARGS"

KUBECONFIG_REAL="$scratch/kubeconfig"
touch "$KUBECONFIG_REAL"
KEY=pg/20261022T020015Z.sql.gz
SHA_GOOD=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
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
expect_guard "hex-ip" "hex" PG_BACKUP_KEY="$KEY" RESTORE_PGHOST=0x0af40005
expect_guard "short-digit" "illegal characters" PG_BACKUP_KEY="$KEY" RESTORE_PGHOST=9db
expect_guard "missing-sha" "required" PG_BACKUP_KEY="$KEY"
expect_guard "absent-restore-kubeconfig-file" "RESTORE_KUBECONFIG file not found" PG_BACKUP_KEY="$KEY" RESTORE_KUBECONFIG="$scratch/nope"

# No RESTORE_KUBECONFIG at all: must fail before any kubectl call.
: > "$KUBECTL_CALL_LOG"
out="" status=0
out="$(make --no-print-directory k8s-pgbackup-restore PG_BACKUP_KEY="$KEY" ENV=test-app-w0-restore 2>&1)" || status=$?
if [ "$status" -eq 0 ]; then ko "no-restore-kubeconfig: target succeeded"; fi
case "$out" in *"RESTORE_KUBECONFIG is required"*) ;; *) ko "no-restore-kubeconfig: missing message"; printf '%s\n' "$out" ;; esac
if [ -s "$KUBECTL_CALL_LOG" ]; then ko "no-restore-kubeconfig: kubectl was called"; else ok "no-restore-kubeconfig (no default identity)"; fi

# Default prod-admin kubeconfig path: refused even though it is a set value.
# Hermetic: stage the file under a fake HOME so the default-path refusal (not
# the file-missing guard) fires identically on machines with or without it.
mkdir -p "$scratch/fakehome/.kube"
printf 'fake' > "$scratch/fakehome/.kube/poc.yaml"
: > "$KUBECTL_CALL_LOG"
out="" status=0
out="$(HOME="$scratch/fakehome" make --no-print-directory k8s-pgbackup-restore PG_BACKUP_KEY="$KEY" RESTORE_KUBECONFIG="$scratch/fakehome/.kube/poc.yaml" ENV=test-app-w0-restore 2>&1)" || status=$?
if [ "$status" -eq 0 ]; then ko "default-kubeconfig: target succeeded"; fi
case "$out" in *"refusing default kubeconfig"*) ;; *) ko "default-kubeconfig: missing message"; printf '%s\n' "$out" ;; esac
if [ -s "$KUBECTL_CALL_LOG" ]; then ko "default-kubeconfig: kubectl was called"; else ok "default-kubeconfig refused"; fi

# Admin-capable identity: negative prod/preprod can-i checks must refuse it.
export SHIM_PROD_CAN_I=yes
: > "$KUBECTL_CALL_LOG"
out="" status=0
out="$(make --no-print-directory k8s-pgbackup-restore PG_BACKUP_KEY="$KEY" PG_BACKUP_SHA256="$SHA_GOOD" RESTORE_KUBECONFIG="$KUBECONFIG_REAL" ENV=test-app-w0-restore 2>&1)" || status=$?
if [ "$status" -eq 0 ]; then ko "admin-identity: target succeeded"; fi
case "$out" in *"refusing"*) ;; *) ko "admin-identity: missing message"; printf '%s\n' "$out" ;; esac
case "$(cat "$KUBECTL_CALL_LOG")" in *" run "*) ko "admin-identity: kubectl run was reached" ;; *) ok "admin-identity refused (negative can-i, no run)" ;; esac
export SHIM_PROD_CAN_I=no

# Namespace override must not bypass the negative checks: literals probed too.
export SHIM_PROD_CAN_I=yes SHIM_NS_NO="x y"
: > "$KUBECTL_CALL_LOG"
out="" status=0
out="$(make --no-print-directory k8s-pgbackup-restore PG_BACKUP_KEY="$KEY" PG_BACKUP_SHA256="$SHA_GOOD" RESTORE_KUBECONFIG="$KUBECONFIG_REAL" K8S_NAMESPACE=x K8S_PREPROD_NAMESPACE=y ENV=test-app-w0-restore 2>&1)" || status=$?
if [ "$status" -eq 0 ]; then ko "ns-override: target succeeded"; fi
case "$(cat "$KUBECTL_CALL_LOG")" in *" run "*) ko "ns-override: kubectl run was reached (namespace override bypass)" ;; *) ok "ns-override refused (literal namespaces probed)" ;; esac
export SHIM_PROD_CAN_I=no SHIM_NS_NO=""

# Valid isolated inputs: guards pass, run reaches the restore namespace only.
: > "$KUBECTL_CALL_LOG"
: > "$KUBECTL_RUN_ARGS"
out="" status=0
out="$(make --no-print-directory k8s-pgbackup-restore PG_BACKUP_KEY="$KEY" PG_BACKUP_SHA256="$SHA_GOOD" RESTORE_KUBECONFIG="$KUBECONFIG_REAL" ENV=test-app-w0-restore 2>&1)" || status=$?
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
case "$init_part" in *'/s5cmd '*) ok "pod-spec (init calls /s5cmd)" ;; *) ko "pod-spec: init must call /s5cmd by absolute path" ;; esac
case "$init_part" in *'; s5cmd '*|*'"s5cmd '*) ko "pod-spec: bare s5cmd token in init" ;; *) ok "pod-spec (no bare s5cmd token)" ;; esac
if printf '%s' "$main_part" | grep -F -q 'tr -d "\n"'; then ok "pod-spec (listing tr quoted)"; else ko "pod-spec: listing tr must be double-quoted"; fi
if printf '%s' "$main_part" | grep -F -q 'tr -d "\042\012"'; then ok "pod-spec (versions tr quoted)"; else ko "pod-spec: versions tr must be double-quoted"; fi

# Manifest execution proof: run the captured pod script with a stubbed psql and
# adversarial listing/versions, then check the B03 manifest content byte-exact.
# /work is absolute and unwritable in test sandboxes, so the proof executes a
# copy whose only change is the /work prefix rewritten to scratch (the quoting
# bytes are proven untouched by the byte counts below).
mkdir -p "$scratch/workrun" "$scratch/stubbin"
printf 'CREATE TABLE t(n int);\nINSERT INTO t VALUES (42);\n' | gzip -n > "$scratch/dump.sql.gz"
SHA_REAL="$(sha256sum "$scratch/dump.sql.gz" | cut -d' ' -f1)"
: > "$KUBECTL_CALL_LOG"
: > "$KUBECTL_RUN_ARGS"
out="" status=0
out="$(make --no-print-directory k8s-pgbackup-restore PG_BACKUP_KEY="$KEY" PG_BACKUP_SHA256="$SHA_REAL" RESTORE_KUBECONFIG="$KUBECONFIG_REAL" ENV=test-app-w0-restore 2>&1)" || status=$?
sed -n '/-- sh -c /,$p' "$KUBECTL_RUN_ARGS" | sed '1s/.*-- sh -c //' > "$scratch/pod-main.sh"
if [ -s "$scratch/pod-main.sh" ]; then ok "manifest-exec (pod script captured)"; else ko "manifest-exec: no pod script captured"; fi
sed 's#/work#'"$scratch/workrun"'#g' "$scratch/pod-main.sh" > "$scratch/pod-main-run.sh"
for qc in "'" '"' '\'; do
  if [ "$(tr -cd "$qc" < "$scratch/pod-main.sh" | wc -c)" = "$(tr -cd "$qc" < "$scratch/pod-main-run.sh" | wc -c)" ]; then :; else ko "manifest-exec: quoting byte changed ($qc)"; fi
done
ok "manifest-exec (rewrite preserves quoting bytes)"
cat > "$scratch/manifest-runner.sh" <<RUNNER
#!/usr/bin/env bash
set -u
cp "$scratch/dump.sql.gz" "$scratch/workrun/d.sql.gz"
printf '2026-10-26 11:14:31 bananas q 1234n\n' > "$scratch/workrun/listing"
printf 'ver"si0n-1244"n\n' > "$scratch/workrun/versions"
cat > "$scratch/stubbin/psql" <<'PSEOF'
#!/usr/bin/env bash
echo "psql \$*" >> "\$PSQL_LOG"
for a in "\$@"; do case "\$a" in *"count(*) FROM organizations"*) echo 7; exit 0;; esac; done
exit 0
PSEOF
chmod +x "$scratch/stubbin/psql"
export PATH="$scratch/stubbin:$PATH" PSQL_LOG="$scratch/psql.log"
export PGHOST=postgres-restore PGPORT=5432 PGUSER=app_cm_restore PGDATABASE=app_cm_restore
export PG_BACKUP_KEY="$KEY" PG_BACKUP_SHA256="\$SHA_REAL" KEEP_DB=false RESTORE_NAMESPACE=sentropic-restore-app-cm SRC_BUCKET=my-bucket
bash "$scratch/pod-main-run.sh"
RUNNER
mout="" mstatus=0
mout="$(SHA_REAL="$SHA_REAL" bash "$scratch/manifest-runner.sh" 2>&1)" || mstatus=$?
if [ "$mstatus" -eq 0 ]; then ok "manifest-exec (restore script runs)"; else ko "manifest-exec: restore script failed"; printf '%s\n' "$mout"; fi
block="$(printf '%s\n' "$mout" | sed -n '/MANIFEST-BEGIN/,/MANIFEST-END/p' | sed '1d;$d')"
if printf '%s' "$block" | jq -e . >/dev/null 2>&1; then ok "manifest-exec (JSON valid)"; else ko "manifest-exec: invalid JSON"; printf '%s\n' "$block"; fi
[ "$(printf '%s' "$block" | jq -r .manifest)" = "b03-backup-object" ] || ko "manifest-exec: bad manifest marker"
[ "$(printf '%s' "$block" | jq -r .listing)" = '2026-10-26 11:14:31 bananas q 1234n' ] || ko "manifest-exec: listing corrupted"
[ "$(printf '%s' "$block" | jq -r .versions)" = 'versi0n-1244n' ] || ko "manifest-exec: versions corrupted"
[ "$(printf '%s' "$block" | jq -r .etag)" = "bananas" ] || ko "manifest-exec: bad etag"
[ "$(printf '%s' "$block" | jq -r .sha256)" = "$SHA_REAL" ] || ko "manifest-exec: bad sha"
[ "$(printf '%s' "$block" | jq -r .sha256_checked)" = "true" ] || ko "manifest-exec: sha not checked"
[ "$(printf '%s' "$block" | jq -r .organizations)" = "7" ] || ko "manifest-exec: bad organizations"
ok "manifest-exec (content byte-exact)"
mout="" mstatus=0
mout="$(SHA_REAL=0000000000000000000000000000000000000000000000000000000000000000 bash "$scratch/manifest-runner.sh" 2>&1)" || mstatus=$?
case "$mout" in *"mismatch"*) ok "manifest-exec (sha mismatch fails closed)" ;; *) ko "manifest-exec: sha mismatch not refused" ;; esac

printf 'pass=%d fail=%d\n' "$pass" "$fail"
test "$fail" -eq 0
