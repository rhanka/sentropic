# Pinned artifact references (S1 agent-core)

## Pinned now (verified in this branch)

- Base image: `node:24-alpine3.23@sha256:0468540aa58203ff9e40c2aab3907c52644ab818af6176b1c70a026137dc92a2`
  (same pin as `api/Dockerfile` on this branch).
- Contract: `execution-node.v1` (`packages/contracts/src/execution-node-v1.ts`).

## Pinned at provision time by the operator (S1-K1)

`runsc` and `crun` are host binaries: neither is installed in this
branch nor in CI, so their SHA-256 digests cannot be pinned here without
fabrication. The operator pins them at provision time and records the
values below:

- `runsc` (gVisor systrap, `--network=none` only):
  version `____`, `sha256sum $(command -v runsc)` = `____`.
- `crun` (OCI runtime for system containers):
  version `____`, `sha256sum $(command -v crun)` = `____`.
- Published daemon image digest (`build-artifact.sh` output): `____`.

## Verify

- `sha256sum -c apps/sandbox-node/k8s/out/SHA256SUMS` (source tarball).
- `docker inspect --format '{{.RepoDigests}}' <image>` matches the digest above.
