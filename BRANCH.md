# Feature: Train 1d 2026-11-07 A-LIVE live invitations, pod quota fit and controller pod slots

## Objective
- [ ] One train, one PR, one CI on main c754d639d (#946 merged): feat/artifacts-live-invitations (307cab2be) as @sentropic/artifacts 0.2.22, the pod quota fit (s-archi addendum A) and the controller pod slots (addendum B rules 1-3); wagon BRANCH.md edits dropped.
- [x] Frozen: `packages/artifacts/src/live-host` byte-identical to a5d8dee87.
- [ ] perf/ci-tested-tree r2 rides as a second push only once pushed with its binding checks re-run.

## Scope / Guardrails
- [x] Branch train/2026-11-07-alive-1d from origin/main c754d639d; worktree tmp/worktrees/train1d; ENV=test-train1d.
- [x] Make only; no Python, attribution trailers, CI skips, reruns or CI polling; no local image build (API checks run in the existing node image).
- [x] Scoped local checks only; full suites run in the PR CI.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/**` except `packages/artifacts/src/live-host/**`
  - `api/src/services/artifacts/live/**`
  - `api/tests/unit/artifacts-live/**`
  - `packages/cluster-mesh/tests/heavy-phase-queue.spec.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `packages/artifacts/src/live-host/**`
  - `Makefile`
  - `docker-compose*.yml`
  - `.github/workflows/**`
  - `.cursor/rules/**`
  - `.track/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed with declared exception)**:
  - `api/src/services/mcp/cluster-registry.ts`, `api/tests/api/app-mcp-installed.test.ts`, `api/tests/api/app-mcp-registry.test.ts`, `api/tests/api/mcp-workspaces-list-dispatch.test.ts` under BR90-EX17.
  - `packages/cluster-mesh/src/runtime/heavy-phase-queue.ts`, `packages/cluster-mesh/src/index.ts`, `packages/cluster-mesh/package.json`, `packages/cluster-mesh/CHANGELOG.md` under BR90-EX18.
  - `package-lock.json`, `api/package-lock.json` under BR90-EX19.
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/**`, `packages/cluster-mesh/tests/packaging/artifacts-tuple.spec.ts` under BR90-EX20.

## Feedback Loop
- [x] BR90-EX17: `ARTIFACTS_PROVIDER_VERSION` follows the package (0.2.22); APP-P1 digest repinned (version field only, four-tool selection unchanged). Rollback: revert with the bump.
- [ ] BR90-EX18: heavy-phase queue pod slots (`maxPods`, blocker `pods`) and build cost 1261 MiB (1280Mi limit minus the 19 MiB pod base); `@sentropic/cluster-mesh` 0.26.0-dev.16 to 0.26.0-dev.17 with changelog. Rollback: revert the queue, the tests and the bump together.
- [ ] BR90-EX19: root and api lock workspace entries follow artifacts 0.2.22 and cluster-mesh 0.26.0-dev.17 (version strings only). Rollback: revert with the bumps.
- [ ] BR90-EX20: the selected packaging fixture names the artifacts 0.2.22 and cluster-mesh 0.26.0-dev.17 archives with the regenerated artifacts integrity pin. Rollback: revert with the bumps.

## AI Flaky tests
- [x] No flaky allowance, timeout increase or new skip.

## Orchestration Mode (AI-selected)
- [ ] **Mono-branch + cherry-pick**
- [x] **Multi-branch**
- [x] Rationale: wagon branches built separately, integrated into one dated train with one version assignment, one PR and one CI.

## UAT Management (in orchestration context)
- [ ] Exact-head pull_request CI result retained in the PR.

## Plan / Todo (lot-based)
- [x] Lot 1: feat/artifacts-live-invitations (307cab2be) cherry-picked without conflict (10 commits, 2 BRANCH.md-only commits skipped).
- [x] Lot 2: provider version 0.2.22 and APP-P1 repin: manifest at version 0.2.21 still hashes 5150544a (the four new tools are outside the APP-P1 selection), 0.2.22 hashes 61c50b33.
- [ ] Lot 3: pod quota fit (addendum A).
- [ ] Lot 4: controller pod slots, quota backpressure and no surge (addendum B rules 1-3).
- [ ] Lot 5: cluster-mesh bump, locks and selected fixture.
- [ ] Lot 6: scoped checks, push, open the PR, GLM review of the full diff.
- [ ] Lot N: Final validation: exact-head CI green; remove BRANCH.md at merge.
