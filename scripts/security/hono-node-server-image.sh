#!/usr/bin/env bash
set -euo pipefail
: "${HONO_RUNTIME_IMAGE:?recorded runtime image is required}"
: "${HONO_NPM_IMAGE:?npm inspection tool image is required}"
scratch=$(mktemp -d)
tool=$(docker create "$HONO_NPM_IMAGE")
trap 'docker rm "$tool" >/dev/null; rm -rf "$scratch"' EXIT
# npm is mounted only for inspection; the shipped image remains free of npm.
docker cp "$tool:/usr/local/lib/node_modules/npm" "$scratch/npm"
docker run --rm --network none \
  -v "$scratch/npm:/npm:ro" -v "$PWD/scripts/security:/checks:ro" \
  --entrypoint sh "$HONO_RUNTIME_IMAGE" -ec '
    for role in /workspace /workspace/api /workspace/apps/artifact-content; do
      cd "$role"
      node /npm/bin/npm-cli.js ls @hono/node-server --all
    done
    node /checks/hono-node-server-tree.mjs
    cd /workspace
    node --test /checks/hono-node-server.test.mjs
  '
