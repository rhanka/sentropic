# Feature: SG2 GitPort GitHub App

## Objective
- [ ] Deliver the G0 FROZEN v3 GitPort with enrolled cluster-mesh leases and fake-forge acceptance for the 0.2.18 train.

## Scope / Guardrails
- [x] Branch `feat/git-artifact-sg2`; worktree `tmp/worktrees/sg2`; initial base `origin/main`, rebase onto `train/artifacts-0.2.18` when available.
- [x] Binding contract SHA-256 `4c405c8f49e9d242d65eebe35a14a45e4826afc0007e9f94a7fe21d7404e21ba`; live owner decisions supersede CI execution.
- [x] Docker via docker-slot.sh; make only; no Python, secrets in outputs or attribution trailers.
- [x] Ports `API_PORT=9590 UI_PORT=5790 MAILDEV_UI_PORT=1690 ENV=test-sg2`; ENV always last.
- [x] No versions, lockfiles, profile pins, existing fixtures or L5 regeneration; integration owns the release.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json` (required by `scripts/ci/ci-lockfile-installs.test.mjs`, enforced by `validate-publishable-manifests`).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/src/server/git-port*.ts`
  - `packages/artifacts/src/adapters/github-*.ts`
  - `packages/artifacts/src/index.ts`
  - `packages/artifacts/src/server/failures.ts`
  - `packages/artifacts/tests/git-port*.ts`
  - `packages/artifacts/tests/fixtures/git-port*.ts`
  - `packages/artifacts/docs/git-port.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `**/package*.json`
  - `.track/**`
  - `tools/memory-mcp-l5/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`

## Feedback Loop
- [ ] SG2-INPUT: converged-r2 source path in G0 is absent locally; requested its current location, use self-contained frozen G0 meanwhile.
- [ ] SG2-PROBES: P1–P3/P10 and real enrollment acceptance are unverified; fake tests do not authorize activation.
- [ ] SG2-CI: conductor owns the wagon version-gate resolution; preserve the no-bump instruction.
- [x] Conductor is the designated Track writer; import this branch plan and final report, no concurrent `.track` writes here.

## AI Flaky tests
- [x] No AI-dependent tests or flaky exception.

## Orchestration Mode (AI-selected)
- [x] Mono-branch build lane; consolidated review on the final train diff.

## UAT Management (in orchestration context)
- [ ] Verify fake-forge path refusals, fixed-SHA pagination, atomic multi-file commit, attribution, CAS and lease isolation.
- [ ] Keep real witness calls disabled without explicit enrolled host configuration.

## Plan / Todo (lot-based)
- [x] Lot 0: read rules, G0 v3, owner decisions and SG0-app port; create worktree and pass harness C1.
- [ ] Lot 1: typed GitPort, read/write policy and SG0-app structural lease contract.
  - [x] Define SHA-pinned source pages, materialized atomic changes and the injected SG0-app lease surface.
- [ ] Lot 2: fake forge tests in `tests/git-port.test.ts`, `tests/git-port-policy.test.ts`, `tests/fixtures/git-port-fake.ts`.
- [ ] Lot 3: GitHub transport, SHA-pinned directory pagination, commit objects and atomic conditional ref advance.
- [ ] Lot 4: server-resolved authorship, short-lived lease checks, test-only enrolled witness adapter and host docs.
- [ ] Lot 5: scoped tests, typecheck/lint, harness scope, early push, one ready train PR, CI green and volume cleanup.
