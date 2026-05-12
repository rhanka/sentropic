# syntax=docker/dockerfile:1.4
FROM node:24-alpine3.23 AS base
# Security: Update npm to latest version to fix glob vulnerabilities in npm dependencies
RUN npm install -g npm@latest
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
COPY packages/llm-mesh/package.json ./packages/llm-mesh/package.json
RUN if [ -f package-lock.json ]; then npm ci --workspaces --include-workspace-root; \
    else npm install --workspaces --include-workspace-root; fi
# Security: Audit production dependencies for HIGH/CRITICAL vulnerabilities
RUN npm audit --audit-level=high --omit=dev --workspaces --include-workspace-root
COPY . .
RUN npm --workspace @sentropic/llm-mesh run build

FROM base AS development
WORKDIR /workspace/api
CMD ["npm", "run", "dev"]

FROM base AS build
WORKDIR /workspace/api
RUN npm run build

FROM base AS production
WORKDIR /workspace
ENV NODE_ENV=production
RUN npm prune --omit=dev --workspaces --include-workspace-root
RUN npm audit --audit-level=high --omit=dev --workspaces --include-workspace-root
COPY --from=build /workspace/api/dist /workspace/api/dist
WORKDIR /workspace/api
CMD ["node", "dist/index.js"]
