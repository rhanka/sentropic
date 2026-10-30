# Fix: Require daily security adapter regressions in CI

## Objective
- [x] Run the daily adapter suite in required CI while all service activation switches stay off.

## Scope / Guardrails
- [x] Worktree: `tmp/sec5a-ci-guards`; branch: `fix/sec5a-ci-guards`; rebased base: `028e63d33` (BR-80 #829, #841, #840 retained).
- [x] Make-only, Docker-first, zero Python, digest-pinned Node; no exception to vulnerability admission.
- [x] ENV=test-sec5a-ci last; no application stack or ports required; down after validation.
- [x] No daily scheduling, auto-merge, publishing, package source, or admission flag changes.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `.github/workflows/ci.yml`
  - `scripts/ci/publishable-ci-wiring.test.mjs`
  - `scripts/security/daily/scan.test.mjs`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.security/**`
  - `packages/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - None.

## Feedback Loop
- [x] SEC5ACI-EX1: required CI workflow change authorized by part 5a item 12; adds credential-free tests to existing required capacity job; rollback removes the invocation and contract test; expires at this PR's merge or abandonment, no runtime waiver.

## AI Flaky tests
- [x] None accepted.

## Orchestration Mode (AI-selected)
- [x] Multi-branch: independent CI, trust-custody, coverage and runtime-qualification PRs; this branch has no dependency on other groups.

## UAT Management (in orchestration context)
- [x] No application surface changed; workflow contract and CI supply acceptance.

## Plan / Todo (lot-based)
- [x] Lot 0: read rules, owner answers and #840 review; mechanical branch check passed.
- [x] Lot 1: replace indirect daily-test imports with one explicit required CI invocation; enforce its selection, permissions, suite inventory and ci-gate dependency in `scripts/ci/publishable-ci-wiring.test.mjs`.
- [x] Review correction: #840 item 12 missed existing indirect CI execution; this PR makes it explicit without duplicating suite execution.
- [x] Independent CI wiring suite: 31/31 passed; daily suite rerun after removing indirect imports.
- [x] Lot 2: Muse Wonder r1 reviewed `8cc4c1209`; all three findings reproduced by failing tests before correction.
- [x] Review item 1: derive daily test inventory from the directory; reject a recipe missing a newly discovered test.
- [x] Review item 2: blank inherited REGISTRY and ADMIN_EMAIL on the daily step and assert both overrides.
- [x] Review item 3: require full trimmed-line equality for test-publishable-manifests delegation with the complete SCOPE; reject echo substitution.
- [x] Local focused wiring suite: 33/33 pass after the three expected regression failures before correction.
- [x] Rebased full manifest/wiring suite: 103/103 pass; daily adapter suite: 125/125 pass under the shared Docker flock with ENV=test-sec5a-ci.
- [x] Prior reviewed head `8cc4c1209` completed successful CI (run 40999711242); successor exact-head completion is mandatory before handoff.
- [x] Lot 3: scope check before each <=150-line commit; PR body from this file; push with force-with-lease only on this branch.
- [x] Post-Rebase Gate: diff against origin/main touches no package manifest or source; no package version comparison or bump applies.
- [x] Keep the PR open for review; no merge or auto-merge.
