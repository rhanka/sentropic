# Feature: Engram E10a installed neutral handle

## Objective
- Ship the fenced neutral-handle factory and the K7/K8 wire adaptation in the installed cluster-mesh bytes so durable memory runs from installed bytes only, with no host-authored bridge.

## Scope / Guardrails
- Base `feat/engram-e2-integration` at `ef585a6b1164923929add4dfee2c8a64390da267`; branch `feat/cluster-mesh-engram-e10a`; revision worktree `tmp/worktrees/mem-e10a-ci`; draft PR against `feat/engram-e2-integration`; merge only, never rebase, never force-push.
- Ports reserved for this branch only: API 8792, UI 5192, Maildev UI 1092; `ENV=test-mem-e10a-ci` last; never `ENV=dev`; never `make clean-all`; 0 Python.
- One Docker build at a time under the shared Docker lock; `make down ENV=test-mem-e10a-ci` after each Docker step.
- Commits under 150 lines via `make commit`, specific `git add` only, no AI trailers.
- Additive export only on the frozen `./engram-memory` surface: rationale is that the installed export has no neutral-handle factory and the frozen Engram substrate speaks snake-case K7/K8 wire while the kernel validator expects the camel-case proof model; impact is new exported factory and pure adaptation helpers with no change to existing exported behavior, digests or descriptors; rollback is removal of the new modules, their exports and the pack-only version increment.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/src/engram-memory/**`
  - `packages/cluster-mesh/tests/engram-memory/**`
  - `packages/cluster-mesh/package.json`
  - `package-lock.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
  - `packages/cluster-mesh/tests/packaging/prepare-artifacts.spec.ts`
  - `packages/cluster-mesh/tests/fixtures/reserved-versions.ts`
  - `packages/cluster-mesh/tests/storage/pack-only-dev-gate.mjs`
  - `packages/cluster-mesh/tests/storage/pack-only-dev-gate.spec.ts`
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
- [x] Opus r1 P1: reproduce nine malformed-proof failures; validate K7/K8 before translation and map canonical JSON errors to `invalid-schema`; exercise the installed Engram commit loop with no reconcile.
- [x] CI accepted baseline `05cecaa6f`; rerun CI on the revision head before handoff.
- [x] Opus r1 P2-D: enforce R-G3-1 second-holder refusal before side effects, including concurrent acquisitions; refresh ownership at checkFence per binding §§9.3–9.6 and test release/failure cleanup.
- [x] Opus r1 P1/P2-E: assert the adapted commit digest equals Engram's expectedIntentHash and round-trips through findIdempotency; typecheck the real PostgreSQL kernel/driver without casts and refuse binary memory reads.
- [x] BRE10a-EX1: owner-authorized PR #808 CI repair in `tmp/worktrees/mem-e10a-ci`, `ENV=test-mem-e10a-ci`; rationale: a frozen prerelease pin breaks pack-only alignment after the dev bump; impact: pin the selected fixture and lock to `0.23.2`, the latest published release whose dependency and peer metadata equals the candidate's (0.23.3/0.23.4 peer ranges differ), align the mirrored contract and assert only that frozen registry request; rollback: revert this repair commit. Registry reconfirmed `0.23.4` on 2026-10-28.
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
  - [x] Repair the stable selected fixture/lock pin; shared-lock `ENV=test-mem-e10a-ci` runs: targeted packaging 17 passed; full cluster-mesh 1361 passed, 268 conditional skips, no type errors; `make down` after each step.
  - [x] Run `make scope-check` and the frozen-surface gates before every commit.
  - [x] Push and open the draft PR against `feat/engram-e2-integration` with `BRANCH.md` as the PR body.
  - [x] Require CI on the exact head before marking ready (baseline `05cecaa6f`; repeat for revisions).
