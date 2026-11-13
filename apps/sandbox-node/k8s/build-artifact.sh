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
docker cp "$container:/srv/sandbox-node/execution-node" "$release/execution-node"
docker cp "$container:/srv/sandbox-node/rootfs.erofs" "$release/rootfs.erofs"
docker cp "$container:/srv/sandbox-node/qualification.erofs" "$release/qualification.erofs"
cp "$HERE/execution-node.service" "$HERE/start.sh" "$HERE/agent.env" "$HERE/operator-ticket.ed25519.pub.pem" "$release/"
cp "$HERE/qualify-restart-mounts.sh" "$HERE/qualify-isolation.sh" "$HERE/../OPERATOR.md" "$release/"
chmod 0755 "$release" "$release/execution-node" "$release/start.sh" "$release/qualify-isolation.sh"
(cd "$release"; find . -type f ! -name SHA256SUMS -print | LC_ALL=C sort | xargs sha256sum > SHA256SUMS)
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
