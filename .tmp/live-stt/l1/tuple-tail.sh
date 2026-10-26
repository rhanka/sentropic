# Appended to the existing cold-workspace bootstrap inside the qualification container.
/tmp/cm-tools/node_modules/.bin/tsc -p tsconfig.json
l1_workspace="$(cd ../.. && pwd)"
l1_siblings="$l1_workspace/tmp/l1-siblings"
mkdir -p "$l1_siblings/receipts" "$l1_siblings/llm-mesh" "$l1_siblings/llm-gateway"
printf '%s\n' llm-mesh llm-gateway > "$l1_siblings/plan.txt"
export MANIFEST_GUARD_TOOL_DIR=/tmp/cm-tools MANIFEST_SEVERITY=block
for slug in llm-mesh llm-gateway; do
  (cd "$l1_workspace/packages/$slug" && node "$l1_workspace/scripts/ci/publishable-manifests.mjs" pack \
    --slug "$slug" --report-dir "$l1_siblings/receipts" --destination "$l1_siblings/$slug")
done
node "$l1_workspace/scripts/ci/publishable-manifests.mjs" sibling-collect --dir "$l1_siblings"
if [ "${L1_ALIGN:-}" = 1 ]; then
  node /source/.tmp/live-stt/l1/align-selected.mjs "$l1_siblings"
  cp /source/packages/cluster-mesh/tests/packaging/fixtures/selected/package*.json tests/packaging/fixtures/selected/
fi
export CLUSTER_MESH_SIBLING_RECEIPTS="$l1_siblings/receipts.json" CLUSTER_MESH_HEAD_SHA="$MANIFEST_HEAD_SHA"
sh tests/packaging/prepare.sh /tmp/lazy-package
cp vitest.config.ts /tmp/lazy-package/tools/vitest.config.ts
CLUSTER_MESH_PACKAGING_DIR=/tmp/lazy-package NODE_PATH=/tmp/lazy-package/tools/node_modules \
  /tmp/lazy-package/tools/node_modules/.bin/vitest run tests/packaging \
  --config /tmp/lazy-package/tools/vitest.config.ts --environment node --maxWorkers=1
