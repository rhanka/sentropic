# syntax=docker/dockerfile:1.4
# Sandbox-node daemon image (S1 agent-core finalisation, no deployment).
# Reproducible definition only: the k8s session (S1-K1) builds, publishes
# by digest, and records the digest in PINS.md via build-artifact.sh.
ARG BASE_IMAGE=node:24-alpine3.23@sha256:0468540aa58203ff9e40c2aab3907c52644ab818af6176b1c70a026137dc92a2

FROM ${BASE_IMAGE} AS build
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY scripts/ci/locked-tools.mjs scripts/ci/tool-locks.json scripts/ci/
# Lockfile-exact dependency closure (no re-resolution).
RUN node scripts/ci/locked-tools.mjs --prefix /workspace --ignore-scripts --no-audit --no-fund typescript@5.4.5 @types/node
COPY apps/sandbox-node apps/sandbox-node
# Emit compiled daemon (tsconfig is noEmit by default for checks).
RUN npx --no-install tsc --project apps/sandbox-node/tsconfig.build.json

FROM ${BASE_IMAGE} AS runtime
WORKDIR /srv/sandbox-node
# Zero runtime dependencies: the daemon uses node builtins only.
COPY --from=build /workspace/apps/sandbox-node/dist ./dist
RUN printf '{"type":"module"}\n' > package.json
USER 1000:1000
ENTRYPOINT ["node", "dist/service.js"]
