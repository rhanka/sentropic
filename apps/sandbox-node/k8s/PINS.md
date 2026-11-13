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

- `runsc` (gVisor systrap, `--network=none`, or private loopback-only `sandbox` for `network: ports`):
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

## RUN 9 delivery (supersedes prior compiled releases)

- RUN 9d archive SHA-256: `211487dbf3f379af4de95ca2537adc1c49e1d12a89bc801c17e91ae7ede96b43`.
- SEA executable SHA-256: `9fabba81d437c69899f9b3b210660c1730b7504ab009522fde568fdad52bb0f6`.
- Shared EROFS rootfs SHA-256: `a81e9748507249f50b9f35f1ad8c18d1ecf4080b6a4f753ac2d4a0c73bcb8033`.
- Prebuilt qualification EROFS SHA-256: `0af1727c349d8510eea7202b2e88318c0acc7607fb93ef1e5025557b820d82d0`.
- Supersedes RUN 9c archive `fd1485b387325aab91028db93ead5779e0dfb09d741167631af0193d149f47a5`.
- Supersedes RUN 9 archive `f4cac77d73b130d770dd012a2196899b3fe1e51cc041a9c41d568485dc527818`.
- Supersedes RUN 8 archive `9789357855f9a377c77fdb9fd9a451b13a21c83bf8e342dcdc62c2ad8da0b036` and all earlier releases.
- Configuration/unit/operator key/startup/operator guide/restart B-test/isolation qualification and fixture are covered by the archive's ten-entry SHA256SUMS.
- Archive root mode 0755 and extracted SEA execution as uid 65534 are verified.
- Built and verified locally 2026-11-13, SEA self-test passed from extracted release. No publication/deployment.
- Full runsc/EROFS/EDQUOT and live-mount restart qualification: k8s S1-K1 on an isolated host; not claimed here.
