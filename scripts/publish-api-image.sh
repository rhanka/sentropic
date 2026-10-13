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

if [ -z "$API_VERSION" ]; then
  API_VERSION="$(make -s version | awk '/^API_VERSION:/ {print $2}')"
fi

if [ -n "$REGISTRY" ]; then
  TARGET_TAG="${REGISTRY}/${API_IMAGE_NAME}:${API_VERSION}"
else
  TARGET_TAG="${API_IMAGE_NAME}:${API_VERSION}"
fi

# Moving tags policy:
# Immutable release tags (content-addressed API_VERSION hashes) enforce strict collision
# guards to guarantee reproducibility and prevent overwriting release artifacts.
# In contrast, moving/alias tags (e.g. 'main', 'latest') are pointers designed to move forward
# with each build or promotion. The dedicated target publish-api-main-image manages 'main'.
case "$API_VERSION" in
  main|latest)
    echo "▶ Moving tag detected ($API_VERSION); updating $TARGET_TAG without collision guard..."
    docker push "$TARGET_TAG"
    echo "✅ Successfully updated moving tag $TARGET_TAG"
    exit 0
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
  # Tag exists in registry! Extract remote digest
  remote_digest=""
  if command -v node >/dev/null 2>&1; then
    remote_digest="$(node -e '
      const fs = require("fs");
      try {
        const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        const d = m.config?.digest || "";
        if (d) process.stdout.write(d);
      } catch (e) {
        process.exit(1);
      }
    ' "$manifest_file" 2>/dev/null || true)"
  fi
  if [ -z "$remote_digest" ] && command -v jq >/dev/null 2>&1; then
    remote_digest="$(jq -r '.config.digest // empty' "$manifest_file" 2>/dev/null || true)"
  fi
  if [ -z "$remote_digest" ] && [ -n "${LLM_MESH_NODE_IMAGE:-}" ]; then
    remote_digest="$(docker run --rm -i "$LLM_MESH_NODE_IMAGE" node -e '
      let s="";
      for await (const c of process.stdin) s+=c;
      const m = JSON.parse(s);
      process.stdout.write(m.config?.digest || "");
    ' < "$manifest_file" 2>/dev/null || true)"
  fi

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
  # Inspect failed: verify if it is a missing manifest vs fatal error
  combined_err="$(cat "$manifest_err" "$manifest_file" 2>/dev/null || true)"
  if printf '%s\n' "$combined_err" | grep -Eiq 'manifest unknown|no such manifest|manifest not found|was not found|not found|does not exist'; then
    echo "▶ Tag $TARGET_TAG is absent from registry. Pushing..."
    docker push "$TARGET_TAG"
    echo "✅ Successfully pushed $TARGET_TAG"
    exit 0
  else
    echo "❌ Error: Cannot establish production registry tag identity for $TARGET_TAG; refusing publication." >&2
    printf '%s\n' "$combined_err" >&2
    exit 1
  fi
fi
