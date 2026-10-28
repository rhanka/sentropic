# Feature: Engram E10a installed neutral handle

## Objective
- Ship the fenced neutral-handle factory and the K7/K8 wire adaptation in the installed cluster-mesh bytes so durable memory runs from installed bytes only, with no host-authored bridge.

## Scope / Guardrails
- Base `feat/engram-e2-integration` at `ef585a6b1164923929add4dfee2c8a64390da267`; branch `feat/cluster-mesh-engram-e10a`; worktree `tmp/worktrees/mem-e10a`; draft PR against `feat/engram-e2-integration`; merge only, never rebase, never force-push.
- Ports reserved for this branch only: API 8792, UI 5192, Maildev UI 1092; `ENV=test-mem-e10a` last; never `ENV=dev`; never `make clean-all`; 0 Python.
- One Docker build at a time under the shared Docker lock; `make down ENV=test-mem-e10a` after each Docker step.
- Commits under 150 lines via `make commit`, specific `git add` only, no AI trailers.
- Additive export only on the frozen `./engram-memory` surface: rationale is that the installed export has no neutral-handle factory and the frozen Engram substrate speaks snake-case K7/K8 wire while the kernel validator expects the camel-case proof model; impact is new exported factory and pure adaptation helpers with no change to existing exported behavior, digests or descriptors; rollback is removal of the new modules, their exports and the pack-only version increment.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/src/engram-memory/**`
  - `packages/cluster-mesh/tests/engram-memory/**`
  - `packages/cluster-mesh/package.json`
  - `package-lock.json`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/engram/**`
  - `api/**`
  - `ui/**`
  - `.github/workflows/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `packages/cluster-mesh/src/storage/**` (not activated)
- **Exception process**:
  - No exception declared; the additive `./engram-memory` export is declared above with rationale, impact and rollback.

## Feedback Loop
- Frozen-surface gates from the pack-only tolerance and the Comments gate lines must still pass on this branch; any failure is blocking for this lot.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: single additive module lot with unit tests and one pack-only version increment.

## Plan / Todo (lot-based)
- [x] **Lot E10a-0 — Baseline and constraints**
  - [x] Read `rules/MASTER.md`, `plan/BRANCH_TEMPLATE.md` and the E10a conductor packet.
  - [x] Create isolated worktree `tmp/worktrees/mem-e10a` on `feat/cluster-mesh-engram-e10a` from `origin/feat/engram-e2-integration` at `ef585a6b1164923929add4dfee2c8a64390da267`.
  - [x] Confirm ports API 8792, UI 5192, Maildev UI 1092 and `ENV=test-mem-e10a` last.
  - [x] Declare the additive `./engram-memory` export with rationale, impact and rollback in Scope / Guardrails.
- [x] **Lot E10a-1 — Wire adaptation**
  - [x] Add pure K7/K8 snake-case and camel-case adaptation both ways plus journal intent-hash carry and strip in `packages/cluster-mesh/src/engram-memory/`.
  - [x] Add unit tests for the adaptation both ways and for each refusal.
  - [x] Lot gate: scoped cluster-mesh tests for the new spec files.
- [x] **Lot E10a-2 — Neutral-handle factory**
  - [x] Add the fenced neutral-handle factory with fence acquire, check and release, transact, query, readCommitResult and host DDL/SQL through the injected driver.
  - [x] Export the factory and the adaptation through `./engram-memory` without changing existing exports, digests or descriptors.
  - [x] Add unit tests for fence, grant and driver refusals.
  - [x] Lot gate: scoped cluster-mesh tests plus typecheck and lint for cluster-mesh.
- [ ] **Lot E10a-3 — Pack-only version and handoff**
  - [x] Increment the pack-only version from `0.24.0-dev.1` to the next dev increment in the package manifest and the workspace lock.
  - [ ] Run `make scope-check` and the frozen-surface gates before every commit.
  - [ ] Push and open the draft PR against `feat/engram-e2-integration` with `BRANCH.md` as the PR body.
  - [ ] Require CI on the exact head before marking ready.
