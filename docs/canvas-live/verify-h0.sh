#!/usr/bin/env bash
# Run from the implementation worktree through a make target (see h0-validation.md).
set -euo pipefail
rtk harness check branch
rtk proxy sha256sum -c docs/canvas-live/h0-inputs.sha256
rtk git diff --check
corpus=ui/tests/fixtures/canvas-live/b1-content.json
payloads=api/tests/fixtures/canvas-live/b1-save-payloads.json
inventory=docs/canvas-live/h0-inventory.md
rtk jq -e --rawfile inventory "$inventory" '
  [.cases[].id] as $ids |
  [.cases[].mounts[]] | unique as $covered |
  ($inventory | [scan("\\| ([A-Z]+[0-9]+) \\| [A-Z]+:[0-9]+ \\|")]) as $rows |
  ($rows | flatten) as $mounts |
  ($ids | length) == 28 and ($ids | unique | length) == 28 and
  ($mounts | length) == 24 and ($mounts | unique | length) == 24 and
  $covered == ($mounts | sort)
' "$corpus" > /dev/null
rtk jq -e '
  (.cases | length) == 12 and
  ([.cases[].id] | unique | length) == 12 and
  ([.cases[].authority] | unique | length) == 11 and
  .cases[0].before.executiveSummary.analyse == .cases[0].expectedPayload.executiveSummary.analyse and
  .cases[0].before.executiveSummary.references == .cases[0].expectedPayload.executiveSummary.references and
  .cases[2].before.valueScores[1] == .cases[2].expectedPayload.valueScores[1] and
  .cases[3].before.complexityAxes == .cases[3].expectedPayload.complexityAxes and
  .cases[3].before.valueThresholds == .cases[3].expectedPayload.valueThresholds and
  .cases[3].before.complexityThresholds == .cases[3].expectedPayload.complexityThresholds and
  .cases[4].route == null and .cases[4].expectedRequestsBeforeId == 0
' "$payloads" > /dev/null
rtk jq -e '
  [.cases[].oracle] | unique | length == 12
' "$corpus" > /dev/null
mount_count=0
file_count=0
while IFS='|' read -r empty alias source count rest; do
  [[ "$alias" =~ ^[[:space:]]+[A-Z]+[[:space:]]+$ && "$source" == *'`'* ]] || continue
  alias=${alias// /}
  source=${source//\`/}
  source=${source// /}
  source="ui/src/$source"
  observed=$(rtk proxy rg -c '<EditableInput' "$source")
  [[ "$observed" -eq "${count// /}" ]]
  while IFS='|' read -r blank mount site field class authority remainder; do
    [[ "$site" =~ ^[[:space:]]+$alias:([0-9]+)[[:space:]]+$ ]] || continue
    line=${BASH_REMATCH[1]}
    rtk sed -n "${line}p" "$source" | rtk proxy rg -q '<EditableInput'
    mount_count=$((mount_count + 1))
  done < "$inventory"
  file_count=$((file_count + 1))
done < "$inventory"
[[ "$mount_count" -eq 24 && "$file_count" -eq 10 ]]
[[ $(rtk proxy rg -n '<EditableInput' ui/src | rtk wc -l) -eq 24 ]]
[[ $(rtk proxy rg -c '^\| N[1-8] /' docs/canvas-live/h0-transfer-receipts.md) -eq 8 ]]
for row in 1 2 3 4 5 6 7 8; do
  [[ $(rtk proxy rg -c "^\\| N$row /" docs/canvas-live/h0-transfer-receipts.md) -eq 1 ]]
done
[[ $(rtk proxy rg -c '^\| .* \| plain \|' "$inventory") -eq 7 ]]
while IFS= read -r path; do
  case "$path" in
    BRANCH.md|docs/canvas-live/*|api/tests/fixtures/canvas-live/*|ui/tests/fixtures/canvas-live/*) ;;
    *) printf 'Out-of-scope path: %s\n' "$path" >&2; exit 1 ;;
  esac
done < <(rtk proxy git diff --name-only 5e986a0b6cd2dfecfbde6a588d30055271124696)
printf '%s\n' 'PASS H0: 42 input hashes; 28 UI cases; 12 payload cases; 24 unique mounts / 10 files / 7 plain; 8 receipts; scope unchanged.'
