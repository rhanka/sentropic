#!/bin/sh
# Prepare B3 packed-qualification fixtures in container scratch space.
# Invoked by packaging.mk inside the Node image; never on the host.
set -eu
work="$1"
rm -rf "$work"
mkdir -p "$work/tools"
quiet="--no-audit --no-fund --loglevel=error"

# Candidate tarball, packed exactly as published (files/exports/sideEffects).
npm pack --silent --pack-destination "$work" >/dev/null
tgz="$(ls "$work"/sentropic-cluster-mesh-*.tgz)"

# Qualification tools, isolated from every fixture tree.
npm install --prefix "$work/tools" $quiet vitest@4.1.5 typescript@5.9.3 @types/node@22 esbuild@0.25.12 >/dev/null

fixture() {
  dir="$work/$1"
  mkdir -p "$dir"
  printf '{ "name": "fixture-%s", "private": true, "type": "module" }\n' "$1" > "$dir/package.json"
}

# Bare consumer: the candidate only; optional peers stay absent.
fixture bare
(cd "$work/bare" && npm install $quiet "$tgz" >/dev/null)

# Selected consumer: E8's public tuple for service mode (no auth-hono).
fixture selected
(cd "$work/selected" && npm install $quiet "$tgz" @sentropic/llm-mesh@0.21.2 @sentropic/llm-gateway@0.18.0 \
  @sentropic/mcp-auth@0.2.1 jose@5.10.0 hono@4.10.7 >/dev/null)

# Gateway 0.17.x: npm must refuse the out-of-range optional peer; --force builds the skewed tree
# only to prove the runtime refusal.
fixture gateway-017
if (cd "$work/gateway-017" && npm install $quiet "$tgz" @sentropic/llm-mesh@0.21.2 @sentropic/llm-gateway@0.17.1 >/dev/null 2>&1); then
  echo accepted > "$work/gateway-017/npm-install-outcome"
else
  echo refused > "$work/gateway-017/npm-install-outcome"
  (cd "$work/gateway-017" && npm install $quiet --force "$tgz" @sentropic/llm-mesh@0.21.2 @sentropic/llm-gateway@0.17.1 >/dev/null 2>&1)
fi

# Record the exact installed tuple for the release matrix.
for name in @sentropic/cluster-mesh @sentropic/llm-mesh @sentropic/llm-gateway @sentropic/mcp-auth \
  @sentropic/oauth-verify jose hono; do
  version="$(node -p "require('$work/selected/node_modules/$name/package.json').version" 2>/dev/null || echo absent)"
  echo "$name@$version"
done > "$work/selected/tuple.txt"
cat "$work/selected/tuple.txt"
