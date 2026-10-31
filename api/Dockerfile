# syntax=docker/dockerfile:1.4
# Derive the reduced manifest and lock set for the image's dependency closure
# BEFORE installing: the derived tree (/out) depends only on the api closure's
# inputs, so a version bump in an unrelated workspace invalidates at most this
# cheap stage — never the install layer below. The pruned lock keeps entries
# verbatim from the committed lock (lockfile-exact, no re-resolution).
FROM node:24-alpine3.23@sha256:0468540aa58203ff9e40c2aab3907c52644ab818af6176b1c70a026137dc92a2 AS deps-manifests
WORKDIR /workspace
COPY package.json package-lock.json* ./
COPY api/package.json ./api/package.json
COPY packages/artifacts/package.json ./packages/artifacts/package.json
COPY packages/auth-client/package.json ./packages/auth-client/package.json
COPY packages/auth-hono/package.json ./packages/auth-hono/package.json
COPY packages/chat-core/package.json ./packages/chat-core/package.json
COPY packages/chat-server/package.json ./packages/chat-server/package.json
COPY packages/cluster-mesh/package.json ./packages/cluster-mesh/package.json
COPY packages/comments/package.json ./packages/comments/package.json
COPY packages/connector-host/package.json ./packages/connector-host/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/events/package.json ./packages/events/package.json
COPY packages/flow/package.json ./packages/flow/package.json
COPY packages/llm-gateway/package.json ./packages/llm-gateway/package.json
COPY packages/llm-mesh/package.json ./packages/llm-mesh/package.json
COPY packages/mcp-auth/package.json ./packages/mcp-auth/package.json
COPY packages/mcp-connector-google/package.json ./packages/mcp-connector-google/package.json
COPY packages/mcp-platform/package.json ./packages/mcp-platform/package.json
COPY packages/oauth-verify/package.json ./packages/oauth-verify/package.json
COPY packages/skills/package.json ./packages/skills/package.json
COPY packages/ubo-contracts/package.json ./packages/ubo-contracts/package.json
RUN <<'PRUNE'
cat > /tmp/prune-lock.mjs <<'EOF'
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ws = '/workspace';
const out = '/out';
const closureSections = ['dependencies', 'optionalDependencies'];
const walkSections = ['dependencies', 'devDependencies', 'optionalDependencies'];
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const rootManifest = readFileSync(join(ws, 'package.json'));
const lock = readJson(join(ws, 'package-lock.json'));
const api = readJson(join(ws, 'api/package.json'));

// Candidate workspaces: exactly the manifests copied into this stage.
const candidates = new Map(); // package name -> { dir, manifest }
for (const dir of readdirSync(join(ws, 'packages'))) {
  const manifest = readJson(join(ws, 'packages', dir, 'package.json'));
  candidates.set(manifest.name, { dir: `packages/${dir}`, manifest });
}

// Runtime dependency closure of the api workspace over the present candidates:
// a workspace ships in this image only when something that ships depends on it
// at runtime. Workspace references in devDependencies and peerDependencies do
// not extend the closure: build-time needs are covered by each workspace's own
// registry devDependencies (kept in the lock walk below), and today's image
// already runs chat-core with its optional chat-ui peer unsatisfied.
const closure = new Map(); // package name -> workspace dir
const queue = [api];
while (queue.length > 0) {
  const manifest = queue.pop();
  for (const section of closureSections) {
    for (const name of Object.keys(manifest[section] || {})) {
      const candidate = candidates.get(name);
      if (candidate && !closure.has(name)) {
        closure.set(name, candidate.dir);
        queue.push(candidate.manifest);
      }
    }
  }
}
// packages/skills source is bundled into the api build via relative imports and
// exercised by the api test suites; isolated-vm and gray-matter resolve only
// through its manifest, so it stays an installed workspace of this image.
// The remaining members are the workspaces this image compiles: each
// `npm --workspace X run build` in the base stage needs X's manifest present
// and X's registry devDependencies installed (e.g. @sentropic/artifacts, which
// nothing requires at runtime — cluster-mesh only peers on it).
const buildWorkspaces = [
  '@sentropic/artifacts', '@sentropic/auth-client', '@sentropic/auth-hono',
  '@sentropic/chat-core', '@sentropic/chat-server', '@sentropic/cluster-mesh',
  '@sentropic/comments', '@sentropic/connector-host', '@sentropic/contracts',
  '@sentropic/events', '@sentropic/flow', '@sentropic/llm-gateway',
  '@sentropic/llm-mesh', '@sentropic/mcp-auth', '@sentropic/mcp-connector-google',
  '@sentropic/mcp-platform', '@sentropic/oauth-verify', '@sentropic/ubo-contracts',
  '@sentropic/skills',
];
for (const name of buildWorkspaces) {
  const candidate = candidates.get(name);
  if (candidate) closure.set(name, candidate.dir);
}
const workspaceDirs = new Set(closure.values());
const rootName = JSON.parse(rootManifest).name;

