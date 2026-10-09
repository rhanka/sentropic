# syntax=docker/dockerfile:1.4
FROM node:24-alpine3.23 AS base
# Security: Pin npm to a known-good version (reproducible build) to fix glob vulnerabilities in npm dependencies
RUN npm install -g npm@11.16.0
# Security: Patch npm's bundled brace-expansion for CVE-2026-102276 / CVE-2026-102278
RUN mkdir -p /tmp/brace-expansion-update && \
    cd /tmp/brace-expansion-update && \
    npm pack brace-expansion@5.0.12 && \
    cd /usr/local/lib/node_modules/npm/node_modules && \
    rm -rf brace-expansion && \
    tar -xzf /tmp/brace-expansion-update/brace-expansion-5.0.12.tgz && \
    mv package brace-expansion && \
    rm -rf /tmp/brace-expansion-update
# Security: Patch npm's bundled undici for CVE-2026-19534
RUN mkdir -p /tmp/undici-update && \
    cd /tmp/undici-update && \
    npm pack undici@6.28.1 && \
    cd /usr/local/lib/node_modules/npm/node_modules && \
    rm -rf undici && \
    tar -xzf /tmp/undici-update/undici-6.28.1.tgz && \
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
# Security: Force update tar in npm itself to fix CVE-2026-24842
RUN mkdir -p /tmp/tar-update && \
    cd /tmp/tar-update && \
    npm pack tar@latest && \
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
COPY package.json package-lock.json* ./
COPY api/package.json ./api/package.json
COPY ui/package.json ./ui/package.json
COPY packages/auth-hono/package.json ./packages/auth-hono/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/events/package.json ./packages/events/package.json
COPY packages/comments/package.json ./packages/comments/package.json
COPY packages/auth-client/package.json ./packages/auth-client/package.json
COPY packages/chat-core/package.json ./packages/chat-core/package.json
COPY packages/chat-server/package.json ./packages/chat-server/package.json
COPY packages/cluster-mesh/package.json ./packages/cluster-mesh/package.json
COPY packages/llm-mesh/package.json ./packages/llm-mesh/package.json
COPY packages/llm-gateway/package.json ./packages/llm-gateway/package.json
COPY packages/flow/package.json ./packages/flow/package.json
COPY packages/skills/package.json ./packages/skills/package.json
COPY packages/oauth-verify/package.json ./packages/oauth-verify/package.json
COPY packages/mcp-auth/package.json ./packages/mcp-auth/package.json
COPY packages/mcp-platform/package.json ./packages/mcp-platform/package.json
COPY packages/connector-host/package.json ./packages/connector-host/package.json
COPY packages/mcp-connector-google/package.json ./packages/mcp-connector-google/package.json
COPY packages/ubo-contracts/package.json ./packages/ubo-contracts/package.json
RUN if [ -f package-lock.json ]; then npm ci --workspaces --include-workspace-root; \
    else npm install --workspaces --include-workspace-root; fi
# Security: audit production deps for HIGH/CRITICAL. Exception-aware gate
# (GHSA allowlist + expiry) — see .security/audit-gate.mjs + vulnerability-register.yaml.
COPY .security/audit-gate.mjs .security/audit-allowlist.json ./.security/
RUN node .security/audit-gate.mjs --omit=dev --workspaces --include-workspace-root
COPY . .
RUN npm --workspace @sentropic/llm-mesh run build
RUN npm --workspace @sentropic/oauth-verify run build
RUN npm --workspace @sentropic/mcp-auth run build
RUN npm --workspace @sentropic/auth-hono run build
RUN npm --workspace @sentropic/llm-gateway run build
RUN npm --workspace @sentropic/auth-client run build
RUN npm --workspace @sentropic/contracts run build
RUN npm --workspace @sentropic/events run build
RUN npm --workspace @sentropic/chat-core run build
RUN npm --workspace @sentropic/chat-server run build
RUN npm --workspace @sentropic/cluster-mesh run build
RUN npm --workspace @sentropic/flow run build
RUN npm --workspace @sentropic/comments run build
RUN npm --workspace @sentropic/mcp-platform run build
RUN npm --workspace @sentropic/connector-host run build
RUN npm --workspace @sentropic/mcp-connector-google run build
RUN npm --workspace @sentropic/ubo-contracts run build

FROM base AS development
WORKDIR /workspace/api
CMD ["npm", "run", "dev"]

# Retain legacy esbuild interfaces while rebuilding their embedded Go runtime.
FROM golang:1.26.9-alpine3.23@sha256:52c60db0b6661204bf2ed874743bffc80c17eaf95d6ff51d87e205484358d40f AS ci-esbuild
RUN mkdir -p /patched && \
    GOBIN=/patched go install github.com/evanw/esbuild/cmd/esbuild@v0.19.12 && \
    mv /patched/esbuild /patched/esbuild-0.19.12 && \
    GOBIN=/patched go install github.com/evanw/esbuild/cmd/esbuild@v0.18.20 && \
    mv /patched/esbuild /patched/esbuild-0.18.20

# CI runners retain npm, devDependencies, test sources and built workspaces.
# This target is a toolbox only; the production target is the shipped SUT.
FROM development AS ci-tools
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
RUN apk add --no-cache chromium && \
    npm --prefix /workspace/e2e ci --ignore-scripts

# BR-39 deploy (D4-a) — IdP screens build stage. Self-contained, mirrors
# apps/auth-idp/web/Dockerfile (NOT a root workspace member; pulls @sentropic/auth-ui
# via the relative `file:` dependency). Output: apps/auth-idp/web/build, COPYed into
# the production stage so the SAME api image can serve the IdP login/consent screens.
FROM node:24-alpine3.23 AS idp-web-build
WORKDIR /workspace
COPY packages/auth-ui ./packages/auth-ui
COPY apps/auth-idp/web/package.json apps/auth-idp/web/package-lock.json* ./apps/auth-idp/web/
WORKDIR /workspace/apps/auth-idp/web
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
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
RUN npx esbuild ../apps/auth-idp/index.ts \
    --bundle --platform=node --target=node20 --format=esm \
    --outfile=../apps/auth-idp/dist/index.js \
    --external:pg --external:drizzle-orm --external:pino --external:pino-pretty \
    --external:officeparser --external:exceljs --external:events --external:stream \
    --external:util --external:url --external:net --external:tls --external:crypto \
    --external:fs --external:path --external:buffer --external:gray-matter \
    --external:isolated-vm --external:docx --external:pptxgenjs --external:zod \
    --external:@aws-sdk/* --external:@smithy/* --sourcemap

FROM base AS production
WORKDIR /workspace
ENV NODE_ENV=production
RUN npm prune --omit=dev --workspaces --include-workspace-root
# Exception-aware gate (inherits .security/ from the base stage's COPY . .).
RUN node .security/audit-gate.mjs --omit=dev --workspaces --include-workspace-root
# Runtime entrypoints and boot migrations use Node directly, never npm/npx.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /root/.npm && \
    ! command -v npm && ! command -v npx && test ! -e /root/.npm
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
