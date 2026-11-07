# Feature: Train 3 2026-11-07 (UI folder reload, SCA gate hardening, builder pool d2-4, Track flake item)

## Objective
- [ ] One train, one PR, one CI: fix the folders/[id] use-case list reload race, harden the SCA gate (4 LOW findings of the #940 review), schedule live builder pods on the artifact-builders pool, and record the e2e flake in Track.
- [x] Wagons: fix/ui-folder-usecase-reload, chore/sca-gate-lows, feat/artifact-builder-pool-d2-4, chore/track-e2e-usecase-flake (cherry-picked onto main 2d06ba7eb without conflict).

## Scope / Guardrails
- [x] Branch train/2026-11-07-ci10-c; worktree tmp/worktrees/train3; ENV=test-ci10-train3.
- [x] Make only; no Python, attribution trailers, CI skips, reruns or CI polling.
- [x] Scoped local checks only; full suites run in the PR CI.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `ui/src/lib/utils/keyed-reload.ts`
  - `ui/src/routes/folders/[id]/+page.svelte`
  - `ui/tests/utils/keyed-reload.test.ts`
  - `scripts/security/sca-gate.mjs`
  - `scripts/security/sca-gate.test.mjs`
  - `.security/vulnerability-register.yaml`
  - `api/src/services/artifacts/live/pods.ts`
  - `api/tests/unit/artifacts-live/pods.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/*/src/**`
  - `api/drizzle/*.sql`
  - `.github/workflows/ci.yml`
- **Conditional Paths (allowed with declared exception)**:
  - `.track/**` under BR86-EX1.

## Feedback Loop
- [x] BR86-EX1: Track writer commit for the e2e use-case flake bug item 01M6VD98F8SY5WYQ186GV4F66A. Rollback: revert the Track commit.
- [ ] Acceptance: exact-head CI green; e2e 06-usecase passes; no gate weakened.

## AI Flaky tests
- [x] No flaky allowance, timeout increase or new skip.

## Orchestration Mode (AI-selected)
- [ ] **Mono-branch + cherry-pick**
- [x] **Multi-branch**
- [x] Rationale: four independent wagons integrated into one dated train with one CI.

## UAT Management (in orchestration context)
- [ ] Exact-head pull_request CI result retained in the PR.

## Plan / Todo (lot-based)
- [x] Lot 1: wagons cherry-picked onto main without conflict.
- [x] Lot 2: scoped checks green (sca-gate unit 14/14, ui keyed-reload 2/2; pods test 5/5 recorded by its wagon).
- [ ] Lot 3: push, open PR, review.
- [ ] Lot N: Final validation: exact-head CI green; remove BRANCH.md at merge.