// Prune the committed lock to the closure's dependency set. Entries are copied
// verbatim: resolved versions stay exactly what the committed lock pinned.
const keep = new Set(['', 'api', ...workspaceDirs]);
const pending = [...keep];
// npm links every installed workspace into the root node_modules; keep those
// link entries so the pruned lock matches the ideal tree of the -w selection.
for (const [name, dir] of [...closure, [api.name, 'api'], [rootName, '']]) {
  const key = `node_modules/${name}`;
  const entry = lock.packages[key];
  if (entry && entry.link && entry.resolved === dir) keep.add(key);
}
const resolve = (from, name, required) => {
  let dir = from;
  for (;;) {
    const key = (dir ? `${dir}/` : '') + `node_modules/${name}`;
    const entry = lock.packages[key];
    if (entry) {
      if (entry.link && entry.resolved) {
        // Workspace link: resolve only shipped workspaces; a build-time or peer
        // reference to a workspace this image does not ship stays unsatisfied,
        // exactly as in the full build (e.g. chat-core's optional chat-ui peer).
        if (workspaceDirs.has(entry.resolved)) {
          if (!keep.has(key)) { keep.add(key); pending.push(key); }
          if (!keep.has(entry.resolved)) { keep.add(entry.resolved); pending.push(entry.resolved); }
          return;
        }
        if (!required) {
          // Keep the lock's link and target entries so npm ci resolves the slot
          // from the committed lock (e.g. chat-core's devDependency on chat-ui):
          // the link ends up dangling — the target manifest is not shipped —
          // which is exactly how the full build satisfies that slot today.
          keep.add(key);
          if (lock.packages[entry.resolved]) keep.add(entry.resolved);
          return;
        }
        break;
      }
      if (!keep.has(key)) { keep.add(key); pending.push(key); }
      return;
    }
    if (dir === '') break;
    dir = dir.lastIndexOf('/') === -1 ? '' : dir.slice(0, dir.lastIndexOf('/'));
  }
  if (required) {
    console.error(`prune-lock: ${name} (required by ${from || '(root)'}) has no lock entry in the shipped closure`);
    process.exit(1);
  }
};
while (pending.length > 0) {
  const from = pending.pop();
  const entry = lock.packages[from];
  for (const section of walkSections) {
    for (const name of Object.keys(entry[section] || {})) {
      resolve(from, name, section !== 'devDependencies');
    }
  }
  for (const name of Object.keys(entry.peerDependencies || {})) {
    resolve(from, name, false);
  }
}

