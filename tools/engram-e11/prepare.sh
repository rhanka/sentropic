#!/usr/bin/env bash
set -euo pipefail
repo="$1"
out="$2"
snapshot=d1726c3092895d105eb1b56fe3357228b634760e
tree=76359b7e5cf64dab431dd1fdd94f73759f46dd81
test "$(git rev-parse "$snapshot^{tree}")" = "$tree"
test -z "$(git diff --name-only "$snapshot" HEAD -- packages/cluster-mesh)"
mkdir -p "$out/source" "$out/consumer" "$out/artifacts"
git archive "$snapshot" packages/cluster-mesh/src packages/cluster-mesh/assets packages/cluster-mesh/package.json \
  packages/cluster-mesh/tests/engram-memory package-lock.json docker-compose.immo-861.yml \
  tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json > "$out/source.tar"
tar -xf "$out/source.tar" -C "$out/source"
printf "{\"snapshotHead\":\"%s\",\"qualifiedHead\":\"%s\",\"qualifiedTree\":\"%s\",\"packedDrift\":[]}\n" \
  "$snapshot" "$snapshot" "$tree" > "$out/source-identity.json"
cp tmp/memory-stage-b/sentropic-cluster-mesh-0.24.0-dev.7.tgz "$out/mesh.tgz"
cp tmp/memory-stage-b/stage-b-result.json "$out/"
cp tmp/memory-stage-b/package-lock.json "$out/stage-b-lock.json"
cp tmp/engram-e2-receipts/stage-b.log "$out/"
cp tmp/engram-e2-receipts/stage-b.status "$out/"
jq -j .canonicalManifest packages/cluster-mesh/assets/storage/engram-memory/contract-manifest.json > "$out/neutral-contract-1.0.0.jcs.json"
cp tools/engram-e11/inputs/{producer.md,reservation.md,review-r3.md,format.md,receiving-validator.mjs} "$out/"
printf '{"head_sha":"%s","tarball_sha256":"%s"}\n' "$snapshot" "$(sha256sum "$out/mesh.tgz" | cut -d' ' -f1)" > "$out/pack-receipt.json"
curl -fsSL https://registry.npmjs.org/@sentropic%2fengram/0.21.3 -o "$out/engram-registry.json"
curl -fsSL https://registry.npmjs.org/@sentropic/engram/-/engram-0.21.3.tgz -o "$out/engram.tgz"
curl -sSL -o "$out/reserved-registry.json" -w "%{http_code}\n" https://registry.npmjs.org/@sentropic%2fcluster-mesh/0.24.0 > "$out/reserved-registry.status"
gh pr view 803 --repo rhanka/sentropic --json body --jq .body > "$out/pr803.md"
gh api "repos/rhanka/sentropic/actions/runs?head_sha=$snapshot&per_page=100" > "$out/ci.json"
gh api 'repos/rhanka/sentropic/actions/runs?head_sha=cfd45de4d54651626e97113494b9d7bd108998c8&event=pull_request&per_page=100' > "$out/e10-ci.json"
cp tools/engram-e11/{candidates,bindings,slots,validate,tuple}.mjs "$out/"
sha256sum "$out/engram.tgz" "$out/mesh.tgz" "$out/neutral-contract-1.0.0.jcs.json"
