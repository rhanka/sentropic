#!/usr/bin/env bash
set -euo pipefail
hasher="$(pwd)/scripts/ci/ui-image-version.sh"
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
git -C "$scratch" init -q
mkdir -p "$scratch/ui/nginx" "$scratch/ui/chrome-ext" "$scratch/ui/vscode-ext" \
  "$scratch/ui/static" "$scratch/packages/example/src" "$scratch/api" "$scratch/scripts/ci"
for file in package.json package-lock.json api/package.json Makefile .dockerignore \
  ui/nginx/default.conf ui/chrome-ext/content.ts ui/vscode-ext/extension.ts \
  ui/static/index.html packages/example/src/index.ts; do
  printf 'original\n' > "$scratch/$file"
done
cp "$hasher" "$scratch/scripts/ci/ui-image-version.sh"
printf 'ui/static/cowork-desktop/\npackages/*/dist/\n' > "$scratch/.gitignore"
git -C "$scratch" add package.json package-lock.json api/package.json Makefile .dockerignore \
  ui packages scripts/ci/ui-image-version.sh .gitignore
version() {
  (cd "$scratch"; bash "$hasher" "${1:-linux/amd64}" "${2:-prod}" \
    "${3:-https://example.test/api/v1}" "${4:-https://example.test}" "${5:-}" "${6:-node:24-bookworm-slim}")
}
baseline=$(version)
[[ "$baseline" =~ ^[a-f0-9]{6}$ ]]
test "$baseline" = "$(version)"
for file in ui/nginx/default.conf ui/chrome-ext/content.ts ui/vscode-ext/extension.ts \
  ui/static/index.html package-lock.json api/package.json packages/example/src/index.ts .dockerignore; do
  printf 'changed\n' >> "$scratch/$file"
  test "$baseline" != "$(version)"
  printf 'original\n' > "$scratch/$file"
  test "$baseline" = "$(version)"
done
test "$baseline" != "$(version linux/arm64)"
test "$baseline" != "$(version linux/amd64 uat)"
test "$baseline" != "$(version linux/amd64 prod https://other.test/api/v1)"
test "$baseline" != "$(version linux/amd64 prod https://example.test/api/v1 https://other.test)"
test "$baseline" != "$(version linux/amd64 prod https://example.test/api/v1 https://example.test wss://example.test)"
test "$baseline" != "$(version linux/amd64 prod https://example.test/api/v1 https://example.test '' node:other)"
mv "$scratch/ui/static/index.html" "$scratch/ui/static/renamed.html"
test "$baseline" != "$(version)"
mv "$scratch/ui/static/renamed.html" "$scratch/ui/static/index.html"
mkdir -p "$scratch/ui/static/cowork-desktop" "$scratch/packages/example/dist"
printf 'generated binary\n' > "$scratch/ui/static/cowork-desktop/cowork.exe"
printf 'generated build\n' > "$scratch/packages/example/dist/index.js"
test "$baseline" = "$(version)"
echo 'PASS: shipped UI inputs, dependency locks, paths and production profiles invalidate the tag; generated outputs do not'