// Rebuild the lock in the original key order for byte-stable output.
const packages = {};
for (const key of Object.keys(lock.packages)) {
  if (keep.has(key)) packages[key] = lock.packages[key];
}
mkdirSync(join(out, 'api'), { recursive: true });
// --legacy-peer-deps (required: with the ui workspace gone, npm would
// re-resolve chat-core's @sentropic/chat-ui peer from the registry and drag
// the whole UI dependency stack back in) also drops peer-only lock entries.
// The shipped workspaces' only such entry is jose (peer of oauth-verify,
// auth-client, auth-hono, mcp-auth); declare it as a regular dependency of
// the derived root so the pinned lock version still installs. Range comes
// from oauth-verify's own peer declaration.
const rootManifestJson = JSON.parse(rootManifest);
const joseRange = JSON.parse(readFileSync(join(ws, 'packages/oauth-verify/package.json'))).peerDependencies?.jose;
if (joseRange) {
  rootManifestJson.dependencies = { ...(rootManifestJson.dependencies || {}), jose: joseRange };
}
writeFileSync(join(out, 'package.json'), `${JSON.stringify(rootManifestJson, null, 2)}\n`);
if (joseRange && packages['']) {
  packages[''].dependencies = { ...(packages[''].dependencies || {}), jose: joseRange };
}
writeFileSync(join(out, 'package-lock.json'), `${JSON.stringify({ ...lock, packages }, null, 2)}\n`);
writeFileSync(join(out, 'api/package.json'), readFileSync(join(ws, 'api/package.json')));
for (const dir of [...workspaceDirs].sort()) {
  mkdirSync(join(out, dir), { recursive: true });
  writeFileSync(join(out, dir, 'package.json'), readFileSync(join(ws, dir, 'package.json')));
}
console.log(`prune-lock: kept ${Object.keys(packages).length} of ${Object.keys(lock.packages).length} lock entries; workspaces: api, ${[...workspaceDirs].sort().join(', ')}`);
EOF
node /tmp/prune-lock.mjs
PRUNE
FROM node:24-alpine3.23@sha256:0468540aa58203ff9e40c2aab3907c52644ab818af6176b1c70a026137dc92a2 AS dependencies
# Security: Pin npm to a known-good version (reproducible build) to fix glob vulnerabilities in npm dependencies
COPY scripts/ci/locked-tools.mjs scripts/ci/tool-locks.json /opt/ci-tools/
RUN node /opt/ci-tools/locked-tools.mjs --prefix /tmp/locked-npm --ignore-scripts npm@11.16.0 && \
    rm -rf /usr/local/lib/node_modules/npm && \
    cp -a /tmp/locked-npm/node_modules/npm /usr/local/lib/node_modules/npm && rm -rf /tmp/locked-npm
# Security: Patch npm's bundled brace-expansion for CVE-2026-102276 / CVE-2026-102278
RUN mkdir -p /tmp/brace-expansion-update && \
    cd /tmp/brace-expansion-update && \
    npm pack brace-expansion@5.0.12 && \
    cd /usr/local/lib/node_modules/npm/node_modules && \
    rm -rf brace-expansion && \
    tar -xzf /tmp/brace-expansion-update/brace-expansion-5.0.12.tgz && \
    mv package brace-expansion && \
    rm -rf /tmp/brace-expansion-update
# Security: Patch npm's bundled undici for CVE-2026-19534 and CVE-2026-109869 (DoS via content-encodings, fixed in 6.29.1)
RUN mkdir -p /tmp/undici-update && \
    cd /tmp/undici-update && \
    npm pack undici@6.29.1 && \
    cd /usr/local/lib/node_modules/npm/node_modules && \
    rm -rf undici && \
    tar -xzf /tmp/undici-update/undici-6.29.1.tgz && \
    mv package undici && \
    rm -rf /tmp/undici-update
# Security: Patch npm's bundled http-cache-semantics for CVE-2026-93748
RUN mkdir -p /tmp/http-cache-semantics-update && \
    cd /tmp/http-cache-semantics-update && \
    npm pack http-cache-semantics@4.3.0 && \
    cd /usr/local/lib/node_modules/npm/node_modules && \
    rm -rf http-cache-semantics && \
    tar -xzf /tmp/http-cache-semantics-update/http-cache-semantics-4.3.0.tgz && \
    mv package http-cache-semantics && \
    rm -rf /tmp/http-cache-semantics-update
