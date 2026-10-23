# fix(cluster-mesh): freeze common v1 module list (0.21.3)

## Objective
- [ ] Repair the published 0.21.2 common-v1 admission regression and qualify 0.21.3 through a draft corrective PR.
- [ ] Keep Immo #861 L7 export freeze and E2 E0 blocked until corrected published bytes and receipts exist.

## Scope / Guardrails
- [x] Follow approved E2 r3 P2-1 and its corrective-main fallback; #709 merged as b67e2a49af789f8f51d91cc5695f89caa63db2ee.
- [x] Base: origin/main e6d17327898a0118af123ff36ae508eefda80ddf; worktree: tmp/worktrees/cm-0213-fix.
- [x] Make-only; ENV=test-cm-0213 last; no Python; no service stack or reserved user ports.
- [x] Selective staging and make commit only; each commit below 150 changed lines; no attribution trailers.
- [x] Shared generic registry retains engram-memory; no authority/type migration or common descriptor/vector changes.
- [x] Push and open a DRAFT PR; do not merge or publish without the owner's GO.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/src/storage/common-contract.ts`
  - `packages/cluster-mesh/tests/storage/common-rule/contract.spec.ts`
  - `packages/cluster-mesh/tests/storage/scope-grant-modules.spec.ts`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
  - `packages/cluster-mesh/package.json`
  - `package-lock.json`
  - `scripts/ci/qualify-published-install.mjs`
  - `scripts/ci/qualify-published-install.test.mjs`
  - `scripts/ci/publishable-manifests.mjs`
  - `scripts/ci/publishable-manifests.test.mjs`
  - `scripts/ci/publishable-ci-wiring.test.mjs`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `plan/**`
  - `packages/cluster-mesh/src/storage/contracts.ts`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/ci.yml`
  - `packages/*/package.json` (peer ranges only if the bump gate requires them)
- **Exception process**:
  - [x] Declare BR0213-EXn with rationale, impact and rollback before conditional edits.

## Feedback Loop
- [x] CI bump repair: job 120542263109 passed package tests, installed Comments and PG upgrade, then failed ENOENT for the selected fixture's stale sentropic-cluster-mesh-0.21.2.tgz. Update only that fixture's candidate path/version to 0.21.3; preserve every registry peer and its integrity.
- [x] BR0213-EX1 — allow .github/workflows/ci.yml's Cluster Mesh post-publication wait budget only. Reason: npm processing took over three minutes on #709, exhausting 18 reads before availability. Impact: up to 36 fresh reads, ten seconds apart, for this publisher only; no publication/skip predicates change. Rollback: remove the explicit budget argument and its wiring test.
- [x] Affected publication: @sentropic/cluster-mesh@0.21.2, registry time 2026-10-23T14:44:35Z; correction reserved as 0.21.3.
- [x] [Failure evidence](https://github.com/rhanka/sentropic/actions/runs/39969215826/job/120474774878): npm accepted publication at 14:41:27Z with "being processed"; qualification exhausted 18 fresh reads at 14:44:23Z. Registry publication time is 14:44:35.992Z, about 12 seconds after failure (188 seconds after publish acceptance).
- [x] [Later-run evidence](https://github.com/rhanka/sentropic/actions/runs/39974392072/job/120485106662): cluster_mesh_publish=false, "Matching files: none"; its publish job 120493036670 skipped. The filter correctly requires packages/cluster-mesh/** changes; this run changed root/tooling/lock files.
- [x] Read-only requalification of registry 0.21.2 passes every runtime import and the SLSA source check against b67e2a49af789f8f51d91cc5695f89caa63db2ee; receipt retained at tmp/cm-0213-affected-registry. This confirms packaging/provenance availability, not common-v1 correctness.
- [x] Affected integrity: sha512-ZWBR6JqlCNsYWGQX1wnjfkNKQoiWcZi2ZaJt2zdjaLHP+aXf1lAZev//QPalp5CH+ehcSOyoSdZufPMNeQHQ+Q==.

## AI Flaky tests
- [x] No AI-dependent tests or timeout relaxation; no flaky acceptance requested.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, single release integrator; no cherry-picks or delegated implementation.
- [ ] Multi-branch (not applicable).

## UAT Management (in orchestration context)
- [x] No web, Chrome or VS Code surface changes; validate package contracts and clean consumers.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read rules, template, E2 r3 repair/fallback and review-opus-r3.md.
  - [x] Create requested worktree/branch from origin/main; harness check branch passes.
  - [x] Use existing scoped test, lint, typecheck, pack and qualification Make targets.
- [x] **Lot 1 — Freeze common v1 and bump patch**
  - [x] File-local frozen COMMON_V1_MODULE_IDS with comments and engram-live only.
  - [x] Extend tests/storage/common-rule/contract.spec.ts: both original modules accepted, memory rejected with exact existing error across all common surfaces.
  - [x] Add tests/storage/scope-grant-modules.spec.ts: Comments valid/invalid grants and exact errors, generic memory registration and read/write grants accepted.
  - [x] Bump package manifest and root workspace lock to 0.21.3; peer ranges only if required.
  - [x] Align the selected packed-consumer manifest/lock with the 0.21.3 candidate; preserve all peers and their integrities.
  - [x] Common regression fails before repair and passes afterward (10 common tests, 3 grant tests).
- [x] **Lot 2 — Registry qualification diagnosis and repair**
  - [x] Inspect run 39969215826 publish-cluster-mesh failure and run 39974392072 skip.
  - [x] Set Cluster Mesh's existing post-publication qualifier to 36 reads; regression accepts visibility on read 20 and refuses persistent absence at read 36. All 87 manifest/wiring tests pass.
  - [x] make test-publishable-manifests test-qualify-published-install ENV=test-cm-0213: 87 + 18 tests pass; registry 0.21.2 requalification passes without publishing.
- [ ] **Lot 3 — Docs consolidation and final validation**
  - [x] Record concrete qualification cause and evidence here; no additional product specification required.
  - [x] Local lint, typecheck and guarded pack pass. Full package tests, real PG recovery, installed Comments corpus and PG major-upgrade qualification pass in CI on 7aba104a7 (run 39990919502); two local full-suite attempts encountered 5-second SQLite timeouts, retained under root .tmp/cm-0213-full-tests*.log, without timeout changes.
  - [ ] Complete make -f packages/cluster-mesh/packaging.mk test-lazy-package ENV=test-cm-0213 and verify the refreshed fixture in current-head CI.
  - [ ] Run make scope-check ENV=test-cm-0213 before each commit and inspect every diff hunk.
  - [x] Push; create draft PR #729 with this file as body and post the bounded execution plan.
  - [ ] Verify current-head CI green; report PR, head SHA, CI URL and qualification cause.
  - [ ] Owner GO to merge/publish (deliberately pending; retain BRANCH.md).
