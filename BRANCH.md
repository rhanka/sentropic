# Feature: A4 train — cluster-mesh gap lots G1-G5

## Objective
Integrate the five approved A4 cluster-mesh gap lots G1 to G5 (PRs #899, #902, #900, #903, #904) onto origin/main in one train PR, with a single version bump and single lock/fixture/manifest regeneration.

## Scope / Guardrails
- Scope limited to the union of the five lot path lists (design `.tmp/cm-identity-agents/a4-cm-gaps-r2.md`, lots G1-G5).
- Wagon branches merged with `git merge --no-ff` in order G1, G2, G3, G4, G5; conflicts resolved as UNION (keep every lot code and test).
- Version and lock conflicts: take either side during merges, then set `@sentropic/cluster-mesh` once to the next free dev version above main and regenerate through make.
- Make-only workflow, no direct Docker commands; one Docker lock per make command (`flock /home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md make ...`), never nested; the sibling train `release/train-2026-11-04` keeps Docker priority.
- Tests on `ENV=test-train-a4` only, ENV always last; `make down-volumes ENV=test-train-a4` at the end, including on failure.
- No `[skip ci]` anywhere; commits via `make commit MSG="..."` only, <=150 lines, selective staging.
- Branch development happens in worktree `tmp/worktrees/train-a4` (branch `release/train-a4-gaps` from `origin/main`).
- In every `make` command, `ENV=<env>` is passed as the last argument.
- All new text in English.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/cluster-mesh/src/identity-contracts/**`
  - `packages/cluster-mesh/src/identity-stores/tenancy-postgres.ts`
  - `packages/cluster-mesh/src/identity-stores/tenancy-sqlite.ts`
  - `packages/cluster-mesh/src/identity/**`
  - `packages/cluster-mesh/src/storage/identity/**`
  - `packages/cluster-mesh/tests/identity/oauth-reads.spec.ts`
  - `packages/cluster-mesh/tests/boundary-resolution.spec.ts`
  - `packages/cluster-mesh/tests/identity/service-tenancy.spec.ts`
  - `packages/cluster-mesh/tests/identity/workspace-deletion.spec.ts`
  - `packages/cluster-mesh/tests/identity/replica-sync.spec.ts`
  - `packages/cluster-mesh/package.json`
  - `package-lock.json` (mechanical lockfile sync of the single train version bump only)
  - `api/package-lock.json` (mechanical `file:` sync of the same bump only, pattern ddbe7b65e)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
  - `tools/memory-mcp-l5/artifacts/**` (BR-TRAIN-EX1)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/cluster-mesh/src/**` except the identity-contracts, identity and storage/identity paths above
  - `api/src/**`
  - `api/tests/**`
  - `ui/**`, `e2e/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
  - `packages/cluster-mesh/tests/packaging/artifacts-tuple.spec.ts` (only if the fixture re-pin flow requires it)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
- BR-TRAIN-EX1 (scope exception, `tools/memory-mcp-l5/artifacts/**`): the root lock carries the new train cluster-mesh dev version after `make lock-root`, so the committed P1 manifest no longer matches the live lock fingerprint; regenerate through `make memory-l5-pack STAGE=pre-candidate ARTIFACT_MANIFEST=tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json` (never hand-editing digests), previous manifest retained in `artifacts/history/`. Rollback: restore the retained history manifest/sidecar and delete the new snapshot. Precedent: G1 lane (969adf3a), main 3dd7d8012.
- BR-TRAIN-EX2 (packaging fixture re-pin): `tests/packaging/prepare-artifacts.spec.ts` requires the `selected` fixture to pin the workspace candidate version exactly; re-pin `fixtures/selected/package.json` + `package-lock.json` through `make pack-candidate-siblings` + `refresh-lazy-package-lock`. Rollback: revert the fixture files to the main pin. Precedent: G4 BR-G4-EX2, G5 BR-G5-EX2.
- G1 review (`.h2a/reviews/pr899-large4_r1.md`): VERDICT APPROVE.
- G2 review (`.h2a/reviews/pr902-large4_r1.md`): VERDICT APPROVE (parallel dev.7 collision expected, conductor assigns versions in merge order).
- G3 review (`.h2a/reviews/pr900-large4_r1.md`): VERDICT CHANGES; only findings are the version collision and its lockfile desync — both resolved by this train (single dev.9 bump + root lock regen, no per-wagon bump).
- G4 review (`.h2a/reviews/pr903-large4_r1.md`): VERDICT APPROVE.
- G5 review (`.h2a/reviews/pr904-large4_r1.md`): VERDICT APPROVE.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - G2 precedent: PostgreSQL spec timeouts under shared-host load, same head + same command rerun 16/16 — proven transient, no timeout change.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single integration branch, merges of five reviewed heads, one final test cycle)
- Rationale: five approved wagon heads merged in order with union resolution; one version bump; one test cycle.

## UAT Management (in orchestration context)
- **Mono-branch**: no UI surface change; cluster-mesh package lanes only on `ENV=test-train-a4`.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and worktree**
  - [x] Read `rules/MASTER.md`, `.tmp/packets/COMMON-RULES.md`, design `.tmp/cm-identity-agents/a4-cm-gaps-r2.md` §5.
  - [x] Create worktree `tmp/worktrees/train-a4` on branch `release/train-a4-gaps` from `origin/main` (3dd7d8012).
  - [x] Write this `BRANCH.md` from `plan/BRANCH_TEMPLATE.md` with BRLOCK-EX1 review_by line retained.
  - [x] Environment mapping: `ENV=test-train-a4` for every test stack, never root dev; sibling train `release/train-2026-11-04` keeps Docker priority, lock taken per make command only.
  - [x] Confirm command style: `flock /home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md make ... ENV=test-train-a4` with `ENV` last.
- [x] **Lot 1 — Merge G1-G5 in order**
  - [x] `git merge --no-ff origin/feat/cm-a4-gaps-g1-oauth-reads` (G1, #899).
  - [x] `git merge --no-ff origin/feat/cm-a4-gaps-g2-boundary` (G2, #902); union `composition-descriptors.ts` + `index.ts`.
  - [x] `git merge --no-ff origin/feat/cm-a4-gaps-g3-service-tenancy` (G3, #900); union `composition-descriptors.ts` + `index.ts` + `custody-auth.ts`.
  - [x] `git merge --no-ff origin/feat/cm-a4-gaps-g4-workspace-deletion` (G4, #903); union `composition-descriptors.ts` + `index.ts` + `custody-errors.ts`.
  - [x] `git merge --no-ff origin/feat/cm-a4-gaps-g5-replica-sync` (G5, #904); union `composition-descriptors.ts` + `index.ts` + `custody-errors.ts` + storage index.
  - [x] Version/lock conflicts: take either side during merges, regenerate once in Lot 2.
- [x] **Lot 2 — Single version bump and regeneration**
  - [x] Set `packages/cluster-mesh/package.json` to the next free dev version above main (`0.26.0-dev.9` unless another cluster-mesh bump merged first).
  - [x] Regenerate root lock (`make lock-root`), `api/package-lock.json` file sync, packaging fixtures, L5 P1 manifest — all through make, once.
  - [x] `make scope-check` before every commit; atomic `make commit` commits.
- [x] **Lot 3 — Test gates on ENV=test-train-a4**
  - [x] `make test-cluster-mesh SCOPE=tests/identity/oauth-reads.spec.ts ENV=test-train-a4` (G1): 5/5 sqlite.
  - [x] `make test-cluster-mesh SCOPE=tests/boundary-resolution.spec.ts ENV=test-train-a4` (G2): 12 passed + 4 skipped sqlite; 16/16 postgres (one 5s-timeout run rerun green, proven transient).
  - [x] `make test-cluster-mesh SCOPE=tests/identity/service-tenancy.spec.ts ENV=test-train-a4` (G3 sqlite): 19/19 after pre-G1 simulation + positive union test; postgres via identity campaign.
  - [x] `make test-cluster-mesh SCOPE=tests/identity/workspace-deletion.spec.ts ENV=test-train-a4` (G4): 16/16 after descriptor containment fix.
  - [x] `make test-cluster-mesh SCOPE=tests/identity/replica-sync.spec.ts ENV=test-train-a4` (G5 sqlite): 10/10; postgres via identity campaign.
  - [x] `cluster-mesh-identity-test` both profiles: 28 files / 346 tests green on sqlite AND postgres.
  - [x] `make down-volumes ENV=test-train-a4` at the end, including on failure (pg container removed, exit 0).
- [ ] **Lot 4 — Train PR and wagon closure**
  - [ ] Push `release/train-a4-gaps`, open one READY PR « A4 train: cluster-mesh gap lots G1–G5 ».
  - [ ] Comment on PRs #899, #902, #900, #903, #904 that they are superseded by the train PR, and close them.
- [ ] **Lot 5 — CI watch**
  - [ ] Watch the single pull_request CI; fix real failures at the root; empty-commit retrigger only for AI-flaky shards, max 3.
  - [ ] Report steps, PR number and run ids to `.tmp/rv/train-a4.md`; do NOT merge.