# Security: Force update glob in npm itself to fix CVE-2025-64756
# Download glob 11.1.0 first, then replace npm's glob directory
RUN mkdir -p /tmp/glob-update && \
    cd /tmp/glob-update && \
    npm pack glob@11.1.0 && \
    cd /usr/local/lib/node_modules/npm/node_modules && \
    if [ -d glob ]; then \
      rm -rf glob && \
      tar -xzf /tmp/glob-update/glob-11.1.0.tgz && \
      mv package glob; \
    fi && \
    rm -rf /tmp/glob-update
# Security: Force update tar in npm itself to fix CVE-2026-24842 (pinned for reproducible builds)
RUN mkdir -p /tmp/tar-update && \
    cd /tmp/tar-update && \
    npm pack tar@7.5.22 && \
    cd /usr/local/lib/node_modules/npm/node_modules && \
    if [ -d tar ]; then \
      rm -rf tar && \
      tar -xzf /tmp/tar-update/tar-*.tgz && \
      mv package tar; \
    fi && \
    rm -rf /tmp/tar-update
# Security: Force update minimatch in npm itself to fix CVE-2026-27903 / CVE-2026-27904
RUN mkdir -p /tmp/minimatch-update && \
    cd /tmp/minimatch-update && \
    npm pack minimatch@10.2.4 && \
    cd /usr/local/lib/node_modules/npm/node_modules && \
    if [ -d minimatch ]; then \
      rm -rf minimatch && \
      tar -xzf /tmp/minimatch-update/minimatch-10.2.4.tgz && \
      mv package minimatch; \
    fi && \
    rm -rf /tmp/minimatch-update
# Security: Force update picomatch inside npm's tinyglobby to fix CVE-2026-33671
RUN mkdir -p /tmp/picomatch-update && \
    cd /tmp/picomatch-update && \
    npm pack picomatch@4.0.4 && \
    cd /usr/local/lib/node_modules/npm/node_modules && \
    if [ -d tinyglobby/node_modules/picomatch ]; then \
      rm -rf tinyglobby/node_modules/picomatch && \
      tar -xzf /tmp/picomatch-update/picomatch-4.0.4.tgz && \
      mv package tinyglobby/node_modules/picomatch; \
    fi && \
    rm -rf /tmp/picomatch-update
WORKDIR /workspace
# Install only the api dependency closure (20 workspaces), lockfile-exact from
# the pruned lock derived above: no ui, no chat-ui, no unrelated workspace deps.
# --legacy-peer-deps keeps the install lockfile-exact: with the ui workspace
# gone, nothing satisfies chat-core's optional @sentropic/chat-ui peer and npm
# would re-resolve it from the registry (EUSAGE) instead of trusting the
# committed lock; every non-optional peer of the installed set still resolves
# from the lock. The cache mount keeps the npm download cache out of the layer
# stack so re-installs after unrelated workspace bumps hit the warm cache.
COPY --from=deps-manifests /out/package.json /out/package-lock.json ./
COPY --from=deps-manifests /out/api/package.json ./api/package.json
COPY --from=deps-manifests /out/packages ./packages
RUN --mount=type=cache,target=/root/.npm \
    npm ci --legacy-peer-deps --include-workspace-root \
      -w api \
      -w @sentropic/artifacts \
      -w @sentropic/auth-client \
      -w @sentropic/auth-hono \
      -w @sentropic/chat-core \
      -w @sentropic/chat-server \
      -w @sentropic/cluster-mesh \
      -w @sentropic/comments \
      -w @sentropic/connector-host \
      -w @sentropic/contracts \
      -w @sentropic/events \
      -w @sentropic/flow \
      -w @sentropic/llm-gateway \
      -w @sentropic/llm-mesh \
      -w @sentropic/mcp-auth \
      -w @sentropic/mcp-connector-google \
      -w @sentropic/mcp-platform \
      -w @sentropic/oauth-verify \
      -w @sentropic/skills \
      -w @sentropic/ubo-contracts
