#!/bin/sh
set -eu
fail() { echo "$1" >&2; exit 1; }
case "$DRY_RUN" in 0|1) ;; *) fail 'invalid dry-run mode' ;; esac
case "$MAX_SNAPSHOT_AGE_S" in ''|*[!0-9]*) fail 'invalid snapshot age limit' ;; esac
# The relay contains exactly these three files; refuse paths outside the input set.
awk 'NF != 2 || $1 !~ /^[a-f0-9]+$/ || length($1) != 64 || ($2 != "users.csv" && $2 != "webauthn.csv" && $2 != "snapshot.csv") {exit 1} {seen[$2]++} END {if (NR != 3 || seen["users.csv"] != 1 || seen["webauthn.csv"] != 1 || seen["snapshot.csv"] != 1) exit 1}' SHA256SUMS || fail 'invalid checksum manifest'
sha256sum -c SHA256SUMS > /work/check.log 2>&1 || fail 'relay integrity check failed'
IFS=, read -r snap_ts nu nw < snapshot.csv
case "$nu:$nw" in *[!0-9:]*|:*|*:) fail 'invalid snapshot counts' ;; esac
snapshot_epoch=$(date -u -d "${snap_ts%%.*}" +%s 2>/work/date.log) || fail 'invalid snapshot timestamp'
age=$(( $(date -u +%s) - snapshot_epoch ))
[ "$age" -ge 0 ] && [ "$age" -le "$MAX_SNAPSHOT_AGE_S" ] || fail 'snapshot outside freshness window'
echo "users=$nu webauthn=$nw age_s=$age"
# SQL errors can contain row values: never forward raw stderr or unfiltered rows.
psql -XAtq -v ON_ERROR_STOP=1 -v dry_run="$DRY_RUN" -v allowed_rekey="$ALLOWED_REKEY" \
  -v expected_users="$nu" -v expected_webauthn="$nw" -f /sql/import-preprod.sql \
  > /work/audit.log 2>/work/import-error.log || fail 'identity import failed (transaction aborted)'
awk -F '|' '
  /^(synced_users|synced_webauthn|rekeyed|preprod_only_kept|post_users|post_webauthn|rekey_dropped_sessions|rekey_moved_webauthn)\|[0-9]+$/ {counts[$1]=$2; next}
  /^rekey [a-f0-9-]+ -> [a-f0-9-]+$/ {
    split($0, ids, " "); pairs = pairs sep "{\"old_id\":\"" ids[2] "\",\"new_id\":\"" ids[4] "\"}"; sep=","; n++; next
  }
  $0 == "COMMITTED" {outcome="committed"}
  $0 == "DRY RUN: rolled back" {outcome="rolled_back"}
  END {
    split("synced_users synced_webauthn rekeyed preprod_only_kept post_users post_webauthn rekey_dropped_sessions rekey_moved_webauthn", keys, " ")
    if (outcome == "" || n+0 != counts["rekeyed"]+0) exit 1
    printf "{\"outcome\":\"%s\",\"rekey_pairs\":[%s]", outcome, pairs
    for (i=1; i<=8; i++) {if (!(keys[i] in counts)) exit 1; printf ",\"%s\":%d", keys[i], counts[keys[i]]}
    print "}"
  }
' /work/audit.log > /work/audit.json || fail 'invalid audit summary'
cat /work/audit.json > /dev/termination-log
cat /work/audit.json
