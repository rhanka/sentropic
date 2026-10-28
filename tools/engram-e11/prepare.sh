#!/usr/bin/env bash
set -euo pipefail
repo="$1"
out="$2"
snapshot=afd283ec8054abb4bb16dd74428bb51bea136fcc
qualified=cf1e537a8810a49d50d442169474f3b893103e6f
tree=8b14cca07a28aeaf644bd05b718120a9b29c9321
test "$(git rev-parse "$qualified^{tree}")" = "$tree"
test -z "$(git diff --name-only "$qualified" "$snapshot" -- packages/cluster-mesh/src packages/cluster-mesh/assets packages/cluster-mesh/package.json)"
mkdir -p "$out/source" "$out/consumer"
# Snapshot committed inputs, rather than a concurrently edited E10 worktree.
git archive "$snapshot" packages/cluster-mesh/src packages/cluster-mesh/assets packages/cluster-mesh/package.json \
  packages/cluster-mesh/tests/engram-memory package-lock.json docker-compose.immo-861.yml \
  tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json > "$out/source.tar"
tar -xf "$out/source.tar" -C "$out/source"
printf '{"snapshotHead":"%s","qualifiedHead":"%s","qualifiedTree":"%s","packedDrift":[]}\n' \
  "$snapshot" "$qualified" "$tree" > "$out/source-identity.json"
inputs="$repo/.tmp/engram-e2-host-tuple"
retained="$inputs/e10-artifacts/rerun-cf1e537a8"
cp "$retained/installed-receipt.json" "$out/receipt.json"
cp "$retained/installed-consumer-package.json" "$out/consumer-package.json"
cp "$retained/installed-consumer-package-lock.json" "$out/consumer-lock.json"
cp "$retained/campaign.log" "$retained/campaign.status" "$out/"
cp "$inputs/e10-artifacts/sentropic-engram-0.22.0.tgz" "$out/engram.tgz"
cp "$inputs/e10-artifacts/sentropic-cluster-mesh-0.24.0-dev.5.tgz" "$out/mesh.tgz"
cp "$inputs/RESERVATION.md" "$out/reservation.md"
cp "$repo/.h2a/reviews/pr803_opus_r3.md" "$out/review-r3.md"
# Retained closure only; preparation performs neither npm install nor qualification.
cp -a "$repo/tmp/worktrees/mem-e10-fin/tmp/installed-memory-e10/consumer/node_modules" "$out/consumer/"
cp "$repo/tmp/worktrees/mem-e10-fin/tmp/installed-memory-e10/consumer/"{installed-memory.mjs,installed-hydration.mjs,installed-memory-types.ts,package.json,package-lock.json} "$out/consumer/"
gh pr view 803 --repo rhanka/sentropic --json body --jq .body > "$out/pr803.md"
gh api "repos/rhanka/sentropic/actions/runs?head_sha=$snapshot&event=pull_request&per_page=100" > "$out/ci.json"
cp tools/engram-e11/{candidates,bindings,slots,validate,tuple}.mjs "$out/"
printf '%s\n' "Retained candidate snapshot: $out"