# Security: audit production deps for HIGH/CRITICAL. Exception-aware gate
# (GHSA allowlist + expiry) — see .security/audit-gate.mjs + vulnerability-register.yaml.
COPY .security/audit-gate.mjs .security/audit-allowlist.json ./.security/
RUN node .security/audit-gate.mjs --omit=dev --workspaces --include-workspace-root

FROM dependencies AS base
# Explicit production inputs only (fix/api-image-canonical-artifact): no blind
# `COPY . .`, so unhashed sources (ui/**, e2e suites, non-consumed packages)
# can never perturb the canonical tag. Every source below is hashed into
# API_VERSION; the regression suite fails on any COPY/hash divergence.
COPY api ./api
COPY packages/artifacts ./packages/artifacts
COPY packages/auth-client ./packages/auth-client
COPY packages/auth-hono ./packages/auth-hono
COPY packages/chat-core ./packages/chat-core
COPY packages/chat-server ./packages/chat-server
COPY packages/cluster-mesh ./packages/cluster-mesh
COPY packages/comments ./packages/comments
COPY packages/connector-host ./packages/connector-host
COPY packages/contracts ./packages/contracts
COPY packages/events ./packages/events
COPY packages/flow ./packages/flow
COPY packages/llm-gateway ./packages/llm-gateway
COPY packages/llm-mesh ./packages/llm-mesh
COPY packages/mcp-auth ./packages/mcp-auth
COPY packages/mcp-connector-google ./packages/mcp-connector-google
COPY packages/mcp-platform ./packages/mcp-platform
COPY packages/oauth-verify ./packages/oauth-verify
COPY packages/skills ./packages/skills
COPY packages/ubo-contracts ./packages/ubo-contracts
COPY apps/auth-idp ./apps/auth-idp
COPY apps/llm-gateway ./apps/llm-gateway
COPY e2e/package.json e2e/package-lock.json ./e2e/
COPY e2e/tests/fixtures ./e2e/tests/fixtures
RUN npm --workspace @sentropic/llm-mesh run build
RUN npm --workspace @sentropic/oauth-verify run build
RUN npm --workspace @sentropic/mcp-auth run build
RUN npm --workspace @sentropic/auth-hono run build
RUN npm --workspace @sentropic/llm-gateway run build
RUN npm --workspace @sentropic/auth-client run build
RUN npm --workspace @sentropic/contracts run build
RUN npm --workspace @sentropic/events run build
# Compile runtime declarations against published neutral UI contracts.
RUN set -eu; \
    peer_dir="$(mktemp -d)"; \
    trap 'rm -rf "$peer_dir" packages/chat-core/node_modules/@sentropic/chat-ui' EXIT; \
    node /opt/ci-tools/locked-tools.mjs --prefix "$peer_dir" --ignore-scripts --no-audit --no-fund @sentropic/chat-ui@0.34.1 svelte@5.55.7; \
    mkdir -p packages/chat-core/node_modules/@sentropic; \
    rm -rf packages/chat-core/node_modules/@sentropic/chat-ui; \
    ln -s "$peer_dir/node_modules/@sentropic/chat-ui" packages/chat-core/node_modules/@sentropic/chat-ui; \
    npm --workspace @sentropic/chat-core run build
RUN npm --workspace @sentropic/chat-server run build
RUN npm --workspace @sentropic/mcp-platform run build
RUN npm --workspace @sentropic/artifacts run build
RUN npm --workspace @sentropic/comments run build
RUN npm --workspace @sentropic/cluster-mesh run build
RUN npm --workspace @sentropic/flow run build
RUN npm --workspace @sentropic/connector-host run build
RUN npm --workspace @sentropic/mcp-connector-google run build
RUN npm --workspace @sentropic/ubo-contracts run build

FROM base AS development
WORKDIR /workspace/api
CMD ["npm", "run", "dev"]

