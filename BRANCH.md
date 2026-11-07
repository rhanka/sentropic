# fix: preserve the canonical GHCR UI image before qualification

## Objective
- [ ] Fix main run 42327588560 without weakening any tested/published config or manifest digest check; deliver one READY PR and exit after push.

## Scope / Guardrails
- [x] Branch fix/ghcr-ui-publish-digest from origin/main e671644444c37e2f9aab48007a091c7095460609; worktree tmp/worktrees/ghcr-ui-fix.
- [x] ENV=test-ghcr-ui-fix; API_PORT=9490 UI_PORT=5690 MAILDEV_UI_PORT=1590; no service stack or new local image build (disk 95%).
- [x] Make-only; ENV last; no Python, CI rerun, skip marker, attribution trailer, deployment or merge.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in .security/ci-lockfile-policy.json.
- [x] Track source artifact: conductor remains the designated .track writer; import this request, lots and final report from BRANCH.md and .tmp/rv/ghcr-ui-fix.md.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `plan/done/2026-11-06-ghcr-migration.md`
  - `scripts/ci/resolve-ui-image.mjs`
  - `scripts/ci/resolve-ui-image.test.mjs`
  - `scripts/ci/ui-image-version.sh`
  - `scripts/ci/ui-image-version.test.sh`
  - `scripts/check-ci-version-filters.sh`
  - `scripts/ci/publish-image.test.mjs`
  - `scripts/test-api-tooling.sh`
  - `scripts/ci/publishable-ci-wiring.test.mjs`
  - `Makefile`
  - `.github/workflows/ci.yml`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `packages/**`
  - `deploy/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile` under BRUI-EX1
  - `.github/workflows/ci.yml` under BRUI-EX2

## Feedback Loop
- [x] BRUI-EX1: owner-authorized publishing hotfix requires canonical UI resolution before testing and scoped fixtures; impact: UI image producer only; rollback: revert this hotfix.
- [x] BRUI-EX2: resolver-only edits must select global image qualification; impact: CI path selection only; rollback: revert this hotfix.
- [x] ROOT-CAUSE: publication fails at publish-image.mjs:23 before any push. GHCR ui:2d6476 is a single Docker v2 manifest with config ac35dc8ccf8220ccfa0fb02382579f4c6107e604cd494a63544c22dc72f38b5a; the rebuilt/tested image is b72f48451cf605582a9ad495bc6978b5c149e901ad7f71cce0784b4279139240. UI sources/Dockerfile did not change between 165ce5b93 and e67164444; rebuilding an existing content tag produced different bytes. API e75460 was absent and pushed successfully.
- [x] REVIEW-IDENTITY: canonical reuse requires the full shipped input identity; hash nginx, extension/static/workspace sources, root dependencies, production profiles/platform and build recipes before reuse. Preserve all publisher assertions.
- [x] REVIEW-WIRING: retain exact global-filter assertions and UI cache assertions while including the resolver/version inputs and testing the actual UI build primitive.

## AI Flaky tests
- [x] No exceptions, retries, timeout increases or weakened assertions.

## Orchestration Mode (AI-selected)
- [x] Mono-branch urgent hotfix; independent code review; one READY PR.

## UAT Management (in orchestration context)
- [x] Scoped fixtures qualify existing-tag reuse, absent-tag build, registry/pull/race refusals and tested/published config equality; input/profile mutations select a fresh tag. Final real GHCR publication runs on main after merge.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Evidence**: mechanical harness branch check; failed UI and successful API logs; inspect public UI manifest; archive the migration plan without losing Track source.
- [x] **Lot 1 — Fix and regression**: complete UI input/profile identity, canonical resolution before tests, unchanged publisher assertions; make test-ghcr-images PASS (20/20 plus login and input-version fixtures), make test-publishable-manifests SCOPE=scripts/ci/publishable-ci-wiring.test.mjs PASS (40/40), make test-ci-api-tooling CI_TOOLING_CASE=layers PASS, make check-ci-version-filters PASS. Actual Make production/uat profiles produce distinct tags.
- [ ] **Lot 2 — Review and handoff**: independent code review; make scope-check; atomic make commit; make down-volumes; push; one READY PR; write .tmp/rv/ghcr-ui-fix.md and exit without CI polling. Conductor owns CI observation, merge and Track import.
