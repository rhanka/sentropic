# syntax=docker/dockerfile:1.4
# Pinned glibc runtime: SEA executes on Ubuntu without a host Node installation.
ARG BASE_IMAGE=node:24-bookworm-slim@sha256:0e2646ab57e77b7a384a0cb59b6815b182c77e1f9c3ba36bd8435bd9c4e6680e

FROM ${BASE_IMAGE} AS rootfs
RUN mkdir -p /workspace /tmp /proc /dev

FROM ${BASE_IMAGE} AS build
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY scripts/ci/locked-tools.mjs scripts/ci/tool-locks.json scripts/ci/
# Lockfile-exact dependency closure (no re-resolution).
RUN node scripts/ci/locked-tools.mjs --prefix /workspace --ignore-scripts --no-audit --no-fund typescript@5.4.5 @types/node
COPY apps/sandbox-node/src apps/sandbox-node/src
COPY apps/sandbox-node/tsconfig.json apps/sandbox-node/tsconfig.build.json apps/sandbox-node/
# Emit compiled daemon (tsconfig is noEmit by default for checks).
RUN npx --no-install tsc --project apps/sandbox-node/tsconfig.build.json
COPY apps/sandbox-node/k8s/build-tools /tools
RUN npm ci --prefix /tools --no-audit --no-fund
RUN /tools/node_modules/.bin/esbuild apps/sandbox-node/src/entry.ts --bundle --platform=node --format=cjs --target=node24 --outfile=agent.cjs \
 && printf '{"main":"agent.cjs","output":"sea.blob","disableExperimentalSEAWarning":true,"useCodeCache":false}' > sea.json \
 && node --experimental-sea-config sea.json \
 && cp /usr/local/bin/node execution-node \
 && /tools/node_modules/.bin/postject execution-node NODE_SEA_BLOB sea.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
 && ./execution-node --self-test
RUN apt-get update && apt-get install -y --no-install-recommends erofs-utils && rm -rf /var/lib/apt/lists/*
COPY --from=rootfs / /sandbox-rootfs/
RUN mkfs.erofs -q -T 1767225600 --all-root rootfs.erofs /sandbox-rootfs

FROM scratch AS runtime
WORKDIR /srv/sandbox-node
COPY --from=build /workspace/execution-node /workspace/rootfs.erofs ./
ENTRYPOINT ["/srv/sandbox-node/execution-node"]
