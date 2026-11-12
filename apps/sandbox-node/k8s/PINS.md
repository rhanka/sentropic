# Pinned artifact references (S1 agent-core)

## Pinned now (verified in this branch)

- Base image: `node:24-alpine3.23@sha256:0468540aa58203ff9e40c2aab3907c52644ab818af6176b1c70a026137dc92a2`
  (same pin as `api/Dockerfile` on this branch).
- Contract: `execution-node.v1` (`apps/sandbox-node/src/contract.ts`, unreleased/local).

## Pinned at provision time by the operator (S1-K1)

`runsc` and `crun` are host binaries: neither is installed in this
branch nor in CI, so their SHA-256 digests cannot be pinned here without
fabrication. The operator pins them at provision time and records the
values below:

- `runsc` (gVisor systrap, `--network=none` only):
  version `____`, `sha256sum $(command -v runsc)` = `____`.
- `crun` (OCI runtime for system containers):
  version `____`, `sha256sum $(command -v crun)` = `____`.
- Agent release archive SHA-256 (`out/release.digest`): recorded by the
  build target; k8s pins this exact digest in cloud-init delivery and retains
  the previous digest. No publication is needed for this PR.

## Verify

- `sha256sum -c apps/sandbox-node/k8s/out/SHA256SUMS` (source tarball).
- Verify the archive against `out/SHA256SUMS` before extraction; install
  under `/opt/sandbox-node/releases/<release.digest>`. Startup verifies
  the extracted file manifest. Image tags are build handles only.
