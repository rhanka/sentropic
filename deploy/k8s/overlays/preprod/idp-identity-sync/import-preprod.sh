#!/bin/sh
set -eu
fail() {
  printf '{"outcome":"failed","code":"%s"%s}\n' "$1" "${2:-}" > /dev/termination-log
  printf '%s\n' "$1" >&2
  exit 1
}
sql_failure() {
  code=sql_error
  if grep -Fq 'ERROR:  re-key not covered by allowed_rekey: ' /work/import-error.log; then code=rekey_not_allowed
  elif grep -Fq 'ERROR:  export row count does not match manifest' /work/import-error.log; then code=manifest_mismatch
  elif grep -Fq 'ERROR:  empty users export' /work/import-error.log; then code=empty_export
  elif grep -Fq 'ERROR:  consent client map target missing' /work/import-error.log; then code=consent_client_missing
  elif grep -Fq 'ERROR:  consent post-condition failed' /work/import-error.log; then code=consent_postcondition_failed
  elif grep -Fq 'ERROR:  client source missing' /work/import-error.log; then code=client_source_missing
  elif grep -Fq 'ERROR:  client policy invalid' /work/import-error.log; then code=client_policy_invalid
  elif grep -Fq 'ERROR:  client post-condition failed' /work/import-error.log; then code=client_postcondition_failed
  elif grep -Fq 'ERROR:  post: DV5 invariant changed (oauth_clients / signing keys)' /work/import-error.log; then code=dv5_invariant_changed
  elif grep -Fq 'ERROR:  post: a prod user id is missing' /work/import-error.log ||
       grep -Fq 'ERROR:  post: a prod email is not bound to its prod id' /work/import-error.log ||
       grep -Fq 'ERROR:  post: a prod credential is missing or bound to another user' /work/import-error.log; then code=postcondition_failed
  elif grep -Fq 'ERROR:  canceling statement due to lock timeout' /work/import-error.log; then code=lock_timeout
  fi
  if [ "$code" = rekey_not_allowed ]; then
    uuid='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'
    pairs=$(sed -n 's/^.*ERROR:  re-key not covered by allowed_rekey: //p' /work/import-error.log | tr ',' '\n' | {
      sep=''
      while IFS= read -r pair; do
        if printf '%s\n' "$pair" | grep -Eq "^$uuid>$uuid$"; then printf '%s"%s"' "$sep" "$pair"; sep=,; fi
      done
    })
    fail "$code" ",\"rejected_rekey_pairs\":[$pairs]"
  fi
  fail "$code"
}
case "${DRY_RUN:-}" in 0|1) ;; *) fail invalid_dry_run ;; esac
case "${MAX_SNAPSHOT_AGE_S:-}" in ''|*[!0-9]*) fail invalid_age_limit ;; esac
# The relay has five files; client/host policies come from the ConfigMap.
awk 'NF != 2 || $1 !~ /^[a-f0-9]+$/ || length($1) != 64 || ($2 != "users.csv" && $2 != "webauthn.csv" && $2 != "consents.csv" && $2 != "clients.csv" && $2 != "snapshot.csv") {exit 1} {seen[$2]++} END {if (NR != 5 || seen["users.csv"] != 1 || seen["webauthn.csv"] != 1 || seen["consents.csv"] != 1 || seen["clients.csv"] != 1 || seen["snapshot.csv"] != 1) exit 1}' SHA256SUMS 2>/work/manifest-error.log || fail invalid_manifest
sha256sum -c SHA256SUMS > /work/check.log 2>&1 || fail integrity_failed
IFS=, read -r snap_ts nu nw nc nclients < snapshot.csv || [ -n "$nclients" ] || fail invalid_counts
cr=$(printf '\r')
snap_ts=${snap_ts%"$cr"}; nu=${nu%"$cr"}; nw=${nw%"$cr"}; nc=${nc%"$cr"}; nclients=${nclients%"$cr"}
case "$nu" in ''|*[!0-9]*) fail invalid_counts ;; esac
case "$nw" in ''|*[!0-9]*) fail invalid_counts ;; esac
case "$nc" in ''|*[!0-9]*) fail invalid_counts ;; esac
case "$nclients" in ''|*[!0-9]*) fail invalid_counts ;; esac
snapshot_epoch=$(date -u -d "${snap_ts%%.*}" +%s 2>/work/date.log) || fail invalid_timestamp
age=$(( $(date -u +%s) - snapshot_epoch ))
[ "$age" -ge 0 ] && [ "$age" -le "$MAX_SNAPSHOT_AGE_S" ] || fail stale_snapshot
# SQL errors can contain row values: never forward raw stderr or unfiltered rows.
psql -XAtq -v ON_ERROR_STOP=1 -v dry_run="$DRY_RUN" -v allowed_rekey="${ALLOWED_REKEY:-}" \
  -v expected_users="$nu" -v expected_webauthn="$nw" -v expected_consents="$nc" -v expected_clients="$nclients" \
  -v allowed_clients="${ALLOWED_CLIENTS:-}" \
  -f /sql/import-preprod.sql \
  > /work/audit.log 2>/work/import-error.log || sql_failure
awk -F '|' '
  /^(synced_users|synced_webauthn|rekeyed|preprod_only_kept|post_users|post_webauthn|rekey_dropped_sessions|rekey_moved_webauthn|consents_upserted|consents_removed|clients_upserted|clients_removed|clients_skipped_confidential)\|[0-9]+$/ {counts[$1]=$2; next}
  /^rekey [a-f0-9-]+ -> [a-f0-9-]+$/ {
    split($0, ids, " "); pairs = pairs sep "{\"old_id\":\"" ids[2] "\",\"new_id\":\"" ids[4] "\"}"; sep=","; n++; next
  }
  $0 == "COMMITTED" {outcome="committed"}
  $0 == "DRY RUN: rolled back" {outcome="rolled_back"}
  END {
    split("synced_users synced_webauthn rekeyed preprod_only_kept post_users post_webauthn rekey_dropped_sessions rekey_moved_webauthn consents_upserted consents_removed clients_upserted clients_removed clients_skipped_confidential", keys, " ")
    if (outcome == "" || n+0 != counts["rekeyed"]+0) exit 1
    printf "{\"outcome\":\"%s\",\"rekey_pairs\":[%s]", outcome, pairs
    for (i=1; i<=13; i++) {if (!(keys[i] in counts)) exit 1; printf ",\"%s\":%d", keys[i], counts[keys[i]]}
    print "}"
  }
' /work/audit.log > /work/audit.json || fail invalid_audit
cat /work/audit.json > /dev/termination-log
cat /work/audit.json
