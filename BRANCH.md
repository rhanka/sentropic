# Feature: Train 1c 2026-11-07 A-LIVE live remote, supervisor relay and live env

## Objective
- [ ] One train, one PR, one CI: perf/ci10-e2e-critical, feat/alive-supervisor-relay, feat/alive-live-remote, the live env and W8 budget wagon (s-archi), feat/alive-w9-rebind cherry-picked onto main c968b8d16 in that order; wagon BRANCH.md edits dropped.
- [x] Integration contract: recipes.ts stays the W4 single env author (`artifactEnvironment()` gains `MALLOC_ARENA_MAX=2` and `GOMEMLIMIT=256MiB`, `buildEnvironment()` inherits them); service.ts = relay channel (`relayUrl`) + host live API and remote adapters.
- [x] Frozen: `packages/artifacts/src/live-host` HostLedger and AcceptOptions types byte-identical to a5d8dee87.
- [x] perf/ci-tested-tree not integrated: binding checks 1, 4 and 5 not provable on its head 9062650db.

## Scope / Guardrails
- [x] Branch train/2026-11-07-alive-1c from origin/main c968b8d16; worktree tmp/worktrees/train1c; ENV=test-train1c.
- [x] Make only; no Python, attribution trailers, CI skips, reruns or CI polling; no local image build (API checks run in the existing node image).
- [x] Scoped local checks only; full suites run in the PR CI.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/artifacts/live/**`
  - `api/tests/unit/artifacts-live/**`
  - `apps/artifact-content/**`
  - `deploy/ci/artifact-content/**`
  - `packages/cluster-mesh/tests/heavy-phase-queue.spec.ts`
  - `scripts/ci/browser-shards.mjs`
  - `scripts/ci/ci-dag.test.mjs`
  - `scripts/ci/ci-expected-results.test.mjs`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `packages/artifacts/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed with declared exception)**:
  - `Makefile` under BR92-EX1.
  - `.github/workflows/ci.yml` under BR92-EX2.
  - `deploy/k8s/**` under BR90-EX13.
  - `packages/cluster-mesh/src/runtime/heavy-phase-queue.ts`, `packages/cluster-mesh/package.json`, `packages/cluster-mesh/CHANGELOG.md` under BR90-EX14.
  - `package-lock.json`, `api/package-lock.json` under BR90-EX15.
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/**` under BR90-EX16.

## Feedback Loop
- [x] BR92-EX1 (perf/ci10-e2e-critical, wagon ID kept, unused on main): Makefile computes API_VERSION, UI_VERSION and E2E_VERSION once per make run (unexported while parsing, frozen and exported at the end) instead of ~100 times under GNU Make 4.4; same tag values; `make down` accepts an optional DOWN_TIMEOUT. Impact: every CI make call loses its repeated hash parse; default `make down` unchanged. Rollback: revert the Makefile hunks.
- [x] BR92-EX2 (perf/ci10-e2e-critical): test-e2e and e2e-vscode download api/ui/e2e images in one exact brace-list step, load them in parallel and stop the disposable stack with DOWN_TIMEOUT=1; browser shards rebalanced on runs 42421623485 and 42408187255 (6 shards kept). ci-dag now rejects any non-exact download pattern and asserts both browser jobs consume each candidate. Impact: same jobs, needs, ci-gate members, receipts, provider guard and shutdown check; no permission change. Rollback: revert the workflow, browser-shards.mjs and the two scripts/ci tests together.
- [x] BR90-EX13 (feat/alive-supervisor-relay): base NetworkPolicy `allow-api-to-artifact-content` (artifact-content TCP 8791 from same-namespace `api` pods only, no namespaceSelector), its README note and the bundle/connectivity selftests. Rollback: delete the object, the note and the selftest cases.
- [x] BR90-EX14 (live env and W8 budget, s-archi): `PROVISIONAL_HEAVY_PHASE_COSTS_MIB.dev` 418 to 390 MiB and the documented d2-4 budget 1641 MiB with a 19 MiB pod base (install 980, pre-bundle 980, build 1344 unchanged; a build still requires 0 lives); `@sentropic/cluster-mesh` 0.26.0-dev.15 to 0.26.0-dev.16 with changelog (enforce-package-bump). Impact: four lives fit one d2-4 (1636 MiB), a pre-bundle fits beside one live only. Rollback: revert the cost, the tests and the bump together.
- [x] BR90-EX15: root and api lock workspace entries follow cluster-mesh 0.26.0-dev.16 (version string only). Rollback: revert with the bump.
- [x] BR90-EX16: the cluster-mesh selected packaging fixture names the dev.16 archive (no integrity pin on the cluster-mesh archive; artifacts and auth-hono pins unchanged). Rollback: revert with the bump.
- [x] `acknowledge`: W4 PORTS 6 now has its consumer: API `createRelaySupervisorChannel` → artifact-content `POST /_live-supervisor/v1/<pod>` (internal Service Host, Ed25519 frame and pod fence verified first) → `POST <pod>.<ns>.svc.cluster.local:5173/_supervisor/v1/frame` (same bytes, `SUPERVISOR_PATH` imported from the pod module); pod 200 → 200 bytes, 403 → empty 403, else 502.
- [x] `attention`: relay `Uint8Array<ArrayBuffer>` needed TypeScript 5.7+; the workspace compiler is 5.4.5, so `test-artifact-content` would have failed its tsc step; train fix types the reply as `Uint8Array`.
- [ ] `attention`: perf/ci-tested-tree (9062650db) not integrated. Check 4: several same-tree same-repository runs select the newest instead of a full run. Check 1: no bound tying the run to the tree's last change; rerun attempts only implicitly handled (job attempt identity). Check 5: the tested merge commit sha is not recorded (only the PR head sha). Its exception BR92-EX1 also collides with perf/ci10-e2e-critical.
- [ ] `attention`: not run locally (no local image build): API endpoint, smoke and queue suites; `make test-artifact-content` in the API image (its vitest, tsc and eslint ran in the node image); the PR CI covers them.
- [ ] `attention`: per-environment relay configuration (`ARTIFACT_SUPERVISOR_RELAY_URL`, `APP_ARTIFACT_SUPERVISOR_RELAY_ENABLED`, `APP_ARTIFACT_SUPERVISOR_PUBLIC_KEYS`, prod builder namespace) is not applied by the train; owner k8s/s-conductor.

## AI Flaky tests
- [x] No flaky allowance, timeout increase or new skip.

## Orchestration Mode (AI-selected)
- [ ] **Mono-branch + cherry-pick**
- [x] **Multi-branch**
- [x] Rationale: wagon branches built separately, integrated into one dated train with one version assignment, one PR and one CI.

## UAT Management (in orchestration context)
- [ ] Exact-head pull_request CI result retained in the PR.

## Plan / Todo (lot-based)
- [x] Lot 1: perf/ci10-e2e-critical (3346931ff) cherry-picked first without conflict; `test-ci-dag` 10/10, `test-ci-unit-graph` 7/7, `test-ci-expected-results` 28/28, `test-ci-static` 3/3, `test-ci-performance-report` 8/8, `test-ci-run-metrics` 36/36, browser-shards 6/6.
- [x] Lot 2: feat/alive-supervisor-relay (4c52da108) cherry-picked without conflict; relay type fix for TypeScript 5.4.
- [x] Lot 3: feat/alive-live-remote (4dc07739d) cherry-picked without conflict; service.ts composes the relay channel and the host live API.
- [x] Lot 4: live env (`MALLOC_ARENA_MAX`, `GOMEMLIMIT`) and W8 budget values; `make test-cluster-mesh SCOPE=tests/heavy-phase-queue.spec.ts` 7/7, `make typecheck-cluster-mesh`, `make test-cluster-mesh SCOPE=tests/packaging` 85 pass.
- [x] Lot 5: feat/alive-w9-rebind (2f2eb0f08) cherry-picked without conflict.
- [x] Lot 6: full API `tsc` clean, API `lint` 0 errors, artifacts-live 42 files 288/288, artifact-content vitest 10 files 167/167 with Postgres, artifact-content tsc and eslint clean, `make test-artifact-content-manifests` 163 PASS and 31/31.
- [ ] Lot 7: push, open the PR, GLM review of the full diff.
- [ ] Lot N: Final validation: exact-head CI green; remove BRANCH.md at merge.
