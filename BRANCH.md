# Feature: Cluster-mesh engram-memory registration and neutral binding

## Objective
- [ ] Deliver the co-signed memory module surface and exact installed compatibility evidence.

## Scope / Guardrails
- [x] Work in an isolated repo-local worktree for feat/cluster-mesh-engram-memory-g1.
- [x] Use Make-only container build/test commands; ENV=test-cm-engram-g1 is last.
- [ ] Preserve frozen memory DTOs/digests, Comments and engram-live behavior, and published migrations.
- [ ] Keep generic u64, result recovery, SQLite provider/SPI prerequisites and PG ownership in their named dependency branches.
- [ ] No runtime/type cluster-mesh dependency in Engram; the host explicitly injects its qualified SQLite provider.
- [ ] No E2, profile or S0 acceptance claim from source presence alone.

## Branch Scope Boundaries (MANDATORY)
- [ ] **Allowed Paths (implementation scope)**:
  - [ ] `packages/cluster-mesh/src/engram-memory/**`
  - [ ] `packages/cluster-mesh/tests/engram-memory/**`
  - [ ] `packages/cluster-mesh/assets/storage/engram-memory/**`
  - [ ] `packages/cluster-mesh/assets/storage/postgres/engram-memory/**`
  - [ ] `packages/cluster-mesh/assets/storage/sqlite/engram-memory/**`
  - [ ] `packages/cluster-mesh/src/storage/contracts.ts`
  - [ ] `packages/cluster-mesh/src/storage/authority.ts`
  - [ ] `packages/cluster-mesh/src/storage/postgres/protocol.ts`
  - [ ] `packages/cluster-mesh/src/storage/postgres/migrations.ts`
  - [ ] `packages/cluster-mesh/tests/storage/representation-contract.spec.ts`
  - [ ] `packages/cluster-mesh/tests/storage/authority-corpus.ts`
  - [ ] `packages/cluster-mesh/tests/storage/atomic-corpus.ts`
  - [ ] `packages/cluster-mesh/tests/storage/postgres-authority.spec.ts`
  - [ ] `packages/cluster-mesh/tests/storage/postgres-protocol.spec.ts`
  - [ ] `packages/cluster-mesh/tests/storage/postgres-module-migrations.spec.ts`
  - [ ] `packages/cluster-mesh/tests/storage/postgres-migrations.spec.ts`
  - [ ] `packages/cluster-mesh/tests/storage/postgres-registration.spec.ts`
  - [ ] `packages/cluster-mesh/tests/storage/postgres-queries.spec.ts`
  - [ ] `packages/cluster-mesh/tests/storage/postgres-module-policy.spec.ts`
  - [ ] `packages/cluster-mesh/package.json`
  - [ ] `package-lock.json`
  - [ ] `packages/cluster-mesh/README.md`
  - [ ] `spec/SPEC_EVOL_CLUSTER_MESH_MODULE_STORAGE.md`
  - [ ] `BRANCH.md`
- [ ] **Forbidden Paths (must not change in this branch)**:
  - [ ] `Makefile`
  - [ ] `docker-compose*.yml`
  - [ ] `.cursor/rules/**`
  - [ ] `api/**`
  - [ ] `ui/**`
  - [ ] `plan/NN-BRANCH_*.md`
  - [ ] `packages/cluster-mesh/assets/storage/postgres/**`
  - [ ] `packages/cluster-mesh/assets/storage/sqlite/**`
  - [ ] `packages/cluster-mesh/assets/storage/comments/**`
- [ ] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [ ] `.github/workflows/**`
  - [ ] `packages/cluster-mesh/src/storage/**`
  - [ ] `tools/memory-mcp-l5/**`
  - [ ] `.tmp/engram-mcp/**`
- [ ] **Exception process**:
  - [ ] Base scope declares no exception. Before any necessary extension, record a concrete numeric exception ID with exact paths, reason, impact and rollback in Feedback Loop under the applicable authorization.
  - [ ] Re-run mechanical scope checks; a declared exception does not override explicit forbidden paths.
  - [ ] The checker gives explicit allowed paths precedence over broader forbidden/conditional globs; only the new memory asset subtrees and listed shared files are admitted.
  - [ ] Engram checkouts remain read-only; published SQL bytes and L5 lock-coupling follow-up remain outside this implementation.

