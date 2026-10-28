#!/usr/bin/env bash
set -euo pipefail
repo="$1"
out="$2"
snapshot=32dd911be19f0874459a1b4e697d7175bb6b433f
tree=9dcd865487004e28649f3d68c842f328cc4d1952
test "$(git rev-parse "$snapshot^{tree}")" = "$tree"
test -z "$(git diff --name-only eb79034df17ed5e2cb2ddcc3288b9b8bbb682120 "$snapshot" -- packages/cluster-mesh/src packages/cluster-mesh/assets packages/cluster-mesh/package.json)"
mkdir -p "$out/source" "$out/consumer" "$out/artifacts"
git archive "$snapshot" packages/cluster-mesh/src packages/cluster-mesh/assets packages/cluster-mesh/package.json \
  packages/cluster-mesh/tests/engram-memory package-lock.json docker-compose.immo-861.yml \
  tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json > "$out/source.tar"
tar -xf "$out/source.tar" -C "$out/source"
printf "{\"snapshotHead\":\"%s\",\"qualifiedHead\":\"%s\",\"qualifiedTree\":\"%s\",\"packedDrift\":[]}\n" \
  "$snapshot" "$snapshot" "$tree" > "$out/source-identity.json"
inputs="$repo/.tmp/engram-e2-host-tuple"
cp "$inputs/e10-artifacts/sentropic-cluster-mesh-0.24.0-dev.6.tgz" "$out/mesh.tgz"
cp "$inputs/neutral-contract-1.0.0.jcs.json" "$out/neutral-contract-1.0.0.jcs.json"
cp "$inputs/engram-0.21.3.md" "$out/producer.md"
cp "$inputs/e10-artifacts/e10a3-delivery.json" "$out/e10a3-delivery.json"
cp "$inputs/e10-artifacts/e10a3-pack/cluster-mesh.receipt.json" "$out/pack-receipt.json"
cp "$inputs/RESERVATION.md" "$out/reservation.md"
cp "$repo/.h2a/reviews/pr803_opus_r3.md" "$out/review-r3.md"
cp "$inputs/evidence/engram-e2-format-README.md" "$out/format.md"
cp "$inputs/validator/scripts/memory-mcp-e2-manifest.mjs" "$out/receiving-validator.mjs"
curl -fsSL https://registry.npmjs.org/@sentropic%2fengram/0.21.3 -o "$out/engram-registry.json"
curl -fsSL https://registry.npmjs.org/@sentropic/engram/-/engram-0.21.3.tgz -o "$out/engram.tgz"
curl -sSL -o "$out/reserved-registry.json" -w "%{http_code}\n" https://registry.npmjs.org/@sentropic%2fcluster-mesh/0.24.0 > "$out/reserved-registry.status"
gh pr view 803 --repo rhanka/sentropic --json body --jq .body > "$out/pr803.md"
gh api "repos/rhanka/sentropic/actions/runs?head_sha=$snapshot&per_page=100" > "$out/ci.json"
cp tools/engram-e11/{candidates,bindings,slots,validate,tuple}.mjs "$out/"
sha256sum "$out/engram.tgz" "$out/mesh.tgz" "$out/neutral-contract-1.0.0.jcs.json"
