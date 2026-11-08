# Feature: Train 1d 2026-11-07 A-LIVE live invitations, pod quota fit and controller pod slots

## Objective
- [ ] One train, one PR, one CI on main c754d639d (#946 merged): feat/artifacts-live-invitations (307cab2be + the s-archi R1 replay fix 50cf410a) as @sentropic/artifacts 0.2.22, the pod quota fit (s-archi addendum A) and the controller pod slots (addendum B rules 1-3); wagon BRANCH.md edits dropped.
- [x] Frozen: `packages/artifacts/src/live-host` byte-identical to a5d8dee87.
- [x] perf/ci-tested-tree r2 (da7a752f2) rides as the second push: 13 commits cherry-picked without conflict (2 BRANCH.md-only commits skipped), change lines identical to the wagon; binding checks (a)-(h) re-run below.

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
  - `.cursor/rules/**`
  - `.track/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed with declared exception)**:
  - `api/src/services/mcp/cluster-registry.ts`, `api/tests/api/app-mcp-installed.test.ts`, `api/tests/api/app-mcp-registry.test.ts`, `api/tests/api/mcp-workspaces-list-dispatch.test.ts` under BR90-EX17.
  - `packages/cluster-mesh/src/runtime/heavy-phase-queue.ts`, `packages/cluster-mesh/src/index.ts`, `packages/cluster-mesh/package.json`, `packages/cluster-mesh/CHANGELOG.md` under BR90-EX18.
  - `package-lock.json`, `api/package-lock.json` under BR90-EX19.
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/**`, `packages/cluster-mesh/tests/packaging/artifacts-tuple.spec.ts` under BR90-EX20.
  - `packages/cluster-mesh/tests/integrations/artifacts-surface.spec.ts` under BR90-EX21.
  - `.github/workflows/ci.yml`, `scripts/ci/**` under BR92-EX3.

## Feedback Loop
- [x] BR90-EX17: `ARTIFACTS_PROVIDER_VERSION` follows the package (0.2.22); APP-P1 digest repinned (version field only, four-tool selection unchanged). Rollback: revert with the bump.
- [x] BR90-EX18: heavy-phase queue pod slots (`maxPods`, blocker `pods`) and build cost 1261 MiB (1280Mi limit minus the 19 MiB pod base); `@sentropic/cluster-mesh` 0.26.0-dev.16 to 0.26.0-dev.17 with changelog. Rollback: revert the queue, the tests and the bump together.
- [x] BR90-EX19: root and api lock workspace entries follow artifacts 0.2.22 and cluster-mesh 0.26.0-dev.17 (version strings only). Rollback: revert with the bumps.
- [x] BR90-EX20: the selected packaging fixture names the artifacts 0.2.22 and cluster-mesh 0.26.0-dev.17 archives with the regenerated artifacts integrity pin (guarded sibling sha256 57a0e4908f0fdc8debece64e8bb0ed2cfd24412032ab3d49f473d4908b1b4a62, from pack-candidate-siblings then refresh-lazy-package-lock). Rollback: revert with the bumps.
- [x] BR90-EX21: the exact tool-name pins of the packed consumer probe (`packages/artifacts/probe/packed-consumer.mjs`) and of the cluster-mesh artifacts surface spec append the four frozen invitation tools (exact equality kept; the wagon had not run them). Rollback: revert with the wagon.
- [x] BR92-EX3 (perf/ci-tested-tree, renumbered from its wagon BR92-EX1, which main's Makefile already uses for ci10): a push to main reuses a completed same-tree pull_request run only when every same-tree candidate and attempt is green, the reused attempt is under 24 h old, ci-gate and its expected set succeeded and every dropped member succeeded; any capture or API error keeps the complete run. Only `actions: read` added (changes job); builds still gate every publisher. Rollback: revert the workflow and scripts/ci together; an absent `tested_tree` means a full run.
- [ ] `attention`: tested-tree residuals: a dropped member is proven by its job conclusion only (a job whose steps were all skipped concludes success); multiple green same-tree candidates reuse the newest instead of a full run (all-green rule, not a refusal); first observation point is the first main push after merge.
- [ ] `attention`: build-1280 verdict NO: no measured build heap passes under 1280Mi with one CPU (1024 and 896 OOM-killed, 768 and 640 V8 heap OOM; 1536Mi passes at peak 1388.6 MiB). `NODE_BUILD_HEAP_OPTIONS` stays 1024 and is unverified; the in-pod clean build does not fit the quota-fit pod. Owner s-archi.
- [ ] `attention`: preprod and prod builder namespaces share the d2-4 pool while each environment's W8 queue assumes the full 1641 MiB; prod-activation blocker (prod live is OFF). Owner s-archi/k8s.

## AI Flaky tests
- [x] No flaky allowance, timeout increase or new skip.

## Orchestration Mode (AI-selected)
- [ ] **Mono-branch + cherry-pick**
- [x] **Multi-branch**
- [x] Rationale: wagon branches built separately, integrated into one dated train with one version assignment, one PR and one CI.

## UAT Management (in orchestration context)
- [ ] Exact-head pull_request CI result retained in the PR.

## Plan / Todo (lot-based)
- [x] Lot 1: feat/artifacts-live-invitations (307cab2be) cherry-picked without conflict (10 commits, 2 BRANCH.md-only commits skipped). The s-archi R1 replay fix (wagon 50cf410a, its BRANCH.md hunk dropped) applied on top; make test-artifacts on test-train1d-fu green (96 files / 979 tests).
- [x] Lot 2: provider version 0.2.22 and APP-P1 repin: manifest at version 0.2.21 still hashes 5150544a (the four new tools are outside the APP-P1 selection), 0.2.22 hashes 61c50b33.
- [x] Lot 3: pod quota fit (addendum A): requests 250m/420Mi/0, limits 1/1280Mi/2560Mi, emptyDir source 256Mi, scratch 1280Mi, dependencies 1024Mi; the pod test asserts the tenant LimitRange and ResourceQuota fit for four pods.
- [x] Lot 4: controller pod slots, quota backpressure and no surge (addendum B rules 1-3): `heavy.pod` takes a FIFO pod slot (`MAX_BUILDER_PODS` 4, `blockedBy: 'pods'`) before every create; a 403 exceeded quota gives the slot back, requeues and retries (past the wait bound `builder_unavailable`/`queued`); a fresh intent deletes an older or terminating pod and waits for its 404 before creating. pod-slots.test.ts 8/8; artifacts-live 43 files 296/296; API tsc clean, lint 0 errors.
- [x] Lot 5: cluster-mesh bump, locks and selected fixture; heavy-phase-queue spec 8/8; cluster-mesh packaging scope 85 pass / 60 skipped; lazy package: lock integrity matches the 0.2.22 sibling, 134/136 locally (optional-install spawn cases over the 5 s test timeout under host load: suite 72 s vs 28 s on train 1b; the PR CI decides).
- [ ] Lot 6: scoped checks, push, open the PR (#947), GLM review of the full diff. Tested-tree checks: test-ci-tested-tree 11/11, expected-results 28/28, ci-dag 10/10, ci-static 3/3, run-metrics 37/37, release-receipts 43/43, unit-graph 7/7, performance-report 8/8, live-provider-receipt 13/13, package-qualification-dag 9/9, browser-shards 6/6, consumer-contracts 25/25, wiring 70/70, security-daily 333/333.
- [ ] Lot N: Final validation: exact-head CI green; remove BRANCH.md at merge.