# Retain legacy esbuild interfaces while rebuilding their embedded Go runtime.
FROM golang:1.26.10-alpine3.23@sha256:a07f231c19b03e6106cf442f02a5bcf262147e744d15b7b5e4b6d81d420c70a0 AS ci-esbuild
RUN mkdir -p /patched && \
    GOBIN=/patched go install github.com/evanw/esbuild/cmd/esbuild@v0.19.12 && \
    mv /patched/esbuild /patched/esbuild-0.19.12 && \
    GOBIN=/patched go install github.com/evanw/esbuild/cmd/esbuild@v0.18.20 && \
    mv /patched/esbuild /patched/esbuild-0.18.20

# CI runners retain npm, devDependencies, test sources and built workspaces.
# This target is a toolbox only; the production target is the shipped SUT.
# Keep npm/esbuild preparation independent of source-dependent workspace builds.
FROM dependencies AS ci-tool-base
COPY --from=ci-esbuild /patched /patched
RUN test "$(node -p "require('/workspace/node_modules/esbuild/package.json').version")" = 0.19.12 && \
    test "$(node -p "require('/workspace/node_modules/@esbuild-kit/core-utils/node_modules/esbuild/package.json').version")" = 0.18.20 && \
    architecture="$(node -p 'process.arch')" && \
    cp /patched/esbuild-0.19.12 /workspace/node_modules/@esbuild/linux-${architecture}/bin/esbuild && \
    cp /patched/esbuild-0.19.12 /workspace/node_modules/esbuild/bin/esbuild && \
    cp /patched/esbuild-0.18.20 /workspace/node_modules/@esbuild-kit/core-utils/node_modules/@esbuild/linux-${architecture}/bin/esbuild && \
    cp /patched/esbuild-0.18.20 /workspace/node_modules/@esbuild-kit/core-utils/node_modules/esbuild/bin/esbuild && \
    /workspace/node_modules/esbuild/bin/esbuild --version | grep -qx '0.19.12' && \
    /workspace/node_modules/@esbuild-kit/core-utils/node_modules/esbuild/bin/esbuild --version | grep -qx '0.18.20' && \
    rm -rf /patched
# Update vulnerable bundled npm packages without changing npm's major version.
RUN mkdir -p /tmp/tool-npm-patches && \
    for dependency in ip-address@10.3.1 pacote@21.5.1; do \
      package="${dependency%@*}"; version="${dependency##*@}"; \
      npm pack "$dependency" --pack-destination /tmp/tool-npm-patches && \
      rm -rf "/usr/local/lib/node_modules/npm/node_modules/$package" && \
      mkdir -p "/usr/local/lib/node_modules/npm/node_modules/$package" && \
      tar -xzf "/tmp/tool-npm-patches/$package-$version.tgz" --strip-components=1 \
        -C "/usr/local/lib/node_modules/npm/node_modules/$package" || exit 1; \
    done && rm -rf /tmp/tool-npm-patches /root/.npm

# Non-browser API checks need no Chromium or duplicate Playwright installation.
# The screen smoke uses the separately qualified E2E image's browser instead.
FROM node:24-alpine3.23@sha256:0468540aa58203ff9e40c2aab3907c52644ab818af6176b1c70a026137dc92a2 AS ci-tools
WORKDIR /workspace
# Copy the prepared filesystem, not the install/cache history of its layers.
RUN rm -rf /usr/local/lib/node_modules/npm
COPY --from=ci-tool-base /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
COPY --from=ci-tool-base /workspace/node_modules /workspace/node_modules
COPY --from=ci-tool-base /workspace/package.json /workspace/package-lock.json /workspace/
COPY --from=ci-tool-base /workspace/.security /workspace/.security
COPY --from=base /workspace/api /workspace/api
COPY --from=base /workspace/packages /workspace/packages
COPY --from=base /workspace/apps /workspace/apps
COPY --from=base /workspace/e2e /workspace/e2e
WORKDIR /workspace/api
CMD ["npm", "run", "dev"]

