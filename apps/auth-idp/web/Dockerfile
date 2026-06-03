# syntax=docker/dockerfile:1.4
# BR-39m A0-bis — build the minimal IdP screens static front.
#
# Self-contained build (NOT a root workspace member; same isolation pattern as
# e2e/). It pulls @sentropic/auth-ui via a relative `file:` dependency, so the
# package source is copied in before `npm ci`. Output: the static SvelteKit
# bundle at /workspace/apps/auth-idp/web/build, copied out by `make build-idp-web`.
FROM node:24-alpine AS build
WORKDIR /workspace

# The `file:../../../packages/auth-ui` dependency must resolve at install time.
COPY packages/auth-ui ./packages/auth-ui
COPY apps/auth-idp/web/package.json apps/auth-idp/web/package-lock.json* ./apps/auth-idp/web/
WORKDIR /workspace/apps/auth-idp/web
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
# Security: audit production dependencies for HIGH/CRITICAL vulnerabilities.
RUN npm audit --audit-level=high --omit=dev

COPY apps/auth-idp/web ./
RUN npm run build

# A tiny final stage exposes only the built bundle for extraction.
FROM scratch AS dist
COPY --from=build /workspace/apps/auth-idp/web/build /build
