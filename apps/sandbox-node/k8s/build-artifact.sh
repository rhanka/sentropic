#!/bin/sh
# Build the pinned sandbox-node artifact and record its digests.
# Called only through build-sandbox-node-artifact in checks.mk.
# Outputs (NOT committed): digest-addressed Node release, no deployment.
set -eu
HERE=$(dirname "$0")
OUT="$HERE/out"
mkdir -p "$OUT"
IMAGE_TAG="${IMAGE_TAG:-ghcr.io/rhanka/sandbox-node-daemon:feat-sandbox-node-step1}"
docker buildx build --load --file "$HERE/Dockerfile" --tag "$IMAGE_TAG" .
container=$(docker create "$IMAGE_TAG")
trap 'docker rm "$container" >/dev/null' EXIT
release=$(mktemp -d "$OUT/release.XXXXXX")
docker cp "$container:/srv/sandbox-node/dist" "$release/dist"
docker cp "$container:/srv/sandbox-node/package.json" "$release/package.json"
(cd "$release"; find dist package.json -type f -print | LC_ALL=C sort | xargs sha256sum > SHA256SUMS)
tar --sort=name --mtime='2026-01-01' --owner=0 --group=0 --numeric-owner \
  -cf "$OUT/sandbox-node.tar" -C "$release" .
digest=$(sha256sum "$OUT/sandbox-node.tar" | cut -d' ' -f1)
printf '%s\n' "$digest" > "$OUT/release.digest"
mv "$OUT/sandbox-node.tar" "$OUT/$digest.tar"
if test -d "$OUT/$digest"; then
  cmp "$release/SHA256SUMS" "$OUT/$digest/SHA256SUMS"
  rm -r "$release"
else
  mv "$release" "$OUT/$digest"
fi
sha256sum "$OUT/$digest.tar" | tee "$OUT/SHA256SUMS"
