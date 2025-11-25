# syntax=docker/dockerfile:1.4
FROM node:24-alpine AS base
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
WORKDIR /app
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* ./
RUN if [ -f package-lock.json ]; then npm ci; \
    elif [ -f pnpm-lock.yaml ]; then npm install -g pnpm && pnpm install --frozen-lockfile; \
    elif [ -f yarn.lock ]; then yarn install --frozen-lockfile; \
    else npm install; fi
# Security: Audit dependencies for HIGH/CRITICAL vulnerabilities
RUN npm audit --audit-level=high
COPY . .

FROM base AS development
CMD ["npm", "run", "dev"]

FROM base AS build
RUN npm run build

FROM node:24-alpine AS production
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
WORKDIR /app
ENV NODE_ENV=production
COPY --from=base /app/package.json ./
COPY --from=base /app/package-lock.json* ./
RUN npm install --omit=dev
# Security: Audit production dependencies for HIGH/CRITICAL vulnerabilities
RUN npm audit --audit-level=high --production
COPY --from=build /app/dist ./dist
COPY --from=base /app/drizzle ./drizzle
CMD ["node", "dist/index.js"]
