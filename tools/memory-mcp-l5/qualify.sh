#!/bin/sh
# Called by make under the shared flock. Keep every failure and clean up on exit.
set -u
test "$ENV" = test-memory-l5 || exit 2
git diff --quiet HEAD -- tools/memory-mcp-l5 packages Makefile || { echo 'Commit qualification code before running' >&2; exit 2; }
manifest=$1
checkpoint=$2
out=spec/evidence/memory-mcp-l5/r5-run
test ! -e "$out/exits.tsv" || { echo 'Immutable run output already exists' >&2; exit 2; }
test -f "$out/execution-context.json" || { echo 'Execution context must precede test execution' >&2; exit 2; }
mkdir -p "$out"
trap 'make down API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-memory-l5 > "$out/cleanup.log" 2>&1' EXIT
run() {
  label=$1; shift
  printf 'make' > "$out/$label.command"
  printf ' %s' "$@" >> "$out/$label.command"
  printf ' API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-memory-l5\n' >> "$out/$label.command"
  make "$@" API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-memory-l5 > "$out/$label.log" 2>&1
  code=$?
  printf '%s\t%s\n' "$label" "$code" >> "$out/exits.tsv"
  printf '%s: exit %s\n' "$label" "$code"
}
run reference memory-l5-gate LOT=reference ARTIFACT_MANIFEST=tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json
run lot2 memory-l5-test LOT=2 "ARTIFACT_MANIFEST=$manifest"
run lot3 memory-l5-test LOT=3 "ARTIFACT_MANIFEST=$manifest"
if [ -e tmp/memory-l5-lot3-results ]; then mv tmp/memory-l5-lot3-results "$out/prior-source-reports"; fi
run source memory-l5-lot3-source
run tooling memory-l5-tooling "MEMORY_L5_REPORT=/workspace/$out/tooling.json"
run native-positive memory-l5-native-positive "MEMORY_L5_REPORT=/workspace/$out/native-positive.json"
run disabled-install memory-l5-disabled-install "ARTIFACT_MANIFEST=$manifest" "NATIVE_OUTPUT=$out/disabled-install"
for scope in exports disabled-install identity-source-refusal sdk-discovery-call restart-lost-response confirmation-step-up; do
  run "packed-$scope" memory-l5-packed "SCOPE=packed/$scope.test.ts" "ARTIFACT_MANIFEST=$manifest" \
    "NATIVE_OUTPUT=$out/packed-disabled" "MEMORY_L5_REPORT=/workspace/$out/packed-$scope.json"
done
run collect memory-l5-collect "ARTIFACT_MANIFEST=$manifest" "CHECKPOINT=$checkpoint"
run proposal memory-l5-checkpoint "ARTIFACT_MANIFEST=$manifest" "CHECKPOINT=$checkpoint" "CHECKPOINT_INPUTS=$out/checkpoint-inputs.json"
run preflight memory-l5-receipt MODE=preflight "ARTIFACT_MANIFEST=$manifest" "CHECKPOINT=$checkpoint"
run checkpoint memory-l5-receipt MODE=checkpoint "ARTIFACT_MANIFEST=$manifest" "CHECKPOINT=$checkpoint"
test "$(awk '$2 != 0 { n++ } END { print n+0 }' "$out/exits.tsv")" = 0
