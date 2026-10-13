#!/usr/bin/env bash
set -euo pipefail

# Ensure working directory is repo root
cd "$(dirname "$0")/.."

REGISTRY="${REGISTRY:-}"
API_IMAGE_NAME="${API_IMAGE_NAME:-sentropic-api}"
API_VERSION="${API_VERSION:-}"
API_IMAGE_RECEIPT="${API_IMAGE_RECEIPT:-.tmp/ci-prod-image/api-image-id}"
API_IMAGE_REF="${API_IMAGE_REF:-}"
MANIFEST_DIR="${MANIFEST_DIR:-.tmp/ci-prod-image}"
LLM_MESH_NODE_IMAGE="${LLM_MESH_NODE_IMAGE:-node:24-bookworm-slim}"

if [ -z "$API_VERSION" ]; then
  API_VERSION="$(make -s version | awk '/^API_VERSION:/ {print $2}')"
fi

if [ -z "$REGISTRY" ]; then
  echo "❌ Error: REGISTRY is not set. Publication requires an explicit registry." >&2
  exit 1
fi

TARGET_TAG="${REGISTRY}/${API_IMAGE_NAME}:${API_VERSION}"

# Moving tags policy:
# publish-api-image is dedicated strictly to immutable, content-addressed release tags.
# Moving tags and aliases (such as 'main' or 'latest') must NOT be published through
# this script; they must be promoted via publish-api-main-image.
case "$API_VERSION" in
  main|latest)
    echo "❌ Error: Cannot use publish-api-image for moving tag '$API_VERSION'. Moving tag aliases must be promoted via publish-api-main-image." >&2
    exit 1
    ;;
esac

# Resolve local immutable artifact identity (config digest)
if [ -z "$API_IMAGE_REF" ]; then
  if [ -s "$API_IMAGE_RECEIPT" ]; then
    API_IMAGE_REF="$(cat "$API_IMAGE_RECEIPT")"
  else
    API_IMAGE_REF="$(docker image inspect "$TARGET_TAG" --format '{{.Id}}' 2>/dev/null || true)"
  fi
fi

if [ -z "$API_IMAGE_REF" ]; then
  echo "❌ Error: Cannot establish local artifact identity for $TARGET_TAG" >&2
  exit 1
fi

mkdir -p "$MANIFEST_DIR"
manifest_file="$MANIFEST_DIR/existing-manifest.json"
manifest_err="$MANIFEST_DIR/manifest-error"
rm -f "$manifest_file" "$manifest_err"

echo "▶ Inspecting registry manifest for $TARGET_TAG..."
if docker manifest inspect "$TARGET_TAG" > "$manifest_file" 2> "$manifest_err"; then
  # Tag exists in registry! Extract remote digest via Docker container (Docker-First)
  remote_digest="$(docker run --rm -i "$LLM_MESH_NODE_IMAGE" node -e '
    let s="";
    for await (const c of process.stdin) s+=c;
    const m = JSON.parse(s);
    process.stdout.write(m.config?.digest || "");
  ' < "$manifest_file" 2>/dev/null || true)"

  if [ -z "$remote_digest" ]; then
    echo "❌ Error: Tag $TARGET_TAG exists in registry but could not extract config digest from manifest." >&2
    exit 1
  fi

  if [ "$remote_digest" != "$API_IMAGE_REF" ]; then
    echo "❌ Production tag collision: tag $TARGET_TAG already exists in registry with different digest ($remote_digest != $API_IMAGE_REF). Immutable release tags must never be overwritten." >&2
    exit 1
  fi

  echo "✅ Tag $TARGET_TAG already exists in registry with matching digest ($API_IMAGE_REF). Skipping push idempotently."
  exit 0
else
  # Inspect failed: verify if it is an exact missing manifest signal vs fatal error.
  # Classify as absent ONLY on registry-specific manifest-unknown signal on stderr.
  if [ -s "$manifest_err" ] && grep -Eq 'manifest unknown|no such manifest|manifest not found' "$manifest_err"; then
    echo "▶ Tag $TARGET_TAG is absent from registry. Pushing..."
    docker push "$TARGET_TAG"
    echo "✅ Successfully pushed $TARGET_TAG"
    exit 0
  else
    echo "❌ Error: Cannot establish production registry tag identity for $TARGET_TAG; refusing publication." >&2
    if [ -s "$manifest_err" ]; then
      cat "$manifest_err" >&2
    fi
    exit 1
  fi
fi
