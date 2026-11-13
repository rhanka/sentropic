# Pinned artifact references (S1 agent-core)

## Pinned now (verified in this branch)

- SEA/shared-rootfs build image (Linux x86_64/glibc): `node:24-bookworm-slim@sha256:0e2646ab57e77b7a384a0cb59b6815b182c77e1f9c3ba36bd8435bd9c4e6680e`.
- Standalone test image: `node:24-alpine3.23@sha256:0468540aa58203ff9e40c2aab3907c52644ab818af6176b1c70a026137dc92a2`.
- Contract: `execution-node.v1` (`apps/sandbox-node/src/contract.ts`, unreleased/local).

## Pinned at provision time by the operator (S1-K1)

`runsc` and `crun` are host binaries: neither is installed in this
branch nor in CI, so their SHA-256 digests cannot be pinned here without
fabrication. The operator pins them at provision time and records the
values below:

- `runsc` (gVisor systrap, `--network=none` only):
  k8s-installed release-20261102.0, `/opt/gvisor/20261102/runsc`; binary SHA-256 remains a k8s install receipt.
- `crun` 1.30.1 is a host benchmark witness only, never an advertised agent runtime.
- Agent release archive SHA-256 (`out/release.digest`): recorded by the
  build target; k8s pins this exact digest in cloud-init delivery and retains
  the previous digest. No publication is needed for this PR.
- RUN 2 compiled agent release: `sha256:7ae14562ae32724524909f04aa39c066847e09a706bbabc35ece08f3726a0508`.
  Built locally on 2026-11-12; not published or deployed. k8s verifies the
  archive and its file manifest before selecting this digest.
- RUN 3 compiled agent release (local build, not published/deployed):
  `sha256:de41d3f42f1502fc91fae79c14b1871bb60f88e9cd73a8e3efb05e5fe7d317f5`.

## Verify

- RUN 4 compiled agent release (local build, not published/deployed):
  `sha256:6438720be250517de1613b570c8df42c5e6f318fb03bfdf74b5a839af87e6969`.

- `sha256sum -c apps/sandbox-node/k8s/out/SHA256SUMS` (source tarball).
- Verify the archive against `out/SHA256SUMS` before extraction; install
  under `/opt/execution-node/releases/<release.digest>`. Startup verifies
  the extracted file manifest. Image tags are build handles only.

## RUN 7 delivery (supersedes prior compiled releases)

- Archive SHA-256: `cb694fc8ccb09e58578ab3a84748c05f17e0a32aa843b150a66d5600d1c03f74`.
- SEA executable SHA-256: `23eb42829f0059b8d7e3afa39f4fb7f0558fb4c91c1e7df8d16a05effb42f99f`.
- Shared EROFS rootfs SHA-256: `61f14f817c4af58ff9df190c09ae44a6a0eeb1cbfc1419111202d7700f2c9bcf`.
- Supersedes RUN 6 archive `d86295e5f58a1fa45871b819af62fcc85243ce04867a42cb3dae10b2ad7bc0a0` and RUN 5 archive `2206040078562ddf4c32d0d9d34825fc1dee3abba7cc76ef45ce8b6bee3eed6e`.
- Configuration/unit/operator key/startup/README/restart B-test are covered by the archive's SHA256SUMS.
- Built and verified locally 2026-11-13, SEA self-test passed from extracted release. No publication/deployment.
- Full runsc/EROFS/EDQUOT and live-mount restart qualification: k8s S1-K1 on an isolated host; not claimed here.