## Feedback Loop
- [x] Received the final-review-approved C2/C6 exact bytes/full manifest/digest mapping and C7 scope mapping; recorded producer identities and receipt locators.
- [x] `BR709-EX1` (conditional `tools/memory-mcp-l5/**`): regenerate the P1 pre-candidate manifest after the CI-required cluster-mesh 0.22.0 lock sync, following #704. Reason: `package-lock.json` SHA change breaks the `manifest freeze/lock mismatch` gate. Impact: new immutable history identity plus refreshed pre-candidate manifest/sidecar, old bytes retained. Rollback: restore the retained history bytes to the pre-candidate path. Authorization: CI-red packet 709 + plan P1 disposition rule.
- [ ] Track U/R/S/P dependencies, host-provider readiness and the S0 receipt; do not mark the existing S0 item accepted without its receipt.
- [ ] Track U/R/S/P dependencies, host-provider readiness and the S0 receipt; do not mark the existing S0 item accepted without its receipt.
- [ ] After Engram merge/tag/CI publication, verify its provenance and integrity separately from candidate contract delivery.
- [ ] Deliver the Sentropic qualified tuple before requesting Engram C9; record the separate Sentropic/L5 receiving ACK on that same tuple.
- [ ] Record P1 lockfile disposition before release; preserve immutable P1 bytes.

## AI Flaky tests
- [ ] Storage, digest and ownership cases are deterministic blocking gates; infrastructure absence is a failure, not an accepted skip.
- [ ] Flaky accepted (unrelated, non-systematic): `test-api-unit-integration (queue)` — `api/tests/queue/workflow-transition-runtime.test.ts` > recovers all_main joins when prerequisite tasks complete concurrently — `expected "addJob" to be called 2 times, but got 0 times`. Failed once in CI run 39355455847 (head abd7d57b3), passed on same-command rerun of the identical api tree. No `api/**` change in this branch. Owner sign-off still required before merge.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- [ ] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- Rationale: main G1 branch is the integration point and dependency branches (U/R/S/P/S0/Q) rebase normally; shared Track writes and integration remain with the designated conductor.

## UAT Management (in orchestration context)
- [ ] No UI surface is introduced; use installed host/runtime acceptance on the exact candidate SHA.
- [ ] Record host volume/image/database identities and evidence; no root dev test environment.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline, scope and contract reconciliation**
  - [x] Confirm isolated worktree, Make targets, test environment and named dependency branches.
  - [x] Receive/reconcile the approved C2/C6 packet and C7 mapping, including provider declarations, full manifest, limits and equivalence record.
  - [ ] Tests: `packages/cluster-mesh/tests/engram-memory/contract-vectors.spec.ts` and `packages/cluster-mesh/tests/engram-memory/binding-compatibility.spec.ts`.
  - [ ] Lot gate:
    - [ ] Actual parser extracts all intended path buckets, seven populated lots and zero exceptions; scope checker passes allowed examples and refuses forbidden, unapproved conditional and unknown examples.
    - [ ] Both producers agree exact candidate contract assets; strict installed-candidate declarations compile without sibling sources.
- [x] **Lot 1 — G1a descriptor, admission and public exports**
  - [x] Deliver contract, manifest, codecs, limits, module admission, semantic assets and explicit host SQLite provider option.
  - [x] Tests: `packages/cluster-mesh/tests/engram-memory/contract-vectors.spec.ts`, `packages/cluster-mesh/tests/engram-memory/registration.spec.ts`, `packages/cluster-mesh/tests/engram-memory/sqlite-driver-injection.spec.ts`.
  - [ ] Regression files: `packages/cluster-mesh/tests/storage/representation-contract.spec.ts`, `packages/cluster-mesh/tests/storage/postgres-protocol.spec.ts`, `packages/cluster-mesh/tests/storage/authority-corpus.ts`, `packages/cluster-mesh/tests/storage/postgres-authority.spec.ts`.
  - [ ] Lot gate:
    - [x] Exact digests and mutation vectors pass; public import activates nothing; missing driver/profiles and wrong module/scope refuse.
