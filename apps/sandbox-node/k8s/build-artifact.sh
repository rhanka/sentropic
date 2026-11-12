#!/bin/sh
# Build the pinned sandbox-node artifact and record its digests.
# Usage (from the worktree root): sh apps/sandbox-node/k8s/build-artifact.sh
# Outputs (NOT committed): apps/sandbox-node/k8s/out/ with the source
# tarball, its SHA-256, and the built image digest. No deployment.
set -eu
HERE=$(dirname "$0")
OUT="$HERE/out"
mkdir -p "$OUT"
# Reproducible source tarball: sorted entries, fixed mtime, numeric owners.
tar --sort-name --mtime='2026-01-01' --owner=0 --group=0 --numeric-owner \
  -cf "$OUT/sandbox-node-daemon-src.tar" \
  -C "$HERE/.." src ../../packages/contracts/src/execution-node-v1.ts
sha256sum "$OUT/sandbox-node-daemon-src.tar" | tee "$OUT/SHA256SUMS"
IMAGE_TAG="${IMAGE_TAG:-ghcr.io/rhanka/sandbox-node-daemon:feat-sandbox-node-step1}"
docker buildx build --file "$HERE/Dockerfile" --tag "$IMAGE_TAG" .
docker inspect --format='{{range .RepoDigests}}{{println .}}{{end}}' "$IMAGE_TAG" \
  | tee "$OUT/image.digest"
