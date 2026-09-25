#!/bin/sh
# Prepare B3 packed-qualification fixtures in container scratch space.
# Invoked by packaging.mk inside the Node image (npm only); never on the host.
# REFRESH_LOCK=1 regenerates the frozen `selected` lockfile instead of `npm ci`.
set -eu
work="$1"
fixtures="$(pwd)/tests/packaging/fixtures"
rm -rf "$work"
mkdir -p "$work/tools" "$work/src"
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

tuple() {
  for name in @sentropic/cluster-mesh @sentropic/llm-mesh @sentropic/llm-gateway @sentropic/mcp-auth \
    @sentropic/oauth-verify @sentropic/auth-hono jose hono; do
    version="$(node -p "require('$work/$1/node_modules/$name/package.json').version" 2>/dev/null || echo absent)"
    echo "$name@$version"
  done > "$work/$1/tuple.txt"
  echo "[$1]"; cat "$work/$1/tuple.txt"
}

# Stage a committed fixture package (substituting the candidate path) and pack it.
stage() {
  dst="$work/src/$1"
  mkdir -p "$dst"
  cp -R "$fixtures/$1/." "$dst/"
  if [ -f "$dst/package.json.in" ]; then
    sed "s#__CANDIDATE__#$tgz#g" "$dst/package.json.in" > "$dst/package.json"
    rm "$dst/package.json.in"
  fi
  (cd "$dst" && npm pack --silent --pack-destination "$work/src" >/dev/null)
}

# Bare consumer: the candidate only; optional peers stay absent.
fixture bare
(cd "$work/bare" && npm install $quiet "$tgz" >/dev/null)

# Selected consumer: E8's public service-mode tuple, frozen by the committed lockfile.
mkdir -p "$work/selected"
cp "$fixtures/selected/package.json" "$work/selected/"
if [ "${REFRESH_LOCK:-}" = 1 ]; then
  (cd "$work/selected" && npm install $quiet >/dev/null)
  # The candidate's integrity changes with every build; the public tuple stays pinned.
  node -e 'const fs = require("fs"); const lock = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    delete lock.packages["node_modules/@sentropic/cluster-mesh"].integrity;
    fs.writeFileSync(process.argv[2], JSON.stringify(lock, null, 2) + "\n");' \
    "$work/selected/package-lock.json" "$fixtures/selected/package-lock.json"
else
  cp "$fixtures/selected/package-lock.json" "$work/selected/"
  (cd "$work/selected" && npm ci $quiet >/dev/null)
fi
tuple selected

# Session mode: the public auth-hono tarball at llm-gateway 0.18.0's published peer range.
fixture selected-session
(cd "$work/selected-session" && npm install $quiet "$tgz" @sentropic/llm-mesh@0.21.2 @sentropic/llm-gateway@0.18.0 \
  @sentropic/auth-hono@0.15.0 hono@4.10.7 >/dev/null)
tuple selected-session

# Latest within every declared peer range (both auth modes), resolved by npm at run time.
fixture latest
node -e 'const fs = require("fs"); const cm = JSON.parse(fs.readFileSync(process.argv[1] + "/package.json", "utf8"));
  const dir = process.argv[2]; const pkg = JSON.parse(fs.readFileSync(dir + "/package.json", "utf8"));
  pkg.dependencies = { "@sentropic/cluster-mesh": "file:" + process.argv[3], ...cm.peerDependencies, hono: cm.dependencies.hono };
  fs.writeFileSync(dir + "/package.json", JSON.stringify(pkg, null, 2));' "$(pwd)" "$work/latest" "$tgz"
(cd "$work/latest" && npm install $quiet >/dev/null)
tuple latest

# Real global topology: runtime installed separately in the global prefix, then the consumer.
stage separate-runtime
stage global-consumer
stage global-consumer-pinned
npm install -g --prefix "$work/global" $quiet "$work/src/fixture-separate-runtime-1.0.0.tgz" >/dev/null
npm install -g --prefix "$work/global" $quiet "$work/src/fixture-global-consumer-1.0.0.tgz" >/dev/null
npm install -g --prefix "$work/global-pinned" $quiet "$work/src/fixture-separate-runtime-1.0.0.tgz" >/dev/null
npm install -g --prefix "$work/global-pinned" $quiet "$work/src/fixture-global-consumer-pinned-1.0.0.tgz" >/dev/null

# Gateway 0.17.x: npm must refuse the out-of-range optional peer; --force builds the skewed tree
# only to prove the runtime refusal.
fixture gateway-017
if (cd "$work/gateway-017" && npm install $quiet "$tgz" @sentropic/llm-mesh@0.21.2 @sentropic/llm-gateway@0.17.1 >/dev/null 2>&1); then
  echo accepted > "$work/gateway-017/npm-install-outcome"
else
  echo refused > "$work/gateway-017/npm-install-outcome"
  (cd "$work/gateway-017" && npm install $quiet --force "$tgz" @sentropic/llm-mesh@0.21.2 @sentropic/llm-gateway@0.17.1 >/dev/null 2>&1)
fi
