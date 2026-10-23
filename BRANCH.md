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
  - `packages/cluster-mesh/package.json`
  - `package-lock.json`
  - `scripts/ci/qualify-published-install.mjs`
  - `scripts/ci/qualify-published-install.test.mjs`
  - `scripts/ci/publishable-manifests.mjs`
  - `scripts/ci/publishable-manifests.test.mjs`
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
- [x] Affected publication: @sentropic/cluster-mesh@0.21.2, registry time 2026-10-23T14:44:35Z; correction reserved as 0.21.3.
- [ ] Establish publish qualification failure and later skip from run/job logs; fix a repository cause with a regression test.

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
- [ ] **Lot 1 — Freeze common v1 and bump patch**
  - [ ] File-local frozen COMMON_V1_MODULE_IDS with comments and engram-live only.
  - [ ] Extend tests/storage/common-rule/contract.spec.ts: both original modules accepted, memory rejected with exact existing error across all common surfaces.
  - [ ] Add tests/storage/scope-grant-modules.spec.ts: Comments valid/invalid grants and exact errors, generic memory registration and read/write grants accepted.
  - [ ] Bump package manifest and root workspace lock to 0.21.3; peer ranges only if required.
  - [ ] Scoped tests reproduce the defect before repair and pass after repair.
- [ ] **Lot 2 — Registry qualification diagnosis and repair**
  - [ ] Inspect run 39969215826 publish-cluster-mesh failure and run 39974392072 skip.
  - [ ] Apply smallest repository repair if needed; add deterministic regression coverage.
  - [ ] Run make test-qualify-published-install ENV=test-cm-0213 and verify published 0.21.2 without publishing.
- [ ] **Lot 3 — Docs consolidation and final validation**
  - [ ] Record concrete qualification cause and evidence here; no additional product specification required.
  - [ ] Run make lint-cluster-mesh typecheck-cluster-mesh test-cluster-mesh pack-cluster-mesh ENV=test-cm-0213.
  - [ ] Run make scope-check ENV=test-cm-0213 before each commit and inspect every diff hunk.
  - [ ] Push; create draft PR with this file as body and post the bounded execution plan.
  - [ ] Verify current-head CI green; report PR, head SHA, CI URL and qualification cause.
  - [ ] Owner GO to merge/publish (deliberately pending; retain BRANCH.md).
