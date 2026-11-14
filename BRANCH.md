# Feature: Disable artifact builds and live workers without capacity

## Objective
- [x] Apply the owner directive to stop using removed build capacity; preserve builder code until V8 step 7.

## Scope / Guardrails
- [x] Worktree: `tmp/worktrees/builder-gate-off`; branch: `fix/artifact-builder-gate-off`, based on `origin/main`.
- [x] Make-only, Docker-first; no cluster access, deployment, merge, secrets or package changes.
- [x] Environment: `fix-builder-gate-off`; API_PORT=9860, UI_PORT=6060, MAILDEV_UI_PORT=1960; verified free with `ss -ltn`.
- [x] Manifest target rejects `ENV=fix-builder-gate-off` with `ERROR: use ENV=test-*`; use isolated `ENV=test-fix-builder-gate-off` for that target without bypassing its guard.
- [x] Free disk before testing: 35 GB (minimum 30 GB).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `deploy/k8s/overlays/**`
  - `deploy/ci/artifact-content/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/**`
  - `packages/**`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `deploy/k8s/base/**` (only if needed)
  - `.github/workflows/**`
- **Exception process**:
  - [x] No exceptions needed; report any blocking scope change before editing.

## Feedback Loop
- [x] Track imports belong to the conductor as designated single writer; this branch provides the mergeable request and lot source.
- [x] Bundle assertions: 211 pass. Full target fails A4 process observation deadlines; serial execution also fails and was reverted. No timeout or test weakened; exact-head CI remains required.
- [x] Shared disk fell below 30 GB after tests; no new local image build permitted. Cleanup requested for this lane only.
- [x] Astra found no configuration defect; P2 requires complete passing manifest/A4 validation. Keep PR draft until exact-head CI resolves this gate.

## AI Flaky tests
- [x] No provider-dependent tests or flaky acceptance.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; one configuration fix and its regression checks.

## UAT Management (in orchestration context)
- [x] No interactive UAT: no application code changes and cluster access is prohibited.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read rules, common packet, branch template and the builder/live composition.
  - [x] Create isolated worktree and pass mechanical `harness check branch`.
- [x] **Lot 1 — Close capacity gates**
  - [x] Disable preprod `ARTIFACT_BUILDER_ENABLED` in `deploy/k8s/overlays/preprod/patch-api-config.yaml`.
  - [x] Disable preprod `APP_ARTIFACT_LIVE_ENABLED` in `deploy/k8s/overlays/preprod/patch-artifact-content-config.yaml`.
  - [x] Confirm prod builder absent and prod live closed; preserve published content and builder code.
  - [x] Update tier expectations and negative mutations in `deploy/ci/artifact-content/bundle-checks.mjs` and `bundle.selftest.mjs`.
- [ ] **Lot 2 — Validation and handoff**
  - [x] Run manifest/bundle checks through the existing make target, including both tiers and A4 overlays; record A4 process failures without accepting them.
  - [x] Complete independent code review and mechanical scope verification before commit; retain the unresolved P2 validation finding above.
  - [ ] Push branch and create PR using this file as its body; post the execution checklist.
  - [ ] Confirm CI green on exact head; do not merge or deploy.
  - [ ] Write `.tmp/rv/builder-gate-off.md` with consumer impact and residual platform references, then `.done`.
  - [x] Clean the isolated environment with `make down-volumes`; `make disk-hygiene` reclaimed 0 B.
