#!/bin/sh
# Prepare B3 packed-qualification fixtures in container scratch space.
# Invoked by packaging.mk inside the Node image (npm only); never on the host.
# REFRESH_LOCK=1 regenerates the frozen `selected` lockfile instead of `npm ci`.
# CLUSTER_MESH_SIBLING_RECEIPTS=<receipts.json> (release train): same-PR sibling archives verified by
# sha256 and packed identity replace the registry for exactly the name@version they carry; every other
# package (and every version without a receipt) comes from the registry. Each fixture records its
# sources in sources.txt.
set -eu
work="$1"
here="$(pwd)/tests/packaging"
fixtures="$here/fixtures"
rm -rf "$work"
mkdir -p "$work/tools" "$work/src"
quiet="--no-audit --no-fund --loglevel=error"
siblings="$work/siblings"
if [ -n "${CLUSTER_MESH_SIBLING_RECEIPTS:-}" ]; then
  node "$here/siblings.mjs" verify "$CLUSTER_MESH_SIBLING_RECEIPTS" "$siblings"
fi

# Train tuple of this release; the old tuple is only used by the refusal fixture.
MESH=0.22.0
GATEWAY=0.19.0

# Candidate tarball, packed exactly as published (files/exports/sideEffects).
npm pack --silent --pack-destination "$work" >/dev/null
tgz="$(ls "$work"/sentropic-cluster-mesh-*.tgz)"

# Qualification tools, isolated from every fixture tree.
npm install --prefix "$work/tools" $quiet vitest@4.1.5 typescript@5.9.3 @types/node@22 esbuild@0.25.12 >/dev/null

# src NAME VERSION: a verified sibling archive (`file:`) for exactly NAME@VERSION, else the registry version.
src() {
  node "$here/siblings.mjs" spec "$siblings" "$1" "$2"
}

# consumer DIR NAME=SPEC...: write DIR/package.json; every `file:` sibling spec is repeated as an override
# (npm requires the identical spec for a direct dependency), so nested edges resolve to the same archive.
consumer() {
  dir="$1"
  shift
  mkdir -p "$dir"
  node -e 'const fs = require("fs"); const [dir, ...pairs] = process.argv.slice(1);
    const path = dir + "/package.json";
    const pkg = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : { private: true, type: "module" };
    pkg.name = pkg.name ?? "fixture-" + dir.split("/").pop();
    pkg.dependencies = { ...pkg.dependencies };
    for (const pair of pairs) { const at = pair.indexOf("="); pkg.dependencies[pair.slice(0, at)] = pair.slice(at + 1); }
    const overrides = Object.fromEntries(Object.entries(pkg.dependencies)
      .filter(([name, spec]) => name !== "@sentropic/cluster-mesh" && spec.startsWith("file:/")));
    if (Object.keys(overrides).length) pkg.overrides = overrides; else delete pkg.overrides;
    fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");' "$dir" "$@"
}

# sources DIR: record where each train package of DIR/package.json comes from.
sources() {
  node -e 'const fs = require("fs"); const dir = process.argv[1];
    const pkg = JSON.parse(fs.readFileSync(dir + "/package.json", "utf8"));
    const lines = Object.entries(pkg.dependencies ?? {}).filter(([name]) => /^@sentropic\/llm-(mesh|gateway)$/u.test(name))
      .map(([name, spec]) => name + " " + (spec.startsWith("file:") ? "sibling " + spec.slice(5) : "registry " + spec));
    fs.writeFileSync(dir + "/sources.txt", lines.join("\n") + "\n");' "$1"
}

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
  [ ! -f "$work/$1/sources.txt" ] || cat "$work/$1/sources.txt"
}

# Stage a committed fixture package (substituting the candidate and train specs) and pack it.
stage() {
  dst="$work/src/$1"
  mkdir -p "$dst"
  cp -R "$fixtures/$1/." "$dst/"
  if [ -f "$dst/package.json.in" ]; then
    sed -e "s#__CANDIDATE__#$tgz#g" -e "s#__LLM_MESH__#$(src @sentropic/llm-mesh "$MESH")#g" \
      -e "s#__LLM_GATEWAY__#$(src @sentropic/llm-gateway "$GATEWAY")#g" "$dst/package.json.in" > "$dst/package.json"
    rm "$dst/package.json.in"
    consumer "$dst"
    sources "$dst"
  fi
  (cd "$dst" && npm pack --silent --pack-destination "$work/src" >/dev/null)
}

# Bare consumer: the candidate only; optional peers stay absent.
fixture bare
(cd "$work/bare" && npm install $quiet "$tgz" >/dev/null)

# Selected consumer: E8's public service-mode tuple, frozen by the committed lockfile. With siblings the
# install is provisional (same pins, sibling archives + overrides, `npm install`); the committed lock then
# carries the registry URL and the sibling bytes' sha512, asserted on every sibling run.
mkdir -p "$work/selected"
cp "$fixtures/selected/package.json" "$work/selected/"
cp "$fixtures/selected/package-lock.json" "$work/selected/committed-lock.json"
consumer "$work/selected" "@sentropic/llm-mesh=$(src @sentropic/llm-mesh "$MESH")" \
  "@sentropic/llm-gateway=$(src @sentropic/llm-gateway "$GATEWAY")"