# BR-39 deploy (D4-a) — IdP screens build stage. Self-contained, mirrors
# apps/auth-idp/web/Dockerfile (NOT a root workspace member; pulls @sentropic/auth-ui
# via the relative `file:` dependency). Output: apps/auth-idp/web/build, COPYed into
# the production stage so the SAME api image can serve the IdP login/consent screens.
FROM node:24-alpine3.23@sha256:0468540aa58203ff9e40c2aab3907c52644ab818af6176b1c70a026137dc92a2 AS idp-web-build
WORKDIR /workspace
COPY packages/auth-ui ./packages/auth-ui
COPY apps/auth-idp/web/package.json apps/auth-idp/web/package-lock.json* ./apps/auth-idp/web/
WORKDIR /workspace/apps/auth-idp/web
RUN npm ci
# Security: audit production dependencies for HIGH/CRITICAL vulnerabilities.
RUN npm audit --audit-level=high --omit=dev
COPY apps/auth-idp/web ./
RUN npm run build
# Build assertion: the SPA fallback must exist or the IdP degrades to a JSON stub
# (no login page) at runtime. Fail the image build instead of failing silently.
RUN test -f build/404.html || (echo "IdP screens build missing SPA fallback 404.html" && exit 1)

FROM base AS build
WORKDIR /workspace/api
RUN npm run build
# BR-39 deploy (D4-a) — also compile the standalone IdP entrypoint so the SAME
# api image can run the IdP via a k8s `command:` override. esbuild bundles
# apps/auth-idp/index.ts (which only imports ../../api/src + hono + node stdlib)
# with the SAME externals as the api build, so runtime deps resolve from the
# pruned production node_modules; hono is inlined (it is a devDependency removed
# by `npm prune --omit=dev`). The api default CMD is unchanged.
RUN npx --no-install esbuild ../apps/auth-idp/index.ts \
    --bundle --platform=node --target=node20 --format=esm \
    --outfile=../apps/auth-idp/dist/index.js \
    --external:pg --external:drizzle-orm --external:pino --external:pino-pretty \
    --external:officeparser --external:exceljs --external:events --external:stream \
    --external:util --external:url --external:net --external:tls --external:crypto \
    --external:fs --external:path --external:buffer --external:gray-matter \
    --external:isolated-vm --external:docx --external:pptxgenjs --external:zod \
    --external:@aws-sdk/* --external:@smithy/* --sourcemap

FROM base AS production-dependencies
WORKDIR /workspace
ENV NODE_ENV=production
RUN npm prune --omit=dev --workspaces --include-workspace-root
# Exception-aware gate (inherits .security/ from the base stage's COPY . .).
RUN node .security/audit-gate.mjs --omit=dev --workspaces --include-workspace-root

# A fresh runtime omits deleted devDependencies and npm download-cache layers.
FROM node:24-alpine3.23@sha256:0468540aa58203ff9e40c2aab3907c52644ab818af6176b1c70a026137dc92a2 AS production
WORKDIR /workspace
ENV NODE_ENV=production
COPY --from=production-dependencies /workspace /workspace
# Runtime entrypoints and boot migrations use Node directly, never npm/npx.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /root/.npm && \
    ! command -v npm && ! command -v npx && test ! -e /root/.npm
# Retained input (canonical contract): /workspace/ui/package.json ships in the
# production image because it is hashed into API_VERSION; the runtime never
# imports the ui workspace, whose dependencies are no longer installed here.
COPY ui/package.json ./ui/package.json
COPY --from=build /workspace/api/dist /workspace/api/dist
# BR-39 deploy (D4-a) — bundle the standalone IdP entrypoint + its login/consent
# screens into the SAME image. The api runtime is untouched (default CMD below);
# the IdP is selected by a k8s `command: ["node","apps/auth-idp/dist/index.js"]`
# override run from /workspace (so IDP_WEB_BUILD_DIR=apps/auth-idp/web/build
# resolves relative to that cwd). One image, two Deployments, one publish pipeline.
COPY --from=build /workspace/apps/auth-idp/dist /workspace/apps/auth-idp/dist
COPY --from=idp-web-build /workspace/apps/auth-idp/web/build /workspace/apps/auth-idp/web/build
WORKDIR /workspace/api
CMD ["node", "dist/index.js"]
