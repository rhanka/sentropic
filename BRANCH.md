# Feature: Typed prerelease skip for the publish-cluster-mesh CI job

## Objective
A prerelease Cluster Mesh version on main (the planned bump-gate dev series between releases) must not fail the `publish-cluster-mesh` job and `ci-gate`: it must skip publication as a typed, logged success. Stable versions keep publishing under the unchanged `engram-e2-stable-publish-guard`.

## Scope / Guardrails
- Scope limited to the Cluster Mesh publish decision wiring: a `scripts/ci` decision module, its Make entry point, the `publish-cluster-mesh` job steps, and the decision test.
- Make-only workflow, no direct Docker/npm commands.
- The `engram-e2-stable-publish-guard` and every publish check stay unchanged for stable versions; a prerelease that still reaches a publish target fails red (defense in depth, never weakened).
- Never publish a prerelease version: the Publish and post-publication qualification steps run only when the decision is `publish`.
- Development in worktree `tmp/worktrees/cm-publish-skip` (branch `fix/cm-publish-prerelease-skip` from `origin/main`); harness branch check PASS.
- Local targeted tests on `ENV=test-cmps`; `ENV=<env>` last in every make command; never `ENV=dev`.
- Retain CI lockfile-lane policy acknowledgment `review_by=2026-11-30T00:00:00Z` required by the existing manifest regression gate (BRLOCK-EX1 scope covers this branch's Makefile and CI workflow paths); this branch changes no install surface.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `scripts/ci/cluster-mesh-publish-decision.mjs` (new)
  - `scripts/ci/cluster-mesh-publish-decision.test.mjs` (new)
  - `scripts/ci/ci-expected-results.test.mjs` (evolve the publish step-condition assertion for the decision-gated cluster-mesh steps)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `api/**`, `ui/**`, `packages/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile` (BR866-EX1)
  - `.github/workflows/**` (BR866-EX2)
- **Exception process**:
  - [x] Declare exception ID `BR866-EXn` in `## Feedback Loop` with rationale, impact and rollback before touching any conditional/forbidden path.

## Feedback Loop
- [x] BR866-EX1 — `Makefile` (conditional path)
  - Reason: add the make-only entry point `cluster-mesh-publish-decision` (typed decision forwarded to `$GITHUB_OUTPUT`, summary to `$GITHUB_STEP_SUMMARY`) and register the new test in the default `test-publishable-manifests` scope so it runs in CI.
  - Impact: additive only; no existing recipe, guard or publish target is modified.
  - Rollback: delete the new target, its `.PHONY` line and the default-scope entry.
- [x] BR866-EX2 — `.github/workflows/ci.yml` (conditional path)
  - Reason: the `publish-cluster-mesh` job must decide before publishing; a typed decision step gates the Publish and post-publication qualification steps so a prerelease is a green, logged skip on main.
  - Impact: on prerelease heads the two steps are skipped and the job is green with a step summary; stable heads publish exactly as before; PR and dry-run paths unchanged.
  - Rollback: revert the job block to the previous steps (decision step removed, previous `if` conditions restored).

## AI Flaky tests
- [x] Not applicable: deterministic decision logic, fixture manifests and wiring assertions; no model inference.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single wiring fix; one final test cycle)
- [ ] **Multi-branch** (not used)

## UAT Management (in orchestration context)
- **Mono-branch**: no UI surface; validation is the new decision test, the existing wiring/version-filter/expected-results tests, and one CI run on the final head.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and evidence**
  - [x] Worktree `tmp/worktrees/cm-publish-skip` on `fix/cm-publish-prerelease-skip` from `origin/main`; harness branch check PASS; `.env` copied.
  - [x] Failure evidence: runs 41251862597 (0.26.0-dev.0) and 41247348121 (0.26.0-dev.1) fail `publish-cluster-mesh` on the `engram-e2-stable-publish-guard` line « Only stable Cluster Mesh versions may be published », taking `ci-gate` red; main currently sits at 0.26.0-dev.1.
- [x] **Lot 1 — Decision module and Make entry point (BR866-EX1)**
  - [x] `scripts/ci/cluster-mesh-publish-decision.mjs`: `decideClusterMeshPublish` (stable → publish; semver prerelease → typed skip; anything else → red) plus a CLI emitting `decision=`/`reason=`/`version=`/`summary=` lines.
  - [x] Makefile `cluster-mesh-publish-decision` target: Docker + pinned semver, forwards typed lines to `$GITHUB_OUTPUT` and the summary to `$GITHUB_STEP_SUMMARY`.
- [x] **Lot 2 — CI wiring (BR866-EX2)**
  - [x] `publish-cluster-mesh` job: Decide Cluster Mesh publication step (id + make target) before Publish; Publish and Qualify steps gated on `decision == 'publish'`.
  - [x] Dry-run publication step, stable guard and bootstrap-token path unchanged.
- [x] **Lot 3 — Test of the decision**
  - [x] `scripts/ci/cluster-mesh-publish-decision.test.mjs`: stable publishes; prerelease skips without any npm publish call (unit + CLI fixtures + ci.yml/Makefile wiring assertions); invalid versions stay red.
  - [x] Evolve `scripts/ci/ci-expected-results.test.mjs` publish step-condition assertion for the decision-gated cluster-mesh steps.
  - [x] Register the new test in the default `test-publishable-manifests` scope.
- [ ] **Lot 4 — Local validation, commit, PR, CI, report**
  - [x] Local targeted runs: new test, `check-ci-version-filters`, publishable-ci-wiring tests, `test-ci-expected-results`.
  - [x] `make scope-check` + `make commit` (atomic, ≤150 lines, selective staging).
  - [ ] Draft PR with `BRANCH.md` as body; ONE CI run on the final head; wait for completion.
  - [ ] Report to `.tmp/rv/cm-publish-skip.md`; no merge.

## Validation record
- [x] `make cluster-mesh-publish-decision` on the current head (0.26.0-dev.1): `decision=skip`, `reason=prerelease`, exit 0; with `GITHUB_OUTPUT`/`GITHUB_STEP_SUMMARY` set, exactly the typed lines and `prerelease 0.26.0-dev.1: not published` are forwarded.
- [x] `make test-publishable-manifests SCOPE=scripts/ci/cluster-mesh-publish-decision.test.mjs ENV=test-cmps`: 5/5 pass.
- [x] `make test-publishable-manifests SCOPE=scripts/ci/publishable-ci-wiring.test.mjs ENV=test-cmps`: 33/33 pass.
- [x] `make check-ci-version-filters`: filters still cover every API/UI/E2E hash input.
- [x] `make test-ci-expected-results ENV=test-cmps`: 28/28 pass (evolved DAG assertion included).
- [x] `make test-publishable-manifests ENV=test-cmps` (default scope, includes the new test): 108/108 pass; `make ci-capacity-policy ENV=test-cmps` exits 0 on the edited workflow.
- [ ] `make scope-check` before commit; final-head CI outcome recorded in `.tmp/rv/cm-publish-skip.md`.