sources "$work/selected"
if grep -q ' sibling ' "$work/selected/sources.txt"; then
  [ "${REFRESH_LOCK:-}" = 1 ] || cp "$fixtures/selected/package-lock.json" "$work/selected/"
  (cd "$work/selected" && npm install $quiet >/dev/null)
elif [ "${REFRESH_LOCK:-}" = 1 ]; then
  (cd "$work/selected" && npm install $quiet >/dev/null)
else
  cp "$fixtures/selected/package-lock.json" "$work/selected/"
  (cd "$work/selected" && npm ci $quiet >/dev/null)
fi
if [ "${REFRESH_LOCK:-}" = 1 ]; then
  # The candidate's integrity changes with every build; the public tuple stays pinned.
  node "$here/check-lock-integrity.mjs" refresh "$work/selected/package-lock.json" "$fixtures/selected/package-lock.json" \
    "$fixtures/selected/package.json" "$siblings"
  cp "$fixtures/selected/package-lock.json" "$work/selected/committed-lock.json"
elif [ -f "$siblings/index.json" ]; then
  node "$here/check-lock-integrity.mjs" siblings "$work/selected/committed-lock.json" "$siblings"
fi
tuple selected

# Session mode: the public auth-hono tarball at llm-gateway 0.19.0's declared peer range.
consumer "$work/selected-session" "@sentropic/cluster-mesh=file:$tgz" "@sentropic/llm-mesh=$(src @sentropic/llm-mesh "$MESH")" \
  "@sentropic/llm-gateway=$(src @sentropic/llm-gateway "$GATEWAY")" "@sentropic/auth-hono=0.15.0" "hono=4.10.7"
sources "$work/selected-session"
(cd "$work/selected-session" && npm install $quiet >/dev/null)
tuple selected-session

# Latest within every declared peer range (both auth modes), resolved by npm at run time; a train package
# with a sibling archive is the candidate of its range.
fixture latest
node -e 'const fs = require("fs"); const cm = JSON.parse(fs.readFileSync(process.argv[1] + "/package.json", "utf8"));
  const dir = process.argv[2]; const pkg = JSON.parse(fs.readFileSync(dir + "/package.json", "utf8"));
  pkg.dependencies = { "@sentropic/cluster-mesh": "file:" + process.argv[3], ...cm.peerDependencies, hono: cm.dependencies.hono };
  fs.writeFileSync(dir + "/package.json", JSON.stringify(pkg, null, 2));' "$(pwd)" "$work/latest" "$tgz"
latest_mesh="$(src @sentropic/llm-mesh "$MESH")"
latest_gateway="$(src @sentropic/llm-gateway "$GATEWAY")"
case "$latest_mesh$latest_gateway" in
  *file:*) consumer "$work/latest" \
    $(case "$latest_mesh" in file:*) echo "@sentropic/llm-mesh=$latest_mesh" ;; esac) \
    $(case "$latest_gateway" in file:*) echo "@sentropic/llm-gateway=$latest_gateway" ;; esac) ;;
esac
sources "$work/latest"
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

# Old tuple (llm-mesh 0.21.2, llm-gateway 0.18.0), registry only: npm must refuse the out-of-range optional
# peers. npm 11 either fails with ERESOLVE or exits 0 after dropping the conflicting root requests
# ("ERESOLVE overriding peer dependency"); both leave the old tuple uninstalled and count as refused.
# --force then builds the skewed tree only to prove the runtime refusal.
fixture old-tuple
old_tuple="@sentropic/llm-mesh@0.21.2 @sentropic/llm-gateway@0.18.0"
old_installed() {
  for name in @sentropic/llm-mesh @sentropic/llm-gateway; do
    printf '%s@%s ' "$name" "$(node -p "require('$work/old-tuple/node_modules/$name/package.json').version" 2>/dev/null || echo absent)"
  done
}
if (cd "$work/old-tuple" && npm install $quiet "$tgz" $old_tuple >/dev/null 2>&1); then plain=0; else plain=$?; fi
after="$(old_installed)"
if [ "$plain" = 0 ] && [ "$after" = "@sentropic/llm-mesh@0.21.2 @sentropic/llm-gateway@0.18.0 " ]; then
  echo accepted > "$work/old-tuple/npm-install-outcome"
else
  echo refused > "$work/old-tuple/npm-install-outcome"
  # npm 11 --force applies the same peer override (drops the old tuple); --legacy-peer-deps then skips peer
  # resolution entirely, which is the only way left to build the skewed tree.
  skew=force
  (cd "$work/old-tuple" && npm install $quiet --force "$tgz" $old_tuple >/dev/null 2>&1) || true
  if [ "$(old_installed)" != "@sentropic/llm-mesh@0.21.2 @sentropic/llm-gateway@0.18.0 " ]; then
    skew=legacy-peer-deps
    (cd "$work/old-tuple" && npm install $quiet --legacy-peer-deps "$tgz" $old_tuple >/dev/null 2>&1)
  fi
fi
printf 'plain-exit=%s\nplain-installed=%s\nskew-build=%s\n' "$plain" "$after" "${skew:-none}" > "$work/old-tuple/npm-install-detail"
echo "[old-tuple] outcome $(cat "$work/old-tuple/npm-install-outcome"): plain exit $plain, installed $after, skew build ${skew:-none}"
tuple old-tuple
