#!/bin/sh
set -eu
fail() {
  printf '{"outcome":"failed","code":"%s"%s}\n' "$1" "${2:-}" > /dev/termination-log
  printf '%s\n' "$1" >&2
  exit 1
}
sql_failure() {
  code=sql_error
  if grep -Fq 'ERROR:  export row count does not match manifest' /work/import-error.log; then code=manifest_mismatch
  elif grep -Fq 'ERROR:  empty identity replica export' /work/import-error.log; then code=empty_export
  elif grep -Fq 'ERROR:  consent client map target missing' /work/import-error.log; then code=consent_client_missing
  elif grep -Fq 'ERROR:  consent post-condition failed' /work/import-error.log; then code=consent_postcondition_failed
  elif grep -Fq 'ERROR:  client source missing' /work/import-error.log; then code=client_source_missing
  elif grep -Fq 'ERROR:  client policy invalid' /work/import-error.log; then code=client_policy_invalid
  elif grep -Fq 'ERROR:  client post-condition failed' /work/import-error.log; then code=client_postcondition_failed
  elif grep -Fq 'ERROR:  post: DV5 invariant changed (oauth_clients / signing keys)' /work/import-error.log; then code=dv5_invariant_changed
  elif grep -Fq 'ERROR:  canceling statement due to lock timeout' /work/import-error.log; then code=lock_timeout
  fi
  fail "$code"
}
sync_outcome() {
  # Phase 1 ran in the api runner initContainer (exit 0 on a business outcome).
  [ -f /work/cm-result.json ] || fail invalid_audit
  outcome=$(sed -n 's/.*"outcome":"\([a-z_]*\)".*/\1/p' /work/cm-result.json | head -1)
  case "$outcome" in
    committed|rolled_back) ;;
    failed)
      code=$(sed -n 's/.*"code":"\([a-z_]*\)".*/\1/p' /work/cm-result.json | head -1)
      case "$code" in
        identity_sync_conflict) fail identity_sync_conflict ",\"conflict_subject_ids\":[$(sed -n 's/.*"conflict_subject_ids":\[//;T;s/\].*//p' /work/cm-result.json)]" ;;
        identity_sync_invalid) fail identity_sync_invalid ;;
        *) fail sql_error ;;
      esac ;;
    *) fail invalid_audit ;;
  esac
}
case "${DRY_RUN:-}" in 0|1) ;; *) fail invalid_dry_run ;; esac
case "${MAX_SNAPSHOT_AGE_S:-}" in ''|*[!0-9]*) fail invalid_age_limit ;; esac
# The relay has five files: the CM batch, the replica user list, the protocol
# CSVs and the snapshot; client/host policies come from the ConfigMap.
awk 'NF != 2 || $1 !~ /^[a-f0-9]+$/ || length($1) != 64 || ($2 != "identity-replica-batch.json" && $2 != "replica-users.csv" && $2 != "consents.csv" && $2 != "clients.csv" && $2 != "snapshot.csv") {exit 1} {seen[$2]++} END {if (NR != 5 || seen["identity-replica-batch.json"] != 1 || seen["replica-users.csv"] != 1 || seen["consents.csv"] != 1 || seen["clients.csv"] != 1 || seen["snapshot.csv"] != 1) exit 1}' SHA256SUMS 2>/work/manifest-error.log || fail invalid_manifest
sha256sum -c SHA256SUMS > /work/check.log 2>&1 || fail integrity_failed
IFS=, read -r snap_ts na nw nc nclients < snapshot.csv || [ -n "$nclients" ] || fail invalid_counts
cr=$(printf '\r')
snap_ts=${snap_ts%"$cr"}; na=${na%"$cr"}; nw=${nw%"$cr"}; nc=${nc%"$cr"}; nclients=${nclients%"$cr"}
case "$na" in ''|*[!0-9]*) fail invalid_counts ;; esac
case "$nw" in ''|*[!0-9]*) fail invalid_counts ;; esac
case "$nc" in ''|*[!0-9]*) fail invalid_counts ;; esac
case "$nclients" in ''|*[!0-9]*) fail invalid_counts ;; esac
snapshot_epoch=$(date -u -d "${snap_ts%%.*}" +%s 2>/work/date.log) || fail invalid_timestamp
age=$(( $(date -u +%s) - snapshot_epoch ))
[ "$age" -ge 0 ] && [ "$age" -le "$MAX_SNAPSHOT_AGE_S" ] || fail stale_snapshot
# SQL errors can contain row values: never forward raw stderr or unfiltered rows.
. /sql/workload-credential.sh
prepare_workload_credential || fail workload_credential_invalid
# Phase 1 ran in the api runner initContainer (same guards, --dry-run from
# DRY_RUN). Its audit lines feed the merged termination JSON below; a failed
# batch stops here with the runner's code (conflict ids included).
grep '^{' /work/cm-sync.log | tail -1 > /work/cm-result.json || fail invalid_audit
sync_outcome
# Phase 2: app protocol convergence (psql, same transaction discipline as before).
psql -XAtq -v ON_ERROR_STOP=1 -v dry_run="$DRY_RUN" \
  -v expected_accounts="$na" -v expected_consents="$nc" -v expected_clients="$nclients" \
  -v allowed_clients="${ALLOWED_CLIENTS:-}" \
  > /work/audit.log 2>/work/import-error.log \
  -f /sql/import-preprod.sql || sql_failure
awk -F '|' '
  /^(synced_accounts|synced_credentials|synced_consents|synced_replica_users|consents_upserted|consents_removed|clients_upserted|clients_removed|clients_skipped_confidential|services_upserted|services_skipped_missing)\|[0-9]+$/ {counts[$1]=$2; next}
  $0 == "COMMITTED" {outcome="committed"}
  $0 == "DRY RUN: rolled back" {outcome="rolled_back"}
  END {
    split("synced_accounts synced_credentials synced_consents synced_replica_users consents_upserted consents_removed clients_upserted clients_removed clients_skipped_confidential services_upserted services_skipped_missing", keys, " ")
    if (outcome == "") exit 1
    printf "{\"outcome\":\"%s\"", outcome
    for (i=1; i<=11; i++) {if (!(keys[i] in counts)) exit 1; printf ",\"%s\":%d", keys[i], counts[keys[i]]}
    print "}"
  }
' /work/cm-sync.log /work/audit.log > /work/audit.json || fail invalid_audit
cat /work/audit.json > /dev/termination-log
cat /work/audit.json
