# Feature: Cluster-mesh packed tuple-skew assertions independent of registry state

## Objective
Make the packed `tuple-skew.spec.ts` assert registry-state independent invariants (the old tuple is never accepted by a plain install; a skewed tree built by `--force` or `--legacy-peer-deps` is refused at runtime) instead of the exact npm outcomes frozen before llm-mesh 0.22.0 / llm-gateway 0.19.0 were published.

## Scope / Guardrails
- Scope limited to `packages/cluster-mesh/tests/packaging/**` (tests are not in the packed `files`, so no version bump).
- No migration.
- Make-only workflow, no direct Docker commands.
- Root workspace is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/cluster-mesh-tuple-skew`.
- Automated test campaigns run on `ENV=test-cluster-mesh-tskew`, never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/cluster-mesh/tests/packaging/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `packages/cluster-mesh/src/**`
  - `packages/cluster-mesh/package.json`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `packages/cluster-mesh/packaging.mk`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- `attention` TSKEW-F1: failure evidence — PR #619 CI run 36225265271, job `validate-cluster-mesh`, `tuple-skew.spec.ts` "should record npm dropping the old tuple and refuse the skewed tree at runtime": expected `plain-exit=0` with the old tuple dropped, received `plain-exit=1` (ERESOLVE); `force-installed` became `@sentropic/cluster-mesh@0.13.0 @sentropic/llm-mesh@0.21.2 @sentropic/llm-gateway@0.18.0` (skew built by `--force`, no `legacy-peer-deps` attempt). Cause: registry state change (train published), not #619.
- `attention` TSKEW-F2: exact npm outcomes stay recorded in `npm-install-detail` and printed by prepare.sh and the spec; the spec fails only on invariant violations, not on which of the npm-valid outcomes occurred.

## AI Flaky tests
- Not applicable (no AI test in scope).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: single test-only fix in one package.

## UAT Management (in orchestration context)
- No UI change; no UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/testing.md`, `plan/BRANCH_TEMPLATE.md`.
  - [x] Confirm worktree `tmp/cluster-mesh-tuple-skew` on branch `fix/cluster-mesh-tuple-skew-registry`.
  - [x] Targets: `make -f packages/cluster-mesh/packaging.mk test-lazy-package ENV=test-cluster-mesh-tskew`, `make test-cluster-mesh ENV=test-cluster-mesh-tskew`.
  - [x] Env `test-cluster-mesh-tskew`; ports API 9468 / UI 5668 / Maildev 1568 (no service stack started by these targets).
  - [x] Scope boundaries validated; no exception needed.

- [x] **Lot 1 — Registry-independent skew invariants**
  - [x] Add `packages/cluster-mesh/tests/packaging/skew-invariants.ts` (pure invariant checks over the recorded npm detail and the runtime probe).
  - [x] Add `packages/cluster-mesh/tests/packaging/skew-invariants.spec.ts` (negative fakes: old tuple accepted by plain install -> violation; skewed tree not refused -> violation; valid outcomes -> no violation).
  - [x] Rewrite `packages/cluster-mesh/tests/packaging/tuple-skew.spec.ts` (old-tuple and partial-bump) on the invariants; print the recorded npm outcomes.
  - [x] Update `packages/cluster-mesh/tests/packaging/prepare.sh` comments (recorded behavior no longer frozen).
  - [x] Review other packed assertions for frozen pre-publication registry behavior (none: `selected` is pinned by the committed lock and resolved from the registry; `latest` asserts in-range only).
  - [x] Lot gate:
    - [x] Baseline (before fix) registry mode reproduces the CI failure: old-tuple `plain-exit=1`, `skew-build=force`.
    - [x] Mutation run (temporary, not committed): old-tuple plain install ends with 0.21.2/0.18.0 installed -> red (2 violations).
    - [x] Mutation run (same packed run): partial-bump tree reports in-range versions -> red (preflight, 7 entries, load not refused).
    - [x] `make -f packages/cluster-mesh/packaging.mk test-lazy-package ENV=test-cluster-mesh-tskew` (registry mode, restored) green: 10 files, 63 tests.
    - [x] `make test-cluster-mesh ENV=test-cluster-mesh-tskew` green: 53 files passed, 5 skipped; 394 tests passed.
