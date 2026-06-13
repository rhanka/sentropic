# syntax=docker/dockerfile:1.4
FROM node:24-alpine3.23 AS base
# Security: Pin npm to a known-good version (reproducible build) to fix glob vulnerabilities in npm dependencies
RUN npm install -g npm@11.16.0
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
COPY packages/comments/package.json ./packages/comments/package.json
COPY packages/auth-client/package.json ./packages/auth-client/package.json
COPY packages/chat-server/package.json ./packages/chat-server/package.json
COPY packages/llm-mesh/package.json ./packages/llm-mesh/package.json
COPY packages/flow/package.json ./packages/flow/package.json
COPY packages/skills/package.json ./packages/skills/package.json
COPY packages/oauth-verify/package.json ./packages/oauth-verify/package.json
COPY packages/mcp-auth/package.json ./packages/mcp-auth/package.json
RUN if [ -f package-lock.json ]; then npm ci --workspaces --include-workspace-root; \
    else npm install --workspaces --include-workspace-root; fi
# Security: Audit production dependencies for HIGH/CRITICAL vulnerabilities
RUN npm audit --audit-level=high --omit=dev --workspaces --include-workspace-root
COPY . .
RUN npm --workspace @sentropic/oauth-verify run build
RUN npm --workspace @sentropic/auth-hono run build
RUN npm --workspace @sentropic/auth-client run build
RUN npm --workspace @sentropic/llm-mesh run build
RUN npm --workspace @sentropic/flow run build
RUN npm --workspace @sentropic/contracts run build
RUN npm --workspace @sentropic/comments run build
RUN npm --workspace @sentropic/mcp-auth run build

FROM base AS development
WORKDIR /workspace/api
CMD ["npm", "run", "dev"]

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
RUN npm audit --audit-level=high --omit=dev --workspaces --include-workspace-root
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
