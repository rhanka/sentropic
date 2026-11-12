# syntax=docker/dockerfile:1.4
# Sandbox-node daemon image (S1 agent-core finalisation, no deployment).
# Reproducible definition only: the k8s session (S1-K1) builds, publishes
# by digest, and records the digest in PINS.md via build-artifact.sh.
ARG BASE_IMAGE=node:24-alpine3.23@sha256:0468540aa58203ff9e40c2aab3907c52644ab818af6176b1c70a026137dc92a2

FROM ${BASE_IMAGE} AS build
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/sandbox-node apps/sandbox-node
COPY packages/contracts packages/contracts
# Lockfile-exact dependency closure (no re-resolution).
RUN npm ci --ignore-scripts --no-audit --no-fund
# Emit compiled daemon (tsconfig is noEmit by default for checks).
RUN npx --no-install tsc --project apps/sandbox-node/tsconfig.json \
  --noEmit false --outDir apps/sandbox-node/dist

FROM ${BASE_IMAGE} AS runtime
WORKDIR /srv/sandbox-node
# Zero runtime dependencies: the daemon uses node builtins only.
COPY --from=build /workspace/apps/sandbox-node/dist ./dist
COPY --from=build /workspace/packages/contracts/src/execution-node-v1.ts ./contract/
USER 1000:1000
ENTRYPOINT ["node", "dist/index.js"]
