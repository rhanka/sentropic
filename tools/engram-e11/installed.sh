#!/usr/bin/env bash
# Caller holds the shared Docker lock. Only the test-mem-e11 project is used.
set -euo pipefail
out="$1"
read -ra compose <<< "$2"
head=32dd911be19f0874459a1b4e697d7175bb6b433f
tree=9dcd865487004e28649f3d68c842f328cc4d1952
trap 'rc=$?; trap - EXIT; set +e; make down ENV=test-mem-e11 >> "$out/campaign.log" 2>&1; cleanup=$?;
  printf "exit=%s\ncleanup=%s\n" "$rc" "$cleanup" > "$out/campaign.status"; test "$rc" -eq 0 && test "$cleanup" -eq 0' EXIT
exec > >(tee "$out/campaign.log") 2>&1
printf 'head=%s\ntree=%s\n' "$head" "$tree"
make engram-e2-postgres-up API_PORT=9055 UI_PORT=5255 MAILDEV_UI_PORT=1155 ENV=test-mem-e11
pg_image="$("${compose[@]}" ps -q postgres | xargs -r docker inspect --format '{{.Image}}')"
test -n "$pg_image"
mesh_list="$(tar -tzf "$out/mesh.tgz" | LC_ALL=C sort | sha256sum | cut -d' ' -f1)"
"${compose[@]}" run --rm --no-deps -u "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$out:/evidence" -w /evidence/consumer \
  -e CM_PG_URL=postgresql://app:app@postgres:5432/app \
  -e INSTALLED_CONSUMER_ROOT=/evidence/consumer -e INSTALLED_RECEIPT=/evidence/receipt.json \
  -e INSTALLED_ENGRAM_TGZ=/evidence/engram.tgz -e INSTALLED_MESH_TGZ=/evidence/mesh.tgz \
  -e INSTALLED_P3_MANIFEST=/evidence/artifacts/pre-candidate-manifest.json \
  -e INSTALLED_HEAD="$head" -e INSTALLED_TREE="$tree" -e INSTALLED_PG_IMAGE="$pg_image" \
  -e INSTALLED_QUAL_IMAGE=sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 \
  -e INSTALLED_MESH_FILELIST_SHA256="$mesh_list" \
  qualification sh -ec 'sha256sum package-lock.json > /evidence/lock-before.sha256;
    rm -rf node_modules; npm ci --ignore-scripts --no-audit --no-fund;
    sha256sum -c /evidence/lock-before.sha256;
    ./node_modules/.bin/tsc --noEmit --strict --target es2022 --module nodenext --moduleResolution nodenext \
      --listFiles installed-memory-types.ts > /evidence/type-files.txt || { cat /evidence/type-files.txt; exit 1; };
    npm --version > /evidence/npm-version.txt;
    node installed-memory.mjs write; node installed-memory.mjs reopen'
cp "$out/consumer/package.json" "$out/consumer-package.json"
cp "$out/consumer/package-lock.json" "$out/consumer-lock.json"
