#!/usr/bin/env bash
set -euo pipefail
# Canonical production artifact resolution (fix/api-image-canonical-artifact).
#
# The build stage must choose and retain the canonical production artifact
# BEFORE any SUT lane runs:
# - canonical tag exists in the registry -> pull it, record its exact image
#   ID, and test/transport THAT artifact (no rebuild, no collision possible)
# - canonical tag established missing (registry manifest-unknown on stderr)
#   -> build once (no-cache production target) and record the new artifact
# - any other lookup outcome (auth/transport/unknown) -> fail closed:
#   never build, never record, never push. For an intentional local rebuild
#   use `make build-api-image-fresh`.
cd "$(dirname "$0")/.."

REGISTRY="${REGISTRY:-}"
API_IMAGE_NAME="${API_IMAGE_NAME:-sentropic-api}"
API_VERSION="${API_VERSION:-}"
API_IMAGE_RECEIPT="${API_IMAGE_RECEIPT:-.tmp/ci-prod-image/api-image-id}"
MANIFEST_DIR="${MANIFEST_DIR:-.tmp/ci-prod-image}"
DOCKER_COMPOSE="${DOCKER_COMPOSE:-docker compose}"

if [ -z "$API_VERSION" ]; then
  API_VERSION="$(make -s version | awk '/^API_VERSION:/ {print $2}')"
fi

TARGET_TAG="${REGISTRY}/${API_IMAGE_NAME}:${API_VERSION}"

record_artifact() {
  mkdir -p "$(dirname "$API_IMAGE_RECEIPT")"
  docker image inspect "$TARGET_TAG" --format '{{.Id}}' > "$API_IMAGE_RECEIPT"
  echo "✅ Canonical artifact $(cat "$API_IMAGE_RECEIPT") ($TARGET_TAG)"
}

# No registry configured: historical local behavior, always build.
if [ -z "$REGISTRY" ]; then
  echo "▶ No REGISTRY configured; building local production image $TARGET_TAG..."
  # shellcheck disable=SC2086
  API_IMAGE_REF= TARGET=production $DOCKER_COMPOSE build --no-cache api
  record_artifact
  exit 0
fi

mkdir -p "$MANIFEST_DIR"
manifest_file="$MANIFEST_DIR/existing-manifest.json"
manifest_err="$MANIFEST_DIR/manifest-error"
rm -f "$manifest_file" "$manifest_err"

echo "▶ Inspecting registry manifest for $TARGET_TAG..."
if docker manifest inspect "$TARGET_TAG" > "$manifest_file" 2> "$manifest_err"; then
  echo "▶ Canonical tag exists; reusing the registry artifact (no rebuild)..."
  docker pull "$TARGET_TAG"
  record_artifact
  exit 0
fi

if [ -s "$manifest_err" ] && grep -Eq 'manifest unknown|no such manifest|manifest not found' "$manifest_err"; then
  echo "▶ Canonical tag absent from registry; building new production artifact..."
  # shellcheck disable=SC2086
  API_IMAGE_REF= TARGET=production $DOCKER_COMPOSE build --no-cache api
  record_artifact
  exit 0
fi

echo "❌ Error: Cannot establish canonical tag identity for $TARGET_TAG; refusing to build." >&2
if [ -s "$manifest_err" ]; then cat "$manifest_err" >&2; fi
echo "Fix registry authentication/connectivity, or run \`make build-api-image-fresh\` for an intentional local rebuild." >&2
exit 1
