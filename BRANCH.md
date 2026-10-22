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
  - [ ] `packages/cluster-mesh/tests/packaging/fixtures/**` (via BR709-EX6 only: selected-tuple tarball rename + lock refresh through the sanctioned make flow)
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
- [x] BR709-EX7 (fourth origin/main merge at 4138a0ecb, no rebase): retain this branch's Engram plan and all approved dispositions when resolving the sole BRANCH.md conflict with the completed governance plan from PR #711; inherit upstream governance artifacts and Go security hardening unchanged. No generated files or dependency locks changed; Engram 0.21.0 integrity remains sha512-CrHVxemS. Inherited upstream paths are outside the authored resolution diff. Rollback: revert this merge. Authorization: owner PR #709 integration instruction.
- [x] Received the final-review-approved C2/C6 exact bytes/full manifest/digest mapping and C7 scope mapping; recorded producer identities and receipt locators.
- [x] `BR709-EX1` (conditional `tools/memory-mcp-l5/**`): regenerate the P1 pre-candidate manifest after the CI-required cluster-mesh 0.22.0 lock sync, following #704 (superseded by BR709-EX6: 0.22.0 abandoned, now the 0.21.2 patch line). Reason: `package-lock.json` SHA change breaks the `manifest freeze/lock mismatch` gate. Impact: new immutable history identity plus refreshed pre-candidate manifest/sidecar, old bytes retained. Rollback: restore the retained history bytes to the pre-candidate path. Authorization: CI-red packet 709 + plan P1 disposition rule.
- [x] `BR709-EX2` (forbidden `Makefile`, one token on `CLUSTER_MESH_PEER_TOOLS` + `--install-strategy=shallow` in `tests/storage/cold-workspace.sh`): pin `@sentropic/engram@0.21.0` for the disposable test workspace so G1 specs import the published memory-substrate. Reason: cold-workspace resolves bare imports only from the peer-tools install; shallow keeps transitive dependents nested so an installed `@sentropic/*` (engram requires llm-mesh ^0.19.0) can never shadow a workspace symlink and break sibling builds. Impact: test-only, exact pin; no runtime, packaging or prod change (devDep excluded from the packed candidate). Rollback: remove the pin and flag and the G1 specs. Authorization: engram publication packet 709-engram-0210-muse (gr-conductor C9 path).
- [x] `BR709-EX3` (second `origin/main` merge at `6ec93105b`, no rebase): inherit upstream-only files unchanged (37 commits incl. #708 artifacts hardening + #712 canonical image). Both P1 parents retained in `history/` (`2d9cbca4...` + `9466d777...`); conflicted manifest/sidecar regenerated via `make memory-l5-pack` after the merge commit. Inherited paths exempt from the authored atomic diff budget. Rollback: revert this merge. Authorization: conductor note (PR #709 conflicting again after #712) + packet 709-update-main.
- [x] `BR709-EX4` (root `package.json` overrides): exact `@sentropic/engram@0.21.0` devDep (engram packet install) + scoped override `@sentropic/engram@0.21.0: officeparser 8.2.0` replacing the dead `officeparser@7.8.0: pdfjs-dist 6.4.299`, + lock-only `file-type 22.1.0` placement (top-level entry + remove nested `@tokenizer/inflate 0.5.1`; no `package.json` override — a stacked `officeparser@8.2.0` scope never chains in npm, verified by fresh-resolution probe yielding 22.2.0, so the dead entry was removed and the pin is owned as lock-only, guarded by `tests/engram-memory/dependency-pins.spec.ts`). Reason: engram 7.8.0's manifest metadata (`xmldom ^0.9.10`, `pdfjs 6.1.200`) trips the toolbox Trivy gate though installed bytes are clean (phantom, no PkgPath); 8.x is the only line declaring clean metadata (`xmldom ^0.9.12`, `pdfjs 6.2.108`, both Trivy-clean). The 8.2.0 pull hoisted `file-type 22.2.0`, whose fixed OOXML sniffing (docx not zip) breaks the pinned BUG-3 root-cause test `document-text-office-extension.test.ts:45`; `22.1.0` is the newest 22.x that still sniffs zip, satisfies api `^22.0.1` and officeparser `^22.1.0`, and is Trivy/audit-clean. G1 runtime never loads officeparser (memory-substrate/tests reference zero officeparser symbols; optional dep). Impact: the api-consumed root `file-type` moves 22.0.1 -> 22.1.0 (same zip behavior, BUG-3 green); api prod subtree (officeparser 6.0.7 + nested file-type 21.3.4) untouched. Rollback: restore the lock entries and `npm ci`. Authorization: engram publication packet 709-engram-0210 + conductor CI-green note.
- [x] `BR709-EX5` (forbidden `api/Dockerfile`, one digest token on the `ci-esbuild` stage): `golang:1.26.9-alpine3.23` -> `1.26.10-alpine3.23` (digest-pinned). Reason: new Trivy DB entry CVE-2026-111943 (Go crypto/x509 CA mitigation, HIGH) flags the 1.26.9 stdlib embedded in the rebuilt esbuild binaries (fixed: 1.26.10, 1.27.3; verified 1.26.10 image clean); unrelated to branch deps, affects any fresh toolbox build. Impact: build-time toolchain only; no runtime, packaging or prod change. Rollback: restore the 1.26.9 digest. Authorization: conductor CI-green note on run 39571121867.
- [x] Astra R1 (CHANGES) disposition, all with failing-then-passing regressions: P1 codec (`__proto__` own-property, sparse-array and terminal-lone-surrogate rejection), P1 Postgres (fail-closed factory + K7/K8 stateful enforcement via current-state resolver), P1 G1/S0 partial (live-read resolver + sequential validation against fresh stored state, real kernel round-trip, explicit G1a-c scope; R1 finding 3 REMAINS OPEN for the requested delivery pending the G1/S bridge — neutral handle, fences, receipts, durable profiles — plus the S0 volume campaign, none claimed), P2 file-type (dead stacked override removed, lock-only 22.1.0 pin guarded). Scope stays G1a-c source increment; no G1/S0 acceptance claimed.
- [x] Astra R2 (CHANGES) disposition: P2 admission-proof vector corrected to retain `decision:'accept'` so it distinguishes the defective codec (red-first verified by codec swap); R2-1 liveness hardened (cache removed, refusal reason proves live reread); queue wording replaced with evidenced race + Flow/Queue handoff. G1/S0 delivery still outstanding per above; not described as fixed.
- [x] Astra R3 (CHANGES) disposition: P2 transaction-boundary claim narrowed — the round-trip is sequential validation against fresh stored state with validation and effects co-located in one backend transaction per write (probe: pre-transaction validation alone permits replacement; co-located second completion refused with the completed-proof reason); no concurrent-writer serializability claimed. P1 G1/S0 remains open pending the G1/S bridge (neutral handle, fences, receipts, durable profiles) plus the S0 volume campaign; not described as fixed.
- [x] `BR709-EX6` (third `origin/main` merge at `50e612a0e` (#716 common storage rule + 0.21.1 patch line), no rebase): adopt patch-line version 0.21.2 — the merge-base carries 0.21.1 and this branch has `src/` changes, so `enforce-package-bump` requires a bump; 0.22.0 is abandoned because the frozen `@sentropic/comments@0.3.0` consumer accepts mesh `>=0.21.0 <0.22.0` (main BR01-EX1), and the `405af42ef` `<0.23.0` widening (which existed only to admit 0.22.0) is reverted to `<0.22.0`. Conflicted `packages/cluster-mesh/package.json` + the single root-lock mesh line set to 0.21.2; fixture selected tuple reference renamed 0.21.1→0.21.2 with the version bump (mechanical tarball rename, mirroring main `8e1ca97e7`), lock integrity refreshed to the 0.21.2 tarball through the sanctioned `make -f packages/cluster-mesh/packaging.mk refresh-lazy-package-lock` flow only; P1 manifest/sidecar regenerated via `make memory-l5-pack` with both parents retained in `history/` (`37a63a40...` + `de8bd772...`); upstream-only files (`storage/common-contract.ts`, common-rule tests, storage spec doc) inherited unchanged. Rollback: revert this merge. Authorization: conductor note (PR #709 conflicting again after #716) + packet 709-update-main.
- [ ] Track U/R/S/P dependencies, host-provider readiness and the S0 receipt; do not mark the existing S0 item accepted without its receipt.
- [ ] Track U/R/S/P dependencies, host-provider readiness and the S0 receipt; do not mark the existing S0 item accepted without its receipt.
- [ ] After Engram merge/tag/CI publication, verify its provenance and integrity separately from candidate contract delivery.
- [ ] Deliver the Sentropic qualified tuple before requesting Engram C9; record the separate Sentropic/L5 receiving ACK on that same tuple.
- [ ] Record P1 lockfile disposition before release; preserve immutable P1 bytes.

## AI Flaky tests
- [ ] Storage, digest and ownership cases are deterministic blocking gates; infrastructure absence is a failure, not an accepted skip.
- [ ] Queue race EVIDENCED, not accepted, no flake exemption: `test-api-unit-integration (queue)` — `api/tests/queue/workflow-transition-runtime.test.ts` > recovers all_main joins when prerequisite tasks complete concurrently — `expected "addJob" to be called 2 times, but got 0 times`. Failed once in CI run 39355455847 (head abd7d57b3), passed on same-command rerun. R2 deterministically reproduced the application race with a promise barrier (serial: 2 jobs/completed/2; race: 0 jobs/completed/2): a prerequisite `completed` result visible before its run-state patch lands lets the join path complete the noop join while `generation.initiatives` is absent (fanout skips silently), and the late patch finds the join already completed. No `api/**` change in this branch; fix belongs to Flow/Queue ownership (couple completion/state visibility or make downstream dispatch recoverable) with their deterministic barrier case. Owner sign-off still required before merge.

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
  - [x] Tests: `packages/cluster-mesh/tests/engram-memory/sqlite-registration.spec.ts`, `packages/cluster-mesh/tests/engram-memory/sqlite-driver-injection.spec.ts`, `packages/cluster-mesh/tests/engram-memory/binding-compatibility.spec.ts`, `packages/cluster-mesh/tests/engram-memory/binding-errors.spec.ts`.
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
