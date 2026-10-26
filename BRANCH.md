# Feature: Engram E6 PostgreSQL memory projection and resync

## Objective
- [ ] Complete #709 Lot 2 with durable memory projections, five scoped queries and transactional first-proof validation, following approved E6.

## Scope / Guardrails
- [x] Branch `feat/cluster-mesh-engram-e6`; worktree `tmp/worktrees/mem-e6`; draft base E0 `ad4164534`; merge only, integrate after E2.
- [x] Reuse #709 descriptor, validation and query definitions; Engram remains exactly 0.21.1.
- [x] Preserve E6 P2 `2b85ff28b6fe06bda0abcdc19255f61a1ed1e4b7cfbb40c2e881c98dd234424b`; owner authorized P2 to P3 re-freeze on 2026-10-26; no pin change in #768.
- [x] Make-only, zero Python, `ENV=test-e2-int` last; Docker shared lock and `make down` after each step.
- [x] Ports API 9030, UI 5230, Maildev 1130; qualification uses isolated Compose PostgreSQL without host ports.
- [x] Commit through `make commit`, below 150 changed lines; specific-file staging; no attribution trailers.
- [x] Keep public memory factory closed pending E3/E5/E7; no complete E2/backend qualification claim.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/src/engram-memory/postgres.ts`
  - `packages/cluster-mesh/src/engram-memory/postgres-queries.ts`
  - `packages/cluster-mesh/src/engram-memory/projection.ts`
  - `packages/cluster-mesh/assets/storage/postgres/engram-memory/**`
  - `packages/cluster-mesh/tests/engram-memory/**`
  - `packages/cluster-mesh/tests/storage/postgres-memory.spec.ts`
  - `packages/cluster-mesh/src/storage/postgres/migrations.ts`
  - `PLAN.md` (inherited E0 only)
  - `packages/cluster-mesh/src/engram-memory/neutral-contract.ts` (inherited E0 only)
  - `packages/cluster-mesh/assets/storage/engram-memory/C6-FREEZE.md` (inherited E0 only)
  - `packages/cluster-mesh/assets/storage/engram-memory/neutral-asset-inventory.json` (inherited E0 only)
  - `packages/cluster-mesh/assets/storage/engram-memory/neutral-equivalence.json` (inherited E0 only)
  - `Makefile` (inherited integration only; BR6-EX2)
  - `.github/workflows/ci.yml` (inherited integration only; BR6-EX2)
  - `.security/**` (inherited integration only; BR6-EX2)
  - `.tmp/live-stt/l1/verify.mk` (inherited integration only; BR6-EX2)
  - `.track/**` (inherited integration only; BR6-EX2; no authored events)
  - `api/**` (inherited integration only; BR6-EX2)
  - `docs/comments-annotations/contract/package-zod4-migration.json` (inherited #767 only)
  - `package.json` (inherited integration only; BR6-EX2)
  - `packages/**` (incoming integration changes only; E6 edits restricted to explicit paths above)
  - `scripts/ci/**` (inherited integration only; BR6-EX2)
  - `spec/SPEC_EVOL_LLM_MESH.md` (inherited integration only; BR6-EX2)
  - `tools/memory-mcp-l5/artifacts/**` (incoming history/snapshot only; restore current P2 manifest and sidecar unchanged)
  - `ui/package-lock.json` (inherited integration only; BR6-EX2)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.github/workflows/**`
  - `.cursor/rules/**`
  - `.track/**`
  - `packages/artifacts/**`
  - `tools/memory-mcp-l5/artifacts/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `packages/cluster-mesh/package.json`
  - `package-lock.json`
- **Exception process**:
  - [x] BR6-EX1: `packages/cluster-mesh/package.json` and `package-lock.json` unique pack-only 0.23.0-dev.5 version fields; never publish; rollback both fields together.
  - [x] BR6-EX2: owner-requested integration merge, preserving incoming tuple gateway 0.21.3 / cluster 0.22.4 / mesh 0.28.1 and #767 fixture tolerance. E6 retains its 0.23.0-dev.5 pack-only version above published 0.22.4; retain E6 BRANCH.md and P2 bytes. Inherited paths above admit only upstream changes, not new implementation. Rollback: revert the merge with first-parent selection.

## Feedback Loop
- [x] BR6-EX1 allows `packages/cluster-mesh/package.json` and `package-lock.json` version fields for the owner's unique dev.5 reservation; impact pack-only, rollback both fields together.
- [x] Shared `packages/cluster-mesh/src/storage/postgres/migrations.ts` has one integration writer: E2 (#765), owner of core `007-consumed-counters.sql`. E6 supplies memory hooks and `assets/storage/postgres/engram-memory/001-projections.sql`, sequenced after E2 as receipt 008; its independent module number remains 001.
- [ ] Conductor obtains the integrator's single-writer ACK before integration of E6; no ACK claimed here. Earlier coordination artifact: h2a 26836350-4047-4c6f-bb57-a6c105a7ba04.
- [x] Incoming #767 supplies the Comments package-migration and packaging-fixture tolerance repairs; previous exclusions are historical and are not new failure waivers.
- [x] K7 creation may share capture's append; the inherited zero-append guard applies to completion (revision 2), preserving the approved §5.2 distinction.
- [x] `postgres-memory.spec.ts` enrolls memory PG tests in the existing E2 real-PG lane; standalone memory lane lacks PG and is not the durable receipt.
- [x] Add adversarial same-unit duplicate event/proof tests; projection must refuse before publishing any canonical root.
- [x] Query tests cover exact unsigned cursor ordering through max u64 and current grant revocation on retained continuation.
- [x] First real PG pass: 6 pass/2 fail/0 skips; duplicate `event_id` accepted within one unit reproduced. Add per-unit identity set; correct fixture moduleResult to the existing EncodedValue wire type.
- [x] E2 qualification succeeded at `6ba0cb0d576c8fe454537202583aecded86613f5` (run 40353153064); E0/E1/E2 remain open PRs. E6 is drafted on E0 and depends on E2 landing before integration.
- [x] Declare E0 paths inherited in the diff against integration; E6 does not author or alter those freeze assets.
- [x] PG memory corpus PASS: 10/10, zero skips; regression PASS: 61 tests, with only two separate-phase `postgres-crashes.spec.ts` cases skipped. Typecheck PASS; build/lint/mechanical/wiring PASS with cleanup=0.
- [x] Resolve P1-1 by merging integration `d22fc3f2479eba5ff626f94c7cc249888a7d1f90`; retain both release metadata and E6 prerelease reservation. Integration/main P2 `f2b094ae034514727dfe2f4c9a89b3742e3d75beafc8f70e5074cd49d7f16642` is recorded as divergence, not adopted by this PR.
- [ ] P3 re-pin after #769 merges (conductor/integrator): target P3 `1c96bada...`; update `packages/cluster-mesh/assets/storage/engram-memory/C6-FREEZE.md`, `tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json` and `tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json.sha256`, then refresh the P2 reference in this `BRANCH.md`/PR body. Retained `tools/memory-mcp-l5/artifacts/history/2b85ff28b6fe06bda0abcdc19255f61a1ed1e4b7cfbb40c2e881c98dd234424b.json{,.sha256}` stays immutable history. No pin is changed here.
- [x] Retain local logs/checksums under `tmp/engram-e6-receipts/` and official lane receipts under `tmp/engram-e2-receipts/`.
- [x] Remaining local E2 lanes PASS with cleanup=0: memory 76 tests (the 10 PG cases execute separately in the real PG receipt), common 10, grants 3; no source edits after the passing code snapshot.
- [x] Skip inventory: mechanical/wiring/build/typecheck/lint have no conditional tests; common 10 and grants 3 have zero skips. Memory: 76 pass, 10 skip because `CM_PG_URL` is absent: `postgres-registration.spec.ts` (2: apply/verify/reopen, drift/missing-role), `projection.spec.ts` (4: completion/reopen, same-transaction rollback, receipt replay/conflict, duplicate event/proof), `queries.spec.ts` (4: five queries/resync, scope/history, u64/revocation, oversized/erased payload).
- [x] PostgreSQL lane: those same 10 E6 cases execute through `tests/storage/postgres-memory.spec.ts`, zero memory skips; 61 total passes in the retained local receipt. Only `tests/storage/postgres-crashes.spec.ts` skips its 2 cases, `seeds a partially prepared hidden unit before SIGKILL` and `reopens the recovered server and finishes from the saved prefix`: they require separate `CM_PG_CRASH_PHASE=seed/verify` runs around an actual server crash and are outside this campaign. No other test skip is waived.
- [x] Track containment: 346 pre-merge event IDs retained in 370 merged events (`track events-contains`); no manual log edit or concurrent Track write.
- [ ] Independent peer launch awaits owner authorization required by rules/subagents.md; no consensus review claimed.

## AI Flaky tests
- [x] No AI tests or flaky waiver applies.

## Orchestration Mode (AI-selected)
- [x] Mono-branch implementation; merge dependency histories, never rebase or cherry-pick.

## UAT Management (in orchestration context)
- [x] No web, Chrome or VS Code change; qualify durable PG behavior in the isolated worktree.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and scope**
  - [x] Read Docker lock, rules, approved E6 and #709 view/diff; mechanically check branch.
  - [x] Record successor scope and independent memory migration reservation.
- [x] **Lot 1 — Tests first**
  - [x] Author `tests/engram-memory/postgres-registration.spec.ts` and `pg-host.ts`: real apply/verify history, reopen, idempotence and drift refusal; RED queued under shared lock.
  - [x] Author `tests/engram-memory/queries.spec.ts`: all five queries, foreign scope, paging, retained boundaries and resync.
  - [x] Author `tests/engram-memory/projection.spec.ts`: live K7/K8, completion, P3 replay and rollback.
  - [x] Rerun existing `first-proof.spec.ts` (6 tests) and `completion.spec.ts` (7 tests).
- [x] **Lot 2 — Implementation**
  - [x] Author memory-only SQL assets and shared schema-role loader hooks; E2 does not edit migrations.ts; independent module chain avoids core numbering collision.
  - [x] Author transactional projection and backend-backed validation; reuse #709 transition functions; qualification pending.
  - [x] Author five root-bound memory queries and scope-chain-index enumeration; qualification pending.
- [ ] **Lot 3 — Final validation and draft handoff**
  - [x] Existing PG module-migration, migration, registration, query and policy regressions pass (61 PG tests including E6).
  - [x] Local build, typecheck, lint, mechanical/wiring, memory/common/grants and real PG lanes pass; #767 repairs are inherited for the new-head CI campaign.
  - [x] Scope-check before every commit; P2 unchanged and Engram exactly 0.21.1.
  - [x] Unique pack-only 0.23.0-dev.5 manifest/root-lock version commit; E2 registry baseline is 0.22.1; no peer or Engram change.
  - [x] Push draft PR #768 to `feat/engram-e2-integration`; no merge; independent memory migration 001 (receipt slot 008 after E2 core 007).
  - [ ] Retain CI URL, exact pushed head and green qualification after the integration merge; then tick Lot 3.