- [ ] **Lot 2 — G1b Postgres assets, queries and projection**
  - [ ] Deliver loader/schema role, append-only memory migration chain, five queries and transactional projection.
  - [ ] Tests: `packages/cluster-mesh/tests/engram-memory/postgres-registration.spec.ts`, `packages/cluster-mesh/tests/engram-memory/queries.spec.ts`, `packages/cluster-mesh/tests/engram-memory/projection.spec.ts`.
  - [ ] Regression files: `packages/cluster-mesh/tests/storage/postgres-module-migrations.spec.ts`, `packages/cluster-mesh/tests/storage/postgres-migrations.spec.ts`, `packages/cluster-mesh/tests/storage/postgres-registration.spec.ts`, `packages/cluster-mesh/tests/storage/postgres-queries.spec.ts`, `packages/cluster-mesh/tests/storage/postgres-module-policy.spec.ts`.
  - [ ] Lot gate:
    - [ ] Real host-history apply/verify, drift refusal, scoped queries, rollback and resync pass; no PG G3 claim inferred.
- [x] **Lot 3 — G1c memory first-proof enforcement**
  - [x] Preserve original K7/K8/P3 results across all admitted write lanes; permit only the specified K7 completion.
  - [x] Tests: `packages/cluster-mesh/tests/engram-memory/first-proof.spec.ts`, `packages/cluster-mesh/tests/engram-memory/completion.spec.ts`, `packages/cluster-mesh/tests/engram-memory/scope.spec.ts`.
  - [ ] Regression files: `packages/cluster-mesh/tests/storage/atomic-corpus.ts`, `packages/cluster-mesh/tests/storage/postgres-module-policy.spec.ts`.
  - [ ] Lot gate:
    - [ ] Completion/replay/destruction preserve first proofs, bypass attempts refuse, and Comments equal-digest replacement remains valid.
- [ ] **Lot 4 — G1d host-injected SQLite and neutral integration**
  - [ ] Integrate only after S0 and required S/U/R/backend ownership gates; wire the explicit host provider without changing the owner process isolation.
  - [ ] Tests: `packages/cluster-mesh/tests/engram-memory/sqlite-registration.spec.ts`, `packages/cluster-mesh/tests/engram-memory/sqlite-driver-injection.spec.ts`, `packages/cluster-mesh/tests/engram-memory/binding-compatibility.spec.ts`, `packages/cluster-mesh/tests/engram-memory/binding-errors.spec.ts`.
  - [ ] Lot gate:
    - [ ] Installed provider lifecycle, engine checks, typed refusals and sync/async bind pass; missing capabilities cannot select a fallback.
    - [ ] Final SQLite owner/provider tuple has affected S0 cases repeated and common memory corpus results.
- [ ] **Lot 5 — Documentation and tuple preparation**
  - [ ] Consolidate README/storage spec, public host assembly, limits and asset/digest inventories.
  - [ ] Lot gate:
    - [ ] Documentation distinguishes source increment, candidate archives, publication proof and qualified installed tuple; P1 disposition is recorded.
- [ ] **Lot 6 — Final validation and release handoff**
  - [ ] Consume Q evidence from `packages/cluster-mesh/tests/engram-memory/memory-corpus.ts`, `packages/cluster-mesh/tests/engram-memory/installed-memory.mjs`, `packages/cluster-mesh/tests/engram-memory/installed-memory-types.ts` and `packages/cluster-mesh/tests/engram-memory/qualification.mk`.
  - [ ] Lot gate:
    - [ ] Typecheck, affected storage/Comments regression suites, installed package/type/import closure and independent reviews pass; no missing-infrastructure skips.
    - [ ] Bump package/version and root lock together, run branch CI, and follow the template's PR/BRANCH.md lifecycle.
    - [ ] Verify Engram's post-merge CI/tag publication proof; publish cluster-mesh only through CI and freeze the exact qualified tuple.
    - [ ] Deliver that tuple, receive Engram C9 and Sentropic/L5 receiving ACK, then run required downstream L5/checkpoint gates.
