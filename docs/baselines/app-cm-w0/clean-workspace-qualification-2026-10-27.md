# W0-close.d clean workspace qualification

Opus r2 P1: CI run `40585854429`, head `a8f908080a5775a139030e8286de7310be3512dc`, failed API typecheck because the workspace artifacts exports pointed to absent `dist` files. `prepare-node-workspace` now requires `build-artifacts`, after `build-mcp-platform`; scope exception BR00D-EX4 covers this Makefile change.

## Clean-source proof

- Worktree: `tmp/worktrees/app-w0d-clean-proof`, detached at the reviewed head with only the Makefile fix and branch checklist applied. `harness check branch` passed. Before running, `packages/artifacts/dist`, root `node_modules` and `api/node_modules` were absent. Ports 8798/5184/1091 were free.
- Fixed Makefile SHA-256: `9aa434ba5330e0de38465182ada1098bd4e0fef85702cdd824f8aa50cbc2ca03`.
- Command: `flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make typecheck-api lint-api up-api-test REGISTRY=local API_VERSION=pr796-w0d TARGET=development API_PORT=8798 UI_PORT=5184 MAILDEV_UI_PORT=1091 ENV=test-app-w0d`.
- Exit 0: API typecheck passed; lint reported 0 errors and 220 warnings; API startup completed. No manual `build-artifacts` invocation was used.
- At `2026-10-27T21:50:17.232Z`, GET `http://127.0.0.1:8798/api/v1/health` returned HTTP 200, `status=ok`, database `ok`, readiness `ready`, reasons `[]`. `make ps` reported the API healthy; logs recorded the listener at `21:50:11.444` with no runtime error.
- The step ended with locked `make down ENV=test-app-w0d`; only this dedicated environment was used.
- Final gates: `make scope-check` passed C2; `w0-record-check` passed historical positive/negative vectors, refreshed tuple/source/lock/profile/payload checks and record links. No qualification assertion was relaxed.

## Repeated preparation

An earlier clean worktree, `tmp/worktrees/app-w0d-clean`, automatically built artifacts before the sandbox blocked Docker Buildx metadata writes. After locked teardown, the same canonical `make typecheck-api lint-api` invocation was repeated with Buildx access and exited 0. Its artifacts output was unchanged by repeated preparation and matched the independent clean-source proof: SHA-256 `de262617f2f0c6eb49960b7b9bf9d4682f4fa03840d1fc2d5effac84799f5f2e` over sorted per-file SHA-256 output for `packages/artifacts/dist`. No manual package build was used in either worktree.

Local logs (SHA-256):

- `/tmp/pr796-clean-typecheck.log`: `41006f3690827c5940545d6fd36be91d91a00d83472d5ae16cbc18403b2439dd`.
- `/tmp/pr796-clean-proof.log`: `84a8abfb01cdc0c02286f998531f39c27ac7c9636e844108923117ee0c8e466f`.
- `/tmp/pr796-clean-state.log`: `8f453981b806b0476c52f7b5d11370374502f8b3ba13d9ae2264c6b2839d1fb5`.

The frozen tuple keeps cluster-mesh 0.22.4 by design. cluster-mesh 0.23.0 became npm latest on 2026-10-27; adopting it is outside this correction. Exact-head remote CI evidence is recorded in PR #796.
