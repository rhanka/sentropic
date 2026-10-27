# Feature: integrate memory lots E0–E4, E8, E9, PG, P3

## Objective
- [ ] Integrate the approved memory lots into one batch branch and qualify one exact head before conductor merge.

## Scope / Guardrails
- [x] Owner-directed batch: merge commits only, no rebase, no publication, conductor merges the draft PR.
- [x] Worktree `tmp/worktrees/mem-batch1`; branch `feat/engram-e2-batch1`; base `978fb67c0`.
- [x] Inherited from integration: E5/E6/E7 host bindings, #767 pack-only tolerance, #774 Comments gate and installed-consumer released-pin substitution.
- [x] Preserve each lot plan below; quoted scope belongs to that historical lot, while the batch scope below governs integration.
- [x] Shared Docker lock; no Docker before 21:00 UTC; isolated `ENV=test-mem-batch1` last; cleanup after qualification.
- [x] Ports reserved for this batch only: API 19681, UI 19682, Maildev UI 19683; no host ports published by qualification PG.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/**`
  - `package-lock.json`
  - `PLAN.md`
  - `tools/memory-mcp-l5/**`
  - `spec/evidence/memory-mcp-l5/l0-freeze.json` (inherited #792 P3 evidence)
  - `Makefile` (BR1-EX1: inherit approved #793 PG wiring and adapt existing qualification selectors to the owner-required isolated batch environment)
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.github/workflows/**`
  - `.cursor/rules/**`
  - `.track/**`
  - `api/**`
  - `ui/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `packages/engram/**` (not activated)
- **Exception process**:
  - [x] BR1-EX1: inherit #793 Makefile wiring, extend qualification environment selectors only as needed; impact limited to isolated test environment, rollback batch changes to those lines.

## Plan / Todo (lot-based)
- [ ] **Lot 1 — Ordered merges**
  - [ ] Merge #758, #763, #765, #775, #779, #764, #793, #792, #790; exclude content conflicts and record them.
  - [ ] Preserve P3 manifest and Engram 0.22.0 tarball hashes exactly.
  - [x] Adapt E9 recovery to awaited five-argument E7 API and test terminal, nonterminal and revoked authority behavior in memory-engine.spec.ts.
- [ ] **Lot 2 — Final qualification**
  - [ ] Final pack-only max+1 version; regenerate root lock through make after 21:00 UTC.
  - [ ] Run memory qualification targets once locally with cleanup; retain exact-head receipts.
- [ ] **Lot 3 — Handoff**
  - [ ] Push and create one draft PR listing lot PRs and approved review files.
  - [ ] Require pull_request ci.yml completed/success on exact head; append READY-BATCH only afterward.

## Feedback Loop
- [x] Owner authorization covers all listed approved lots and the E9 API adaptation.
- [ ] #758 approved review filename not found locally; conductor clarification pending.
- [ ] #793 review is included in pr792_opus_r1.md; dedicated approval filename pending clarification.

## AI Flaky tests
- [ ] Retry failed AI/e2e jobs once only when the same jobs are green on main; record evidence.

## Orchestration Mode (AI-selected)
- [x] Multi-branch integration; one batch CI run; no new delegated implementation.

## UAT Management (in orchestration context)
- [x] No web, Chrome or VS Code surface changes; validate memory contracts and PG behavior.

## Retained lot #758 plan

- [x] Inherited from lot #758 at `origin/feat/cluster-mesh-engram-e0`; its approved plan is preserved below.

> # Feature: Engram E0 C6 asset freeze
> 
> ## Objective
> - [ ] Freeze the neutral declaration surface and additive asset mapping against installed Engram 0.21.1, preserving semantic digest `sha256:dff737ced37d801ef48bb4d7088fc4fbc92021d21fe2034ff33ea643b49bec28`.
> 
> ## Scope / Guardrails
> - [x] Approved specification: root `.tmp/engram-e2-host-tuple/plan.md`, revision 3, E0 only; PostgreSQL first under E2-Q1.
> - [x] Branch `feat/cluster-mesh-engram-e0`; worktree `tmp/worktrees/mem-e0`; integration base `6c3f9f04a`; author codex / gpt-6.1-sol / high.
> - [x] Make only; `ENV=test-e2-int` last; no Python; no publication or merge.
> - [x] Serialize Docker/test steps with the shared lock; existing Compose targets only; `make down` after each step.
> - [x] Preserve P2 `2b85ff28b6fe06bda0abcdc19255f61a1ed1e4b7cfbb40c2e881c98dd234424b`; stop if an authored change alters it.
> - [x] Specific-file staging; `make commit` only, each below 150 changed lines, without attribution trailers.
> - [x] Owner assigns this topic's unique pack-only `0.23.0-dev.1`; final declaration packaging remains serially assigned to the integrator.
> 
> ## Branch Scope Boundaries (MANDATORY)
> - **Allowed Paths (implementation scope)**:
>   - `BRANCH.md`
>   - `PLAN.md`
>   - `packages/cluster-mesh/src/engram-memory/neutral-contract.ts`
>   - `packages/cluster-mesh/assets/storage/engram-memory/**`
>   - `packages/cluster-mesh/tests/engram-memory/contract-vectors.spec.ts`
>   - `packages/cluster-mesh/tests/engram-memory/binding-compatibility.spec.ts`
>   - `packages/cluster-mesh/tests/engram-memory/neutral-contract-types.ts`
>   - [x] Inherited from integration #767/#774 (fixture alignment and installed-comments pack-only dev gates): `packages/cluster-mesh/tests/fixtures/reserved-versions.ts`, `packages/cluster-mesh/tests/modules/registry.spec.ts`, `packages/cluster-mesh/tests/packaging/prepare-artifacts.spec.ts`, `packages/cluster-mesh/tests/storage/installed-bare.mjs`, `packages/cluster-mesh/tests/storage/pack-only-dev-gate.mjs`, `packages/cluster-mesh/tests/storage/pack-only-dev-gate.spec.ts`, `packages/cluster-mesh/tests/storage/postgres.mk`.
> - **Forbidden Paths (must not change in this branch)**:
>   - `Makefile`
>   - `docker-compose*.yml`
>   - `.github/workflows/**`
>   - `.cursor/rules/**`
>   - `.track/**`
>   - `packages/artifacts/**`
>   - `packages/cluster-mesh/src/storage/**`
>   - `tools/memory-mcp-l5/artifacts/**`
> - **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
>   - `packages/cluster-mesh/package.json`
>   - `package-lock.json`
> - **Exception process**:
>   - [x] Inherited from integration #789 at `978fb67c0`: E1/E2/E3/E5/E6/E7 PostgreSQL storage and host-memory implementation, migration assets, tests, qualification wiring and candidate manifest; E7 released-pin consumer substitution, last-receipt reattestation and frozen-pin packaging fetch. These are inherited bytes, not E0 edits. Keep the E0 plan; validate authored scope against the integration base. Rollback: revert this merge.
>   - [x] Integration version rule: max(E0 `0.23.0-dev.1`, integration `0.23.0-dev.9`) plus one dev increment is `0.23.0-dev.10`; update package manifest and root lock together. Regenerate through `make lock-root ENV=test-e2-int` after 21:00 UTC; no Docker before that time.
>   - [x] BR0-EX1 (owner-authorized): serial pack-only package.json/root lock bump to unique 0.23.0-dev.1; satisfies topic bump gate, never published; rollback both version fields together.
> 
> ## Feedback Loop
> - [x] Owner update closes common-rule/Immo E2-D1 and Comments ACK gate; retained ACK in root `.tmp/engram-e2-host-tuple/e0-entry-check-2026-10-26.md`.
> - [x] Integration-target bump probes retained; positive https://github.com/rhanka/sentropic/actions/runs/40314659239 at `e6a62bf52`: bump and E2 qualification job `121545389429` passed; publishers disabled.
> - [x] Entry gates satisfied by owner update plus actual fail/pass probe; add neutral effect, grant, descriptor and fence-proof data types from the installed declaration.
> - [x] Freeze transaction reads/effects, flat handle, grant-bound handle and sync/async binding, including optional original-result recovery.
> - [x] Close constructor-option declarations locally (scope, clock, deadline, work limits); inventory installed structural error codes and terminal fence failures.
> - [x] Reconcile the 0.21.0 handoff with exact 0.21.1 tarball/declaration hashes; add six additive mappings and complete surface inventory; preserve historical manifest/profile assets byte for byte.
> - [x] Installed constructor/full-handle type fixture and standalone declaration emission/strict compilation pass; sync/async typed fence refusals pass (binding suite 12/12).
> - [x] Contract vectors check additive identity/mapping, exact installed three-file declaration closure and unchanged semantic digest; local memory suite 76/76 across 11 files, zero skips/todos.
> - [x] Negative probe: https://github.com/rhanka/sentropic/actions/runs/40314176780 at `6ff00cfff`; enforce-package-bump job `121542495040` failed on unchanged cluster-mesh 0.22.2.
> - [x] Allocation: registry latest 0.22.1; 0.23.0 and 0.23.0-dev.1 return 404; no other E2 topic ref, 2026-10-26. 0.23.0-dev.1 exceeds registry/base and is reserved for E0 only.
> - [x] Register E0 dependencies, worktree/BRANCH and environment ownership in PLAN.md within this PR.
> - [x] Negative-probe source: initial C6 identity inventory only; package version unchanged from the actual integration base (0.22.2).
> - [x] Owner sanctions `test-e2-int`; E0 exclusively owns that Compose qualification project while holding the shared Docker lock; no host ports published.
> - [x] Integration fast-forwarded and pushed to main `6c3f9f04a`; no conflict or P2 change. #709 succession: E6 projection, E7 binding, E10 installed qualification; SQLite checkpoint 2026-10-30.
> - [x] Admission probe was limited to C6 identity metadata plus the required version bump; complete declarations/tests followed the positive admission receipt. P2 never changed.
> - [x] Local lint-cluster-mesh passed after memory 76/76; both steps use the locked E2 Compose route and cleanup.
> - [ ] Engram producer ACK remains pending conductor relay; Sentropic freeze reference `b588dccbc`. No joint producer agreement or C9/L5 acceptance is claimed.
> - [ ] Release-integrator handoff: admission run's broader validate-cluster-mesh fails registry Comments admission and selected fixture alignment on pack-only 0.23.0-dev.1 (jobs/121545389738); E2 qualification passes. Scope: integration-owned frozen Comments separation and selected installed tuple. Acceptance: full registry/packaging checks pass on the intended separate tuples without forced peers or widening. E0 does not alter those fixtures or claim installed acceptance.
> - [x] Admission run's API lint failed npm installation with ECONNRESET (jobs/121545388775); final push starts a fresh run. No API source changes are indicated by that log.
> 
> ## AI Flaky tests
> - [x] No AI tests or flaky waiver applies.
> 
> ## Orchestration Mode (AI-selected)
> - [x] Multi-branch: one E0 topic targets the integration branch; serial metadata writer; no delegated implementation.
> 
> ## UAT Management (in orchestration context)
> - [x] No web, Chrome or VS Code changes; qualify declaration and installed constructor compatibility.
> 
> ## Plan / Todo (lot-based)
> - [x] **Lot 0 — Entry gates**
>   - [x] Read Docker lock, rules, approved plan and P2 binding; mechanical branch check passes.
>   - [x] Verify #755 landing and ancestry; align existing clean E0 worktree with integration.
>   - [x] Close Feedback Loop admission blockers; refresh registry/version allocation and retain actual-base fail/pass probes.
> - [ ] **Lot 1 — E0 C6 asset freeze**
>   - [x] Reconcile installed 0.21.1 constructor/options, full handle/errors, u64 limits and five profiles against the handoff.
>   - [x] Add neutral-contract.ts and additive inventory/equivalence assets.
>   - [ ] Freeze name `engram-memory-neutral-contract`, version `1.0.0`, intended path `contracts/engram-memory-neutral-contract-v1.d.ts` with both producers.
>   - [x] Extend contract-vectors.spec.ts and binding-compatibility.spec.ts; add independently compilable neutral-contract-types.ts structural checks.
>   - [x] Preserve the exact semantic digest; final emitted bytes, runtime/profile equivalence and backend acceptance remain pending.
> - [ ] **Lot 2 — Docs consolidation and final validation**
>   - [x] Consolidate the Sentropic freeze and interim conductor reply in assets/storage/engram-memory/C6-FREEZE.md; ACK remains pending.
>   - [ ] Run permitted Compose build/typecheck/lint/scoped tests and current-head E2 qualification with receipts; scope-check before each commit.
>   - [ ] Push and open draft PR using this BRANCH.md; verify E2 qualification green without merging.
>   - [ ] Supply actual producer freeze reference and §6 interim reply through the conductor; request and retain identity acknowledgement.


## Retained lot #763 plan

- [x] Inherited from lot #763 at `origin/feat/cluster-mesh-engram-e1`; its approved plan is preserved below.

> # Feature: Engram E1 Additive exact u64 counters
> 
> ## Objective
> Additive exact u64 counters for generic storage, with opt-in consumed paths and u64 epoch ownership.
> 
> ## Scope / Guardrails
> - Approved specification: root `.tmp/engram-e2-host-tuple/plan.md`, revision 3, E1 row and referenced sections.
> - Branch `feat/cluster-mesh-engram-e1`; worktree `tmp/worktrees/mem-e1`; base `origin/feat/engram-e2-integration` plus `origin/feat/cluster-mesh-engram-e0` merge, no rebase.
> - Make-only; `ENV=test-e2-int` last; 0 Python; no publication or merge.
> - Serialize Docker/test steps with the shared lock; existing Compose targets only; `make down` after each step.
> - Preserve P2 `2b85ff28b6fe06bda0abcdc19255f61a1ed1e4b7cfbb40c2e881c98dd234424b`; stop if an authored change alters it.
> - Preserve repaired file-local common v1 allowlist in `common-contract.ts`; no PG migration; do not widen common-contract domain.
> - Keep old exports and signatures compatible.
> - Specific-file staging; `make commit` only, each below 150 changed lines, without attribution trailers.
> - Unique pack-only `0.23.0-dev.2`, next free N after E0.
> 
> ## Branch Scope Boundaries (MANDATORY)
> - **Allowed Paths (implementation scope)**:
>   - `BRANCH.md`
>   - `packages/cluster-mesh/src/storage/u64.ts`
>   - `packages/cluster-mesh/src/storage/contracts.ts`
>   - `packages/cluster-mesh/src/storage/atomic.ts`
>   - `packages/cluster-mesh/src/storage/backend.ts`
>   - `packages/cluster-mesh/src/storage/instance-ownership.ts`
>   - `packages/cluster-mesh/tests/storage/u64-corpus.ts`
>   - `packages/cluster-mesh/tests/storage/u64-contract.spec.ts`
>   - `packages/cluster-mesh/tests/storage/representation-contract.spec.ts`
>   - `packages/cluster-mesh/tests/storage/atomic-corpus.ts`
>   - `packages/cluster-mesh/tests/storage/chain-corpus.ts`
>   - `packages/cluster-mesh/tests/storage/read-corpus.ts`
>   - `packages/cluster-mesh/tests/storage/instance-ownership.spec.ts`
>   - `packages/cluster-mesh/tests/storage/common-rule/vectors.ts`
>   - `packages/cluster-mesh/tests/storage/common-rule/contract.spec.ts`
>   - `packages/cluster-mesh/tests/storage/scope-grant-modules.spec.ts`
>   - `packages/cluster-mesh/tests/comments-fragment-vectors.spec.ts`
>   - `PLAN.md` (inherited: E0 merge content, unauthored here)
>   - `packages/cluster-mesh/src/engram-memory/neutral-contract.ts` (inherited: E0 merge content, unauthored here)
>   - `packages/cluster-mesh/assets/storage/engram-memory/**` (inherited: E0 merge content, unauthored here)
>   - `packages/cluster-mesh/tests/engram-memory/contract-vectors.spec.ts` (inherited: E0 merge content, unauthored here)
>   - `packages/cluster-mesh/tests/engram-memory/binding-compatibility.spec.ts` (inherited: E0 merge content, unauthored here)
>   - `packages/cluster-mesh/tests/engram-memory/neutral-contract-types.ts` (inherited: E0 merge content, unauthored here)
> - **Forbidden Paths (must not change in this branch)**:
>   - `Makefile`
>   - `docker-compose*.yml`
>   - `.github/workflows/**`
>   - `.cursor/rules/**`
>   - `.track/**`
>   - `packages/artifacts/**`
>   - `packages/cluster-mesh/src/storage/common-contract.ts`
>   - `packages/cluster-mesh/src/storage/postgres/**`
>   - `packages/cluster-mesh/src/storage/sqlite/**`
>   - `packages/cluster-mesh/src/engram-memory/**`
>   - `packages/cluster-mesh/assets/**`
> - **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
>   - `packages/cluster-mesh/package.json`
>   - `package-lock.json`
> - **Exception process**:
>   - [x] BR1-EX1: pack-only package.json/root lock bump to unique `0.23.0-dev.2`; satisfies topic bump gate, never published; rollback both version fields together.
> 
> ## Feedback Loop
> - [x] E0 merged from `origin/feat/cluster-mesh-engram-e0` at `ad4164534`; integration base `6c3f9f04a`; P2 unchanged.
> - [x] Registry check 2026-10-26: mesh latest `0.22.1`; `0.23.0` reserved, `0.23.0-dev.1` taken by E0; `0.23.0-dev.2` is next free N for E1.
> - [x] Frozen guard: `isDecimalCounter` / `parseDecimalCounter` stay safe-integer only; generic `isStorageModuleId('engram-memory')` stays true while common v1 rejects that module.
> - [x] Counter guard: otherwise valid `terminal.count = '9007199254740992'` fails with exactly `terminal count must be a decimal counter`.
> - [x] Epoch domain: neutral `CanonicalInstanceOwnershipV1` keeps name/version/meaning/digest and error codes; internal epoch uses exact u64, public `storageEpoch` stays decimal string.
> - [x] `src/storage/common-contract.ts` untouched; no PG migration; no domain widening.
> - [x] Broader `test-cluster-mesh` shows 2 known pack-only failures on `0.23.0-dev.2` (same pair as E0 `dev.1`, job 121554531282): (a) `tests/packaging/prepare-artifacts.spec.ts` selected fixture pins `file:...-0.22.2.tgz` vs candidate `0.23.0-dev.2`; (b) `tests/modules/registry.spec.ts` comments leaf resolves `incompatible_version` on `@sentropic/cluster-mesh` instead of `not_installed` on `@sentropic/comments` (a dev version never satisfies the Comments 0.3.0 range `>=0.21.0 <0.22.0`; no silent widening). Both are outside this branch scope (plan L7 selected-fixture hotspot + Comments disposition, integrator-owned). `validate-cluster-mesh` therefore stops at the test step; skipped downstream for that CI head: installed MCP contracts, Build, Pack, sibling packs, installed-comments PG, PG major-upgrade, packed lazy gate, candidate install. Local evidence instead: `build-cluster-mesh` green, `pack-cluster-mesh` green (`0.23.0-dev.2` mode=block sha256=3c433eec3dfd6618798c6c42efba8e2696af71297d6c259bd783928f589ef40f); lazy install gate attempted but blocked by fixture-pinned `@sentropic/llm-gateway@0.21.1` missing from the registry (latest `0.21.0`), same pre-existing fixture staleness, untouched. E2 `qualify-engram-e2` is green and is the gate.
> - [x] Lock lesson: `engram-e2-qualify` self-locks per lane; never wrap it in an outer shared-lock call (self-deadlock); run it bare with `ENV=test-e2-int` last.
> - [x] Scope lesson: PR diff vs integration includes the E0 merge until PR #758 lands; E0-originated paths above are declared inherited/unauthored. After E0 lands, merge the integration base and drop those lines.
> - [x] Draft PR #763 targeting `feat/engram-e2-integration` is open; E2 qualification green on the previous head.
> - [ ] Merge order (P2-6): #763 stays unmerged until #758 lands; then merge the integration base and drop the inherited-path lines.
> 
> ## AI Flaky tests
> - [x] No AI tests or flaky waiver applies.
> 
> ## Orchestration Mode (AI-selected)
> - [x] Mono-branch: one E1 topic targets the integration branch; no delegated implementation.
> 
> ## UAT Management (in orchestration context)
> - [x] No web, Chrome or VS Code changes; qualify storage counters and ownership.
> 
> ## Plan / Todo (lot-based)
> - [x] **Lot 0 — Baseline and branch setup**
>   - [x] Read Docker lock, rules, approved plan, E0 entry check and P2 binding.
>   - [x] Create worktree `tmp/worktrees/mem-e1` on integration base; merge E0 without rebase.
>   - [x] Write BRANCH.md from template; reserve pack-only `0.23.0-dev.2`.
> - [x] **Lot 1 — Tests first**
>   - [x] Add `tests/storage/u64-corpus.ts` and `u64-contract.spec.ts`.
>   - [x] Extend `representation-contract.spec.ts`, `atomic-corpus.ts`, `chain-corpus.ts`, `read-corpus.ts`, `instance-ownership.spec.ts`.
>   - [x] Extend `common-rule/vectors.ts` and `contract.spec.ts` with above-safe terminal vector and exact error.
>   - [x] Extend `comments-fragment-vectors.spec.ts` for original counter domain and encoded bytes.
>   - [x] Keep `scope-grant-modules.spec.ts` green: memory registration and read/write grant accepted.
> - [x] **Lot 2 — Implementation**
>   - [x] Add `src/storage/u64.ts` validator, codec and types.
>   - [x] Add opt-in consumed counter/version and atomic comparison/allocation paths in `contracts.ts`, `atomic.ts`, `backend.ts`.
>   - [x] Extend `instance-ownership.ts` epoch to exact u64; keep public shape and contract identity.
>   - [x] Preserve `common-contract.ts` v1 allowlist; no PG migration; no domain widening.
> - [ ] **Lot 3 — Final validation**
>   - [x] `make scope-check` before each commit; commits under 150 lines via `make commit`.
>   - [x] Scoped suites green: u64 (8), ownership (9+3 skip), representation (5), common-rule (11), grants (3), comments-fragment (4); build, typecheck, lint green.
>   - [x] E2 lanes green locally: mechanical (CI-equivalent vars), wiring, memory (76), common, grants, postgres (51+2 skip).
>   - [x] Opus r1 P2 fixes: corpus vectors driven from `u64-contract.spec.ts`; u64 aggregate/guard/version validators covered; `common-rule/vectors.ts` extended; strict fragment counter assertion; failure description corrected.
>   - [x] Build/pack/install evidence: `build-cluster-mesh` green, `pack-cluster-mesh` green (`0.23.0-dev.2` mode=block); lazy install gate blocked by pre-existing fixture peer `llm-gateway@0.21.1` 404 (out of scope).
>   - [ ] Push new commits and verify E2 qualification green on PR #763 without merging (merges only after #758).


## Retained lot #765 plan

- [x] Inherited from lot #765 at `origin/feat/cluster-mesh-engram-e2`; its approved plan is preserved below.

> # Feature: Engram E2 PostgreSQL u64 persistence
> 
> ## Objective
> Persist exact u64 counters on PostgreSQL: counter codec, effects, journal/roots/readers paths and a new versioned migration for consumed counters/versions. Semantic counters travel separately from bounded page sizes and physical map-node IDs. Published SQL stays byte-identical.
> 
> ## Scope / Guardrails
> - Approved specification: root `.tmp/engram-e2-host-tuple/plan.md`, revision 3, E2 row and referenced sections.
> - Branch `feat/cluster-mesh-engram-e2`; worktree `tmp/worktrees/mem-e2`; base `origin/feat/cluster-mesh-engram-e1`, no rebase.
> - Make-only; `ENV=test-e2-int` last; 0 Python; no publication or merge.
> - Serialize Docker/test steps with the shared lock; existing Compose targets only; `make down` after each step.
> - Preserve P2 `2b85ff28b6fe06bda0abcdc19255f61a1ed1e4b7cfbb40c2e881c98dd234424b`; stop if an authored change alters it.
> - Preserve frozen common contracts and legacy safe numeric inputs; owner-authorized r1 PG journal/consumer/snapshot outputs carry exact decimal strings.
> - Specific-file staging; `make commit` only, each below 150 changed lines, without attribution trailers.
> - Unique pack-only `0.23.0-dev.3`, next free N after E1.
> - Published 001-006 and comments SQL stay byte-identical (checksums pinned in tests); only `007` is new.
> 
> ## Branch Scope Boundaries (MANDATORY)
> - **Allowed Paths (implementation scope)**:
>   - `BRANCH.md`
>   - `packages/cluster-mesh/src/storage/atomic.ts` (additive `U64AtomicUnit` + `validateU64AtomicUnit` only)
>   - `packages/cluster-mesh/src/storage/postgres/codec.ts`
>   - `packages/cluster-mesh/src/storage/postgres/effects.ts`
>   - `packages/cluster-mesh/src/storage/postgres/journal.ts`
>   - `packages/cluster-mesh/src/storage/postgres/snapshots.ts`
>   - `packages/cluster-mesh/src/storage/postgres/scope.ts` (journal counter inputs only)
>   - `packages/cluster-mesh/src/storage/postgres/roots.ts`
>   - `packages/cluster-mesh/src/storage/postgres/readers.ts`
>   - `packages/cluster-mesh/src/storage/postgres/core.ts` (fence/provision epoch only)
>   - `packages/cluster-mesh/src/storage/postgres/queries.ts` (boundary version/sequence only)
>   - `packages/cluster-mesh/src/storage/postgres/ordinary-transactions.ts` (u64 unit acceptance only)
>   - `packages/cluster-mesh/assets/storage/postgres/007-consumed-counters.sql`
>   - `packages/cluster-mesh/assets/storage/postgres/manifest.json` (`007` entry only)
>   - `packages/cluster-mesh/tests/storage/generate-pg-manifest.mjs` (`007` file entry only)
>   - `packages/cluster-mesh/tests/storage/postgres-u64.spec.ts`
>   - `packages/cluster-mesh/tests/storage/postgres-u64-migration.spec.ts`
>   - `packages/cluster-mesh/tests/storage/postgres-corpus.spec.ts` (bounded legacy corpus adapter only)
>   - `packages/cluster-mesh/tests/storage/postgres-replay.spec.ts` (exact counter assertions only)
>   - `packages/cluster-mesh/tests/storage/postgres-crashes.spec.ts` (exact watermark assertion only)
>   - `packages/cluster-mesh/tests/storage/postgres-module-migrations.spec.ts` (007 occupies order 7; hypothetical future asset moves 007→008)
>   - `packages/cluster-mesh/tests/storage/postgres-reattest.spec.ts` (007 shifts last-receipt ordinal 6→7)
>   - `PLAN.md` (inherited: E0 merge content, unauthored here)
>   - `packages/cluster-mesh/src/engram-memory/neutral-contract.ts` (inherited: E0 merge content, unauthored here)
>   - `packages/cluster-mesh/assets/storage/engram-memory/**` (inherited: E0 merge content, unauthored here)
>   - `packages/cluster-mesh/src/storage/u64.ts` (inherited: E1 content, unauthored here)
>   - `packages/cluster-mesh/src/storage/contracts.ts` (inherited: E1 content, unauthored here)
>   - `packages/cluster-mesh/src/storage/backend.ts` (inherited: E1 content, unauthored here)
>   - `packages/cluster-mesh/src/storage/instance-ownership.ts` (inherited: E1 content, unauthored here)
>   - `packages/cluster-mesh/tests/engram-memory/**` (inherited: E0 merge content, unauthored here)
>   - `packages/cluster-mesh/tests/comments-fragment-vectors.spec.ts` (inherited: E1 content, unauthored here)
>   - `packages/cluster-mesh/tests/storage/u64-corpus.ts` (inherited: E1 content, unauthored here)
>   - `packages/cluster-mesh/tests/storage/u64-contract.spec.ts` (inherited: E1 content, unauthored here)
>   - `packages/cluster-mesh/tests/storage/representation-contract.spec.ts` (inherited: E1 content, unauthored here)
>   - `packages/cluster-mesh/tests/storage/atomic-corpus.ts` (inherited: E1 content, unauthored here)
>   - `packages/cluster-mesh/tests/storage/chain-corpus.ts` (inherited: E1 content, unauthored here)
>   - `packages/cluster-mesh/tests/storage/read-corpus.ts` (inherited: E1 content, unauthored here)
>   - `packages/cluster-mesh/tests/storage/common-rule/vectors.ts` (inherited: E1 content, unauthored here)
>   - `packages/cluster-mesh/tests/storage/common-rule/contract.spec.ts` (inherited: E1 content, unauthored here)
>   - `packages/cluster-mesh/tests/storage/instance-ownership.spec.ts` (inherited: E1 content, unauthored here)
> - **Forbidden Paths (must not change in this branch)**:
>   - `Makefile`
>   - `docker-compose*.yml`
>   - `.github/workflows/**`
>   - `.cursor/rules/**`
>   - `.track/**`
>   - `packages/artifacts/**`
>   - `packages/cluster-mesh/src/storage/u64.ts`
>   - `packages/cluster-mesh/src/storage/contracts.ts`
>   - `packages/cluster-mesh/src/storage/backend.ts`
>   - `packages/cluster-mesh/src/storage/instance-ownership.ts`
>   - `packages/cluster-mesh/src/storage/common-contract.ts`
>   - `packages/cluster-mesh/assets/storage/postgres/001-core.sql`
>   - `packages/cluster-mesh/assets/storage/postgres/002-map.sql`
>   - `packages/cluster-mesh/assets/storage/postgres/003-staged.sql`
>   - `packages/cluster-mesh/assets/storage/postgres/004-queries.sql`
>   - `packages/cluster-mesh/assets/storage/postgres/005-cleanup.sql`
>   - `packages/cluster-mesh/assets/storage/postgres/006-staged-coverage.sql`
>   - `packages/cluster-mesh/assets/storage/postgres/comments/**`
>   - `packages/cluster-mesh/src/storage/postgres/preparation.ts`
>   - `packages/cluster-mesh/src/storage/postgres/units.ts`
>   - `packages/cluster-mesh/src/engram-memory/**`
>   - `packages/cluster-mesh/assets/storage/engram-memory/**`
> - **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
>   - `packages/cluster-mesh/package.json`
>   - `package-lock.json`
> - **Exception process**:
>   - [x] BR2-EX2: owner-authorized PR765 r1 fixes include PostgreSQL snapshots, scope cursor signatures and directly affected PG tests; exact journal positions must cover full u64. Impact: PG counter strings; rollback: revert r1 commits together.
>   - [x] BR2-EX1: pack-only package.json/root lock bump to unique `0.23.0-dev.3`; satisfies topic bump gate, never published; rollback both version fields together.
> 
> ## Feedback Loop
> - [x] PR765 r1 P1-2: PG atomic gate requires unique non-empty string result IDs for legacy and u64 units; missing and malformed IDs refuse before effects.
> - [x] P1-2 negative fixture rows retain array identity (including duplicates) and include negative/unsafe numeric IDs; legacy and u64 gate paths both tested.
> - [x] Base `origin/feat/cluster-mesh-engram-e1` at `2b741f557`; P2 unchanged (`2b85ff28...`).
> - [x] Registry check 2026-10-26: mesh latest `0.22.1`; `0.23.0` reserved, `dev.1`/`dev.2` taken; `0.23.0-dev.3` is next free N.
> - [x] Inventory: exact-u64 = scopes.version/sequence, fences.epoch, journal.sequence/positions/segments, consumer cursor/scanned/failedSeq/lag, snapshot watermarks, boundaries.version/sequence, chain allocation strings, aggregate versions/guards. Bounded Numbers = chain seq/count/positions, page sizes/limits/budgets, snapshot page ordinals, staged counts, work limits. Physical bigint IDs = map node/root IDs, boundary root, record offsets, schema ordinals.
> - [x] PR765 r1 P1-1: journal positions, consumer progress and snapshot watermarks use decimal strings and BigInt arithmetic through max u64; legacy safe numeric inputs remain accepted.
> - [x] Frozen numeric replay corpus stays unchanged; its PG-only test adapter checks safe fixture positions while production delivers exact strings.
> - [x] PR765 r1 P1-1 regression: journal reads, poison/retry, checkpoint CAS, lag and retained snapshot completion/reopen tested at 2^53, 2^63 and max u64; unsafe numeric input refused.
> - [x] PR765 r1 P2: real memory K3/K5/K8 compound keys pass memory effects validation, updates/guards/stale refusals through signed-64 crossing and max u64; post-publish hook failure rolls back root, record and journal at crossing/max with reopen and retry.
> - [x] Post-publish rollback witness queries the same transaction and observes both updated scope counters and the inserted journal tail before injecting failure.
> - [x] PR765 r1 P2 upgrade: populated 006 scopes/journal/fences/boundaries above 2^53 and at signed max survive 007, reopen, journal read and publication; all six counter columns reject negative and above-u64 writes.
> - [x] 006 numeric JSON consumer positions normalize to exact decimal strings after upgrade without changing delivery/checkpoint behavior.
> - [x] First real PG run: 75 passed, six new fixture setup refusals (empty descriptor chainKinds; comments grant on memory module). Fixed the descriptor and matching memory grant; upgrade, invalid indexes and post-publish rollback passed. Cleanup exit=0; rerun required.
> - [x] R1 focused verification on source head `5eeb20d32`: `make engram-e2-lane E2_LANE=postgres API_PORT=9010 UI_PORT=5210 MAILDEV_UI_PORT=1110 ENV=test-e2-int` under the shared Docker lock: 81 passed, two dedicated crash-mode tests skipped; postgres-u64 25/25 and migration 5/5. Typecheck passed; both lane receipts record exit=0 and cleanup=0 in tmp/engram-e2-receipts.
> - [x] R1 source push completed; full qualification remains assigned to queued CI (run 40400619477 on `5eeb20d32`). Removed the redundant local full-qualification waiter before any lane started; no orphan stack or lock holder.
> - [ ] Rerun validate-cluster-mesh: requested after push, GitHub returned 403 because run 40388446346 is already queued/active; retry once it leaves that state. New-head CI also pending, no green CI claim.
> - [x] Commit-options fences stay safe-only (`validateCommitOptions` frozen); u64 epochs flow through `provisionFence`/`fence` direct paths.
> - [x] PR765 r1 P2-3 handoff to E4 (canonical PG acquisition) / E5 (neutral binding): widen commit-options epoch validation and replace strict representation comparisons in postgres/staged.ts, units.ts and seals.ts with exact u64 value comparisons. Acceptance: fenced ordinary/staged commits accept equal canonical epochs at 2^53, 2^63 and max u64, refuse stale epochs, and preserve frozen common behavior. Verification: real PG ownership/staged tests plus common-rule corpus. E2 regression explicitly proves current commitAtomic refusal before persistence; no E4/E5 implementation here.
> - [ ] Push draft PR targeting `feat/engram-e2-integration`; E2 qualification green; no merge.
> - [x] 007 consequence: the two specs pinning migration-chain ordinals move with the new version (module hypothetical 007→008, reattest last receipt 6→7); no behavior change.
> - [x] Scope lesson (stacked PRs): the PR diff vs integration includes the E0 merge and E1 until #758/#763 land; E0/E1-originated paths above are declared inherited/unauthored. After they land, merge the integration base and drop those lines.
> 
> ## AI Flaky tests
> - [x] No AI tests or flaky waiver applies.
> 
> ## Orchestration Mode (AI-selected)
> - [x] Mono-branch: one E2 topic on the E1 branch; no delegated implementation.
> 
> ## UAT Management (in orchestration context)
> - [x] No web, Chrome or VS Code changes; qualify PG counters, migration, reopen and rollback.
> 
> ## Plan / Todo (lot-based)
> - [x] **Lot 0 — Baseline and branch setup**
>   - [x] Read Docker lock, approved plan E2 row, C5 binding and K3/K5/K8 version rule.
>   - [x] Trace impact across codec, journal, roots, readers, effects, core, queries, migrations.
>   - [x] Create worktree `tmp/worktrees/mem-e2` on E1 base; verify P2 unchanged.
>   - [x] Write BRANCH.md from template; reserve pack-only `0.23.0-dev.3`.
> - [x] **Lot 1 — Tests first**
>   - [x] Add `tests/storage/postgres-u64.spec.ts` (codec, crossing, max, exhaustion, reopen, rollback, conversion refusals).
>   - [x] Add `tests/storage/postgres-u64-migration.spec.ts` (chain, idempotence, legacy compat, checksums, schema shape).
> - [x] **Lot 2 — Implementation**
>   - [x] Add `decodePgCounterU64` to `postgres/codec.ts`; keep legacy decoders frozen.
>   - [x] Add `007-consumed-counters.sql` (numeric widening + u64 CHECKs); regenerate manifest; published SQL untouched.
>   - [x] Move journal/roots/core/queries counters to `::numeric` bindings and u64 decodes; refuse at u64 exhaustion.
>   - [x] Accept u64 aggregate versions/guards in PG effects (`U64AtomicUnit`, `validateU64AtomicUnit`); persist versions as given.
>   - [x] Validate allocation comparison in readers (corruption on malformed).
> - [ ] **Lot 3 — Final validation**
>   - [x] `make scope-check` before each commit; commits under 150 lines via `make commit`.
>   - [ ] Run build, typecheck, lint, memory, common, grants and real PG lanes with `ENV=test-e2-int` last.
>   - [ ] Push and open draft PR targeting `feat/engram-e2-integration`; verify E2 qualification green without merging.


## Retained lot #775 plan

- [x] Inherited from lot #775 at `origin/feat/cluster-mesh-engram-e3`; its approved plan is preserved below.

> # Feature: Engram E3 original-result recovery
> 
> ## Objective
> - [ ] Recover the immutable stored moduleResult after a lost commit acknowledgement through scoped PostgreSQL lookup and a neutral memory bridge.
> 
> ## Scope / Guardrails
> - Approved specification: root `.tmp/engram-e2-host-tuple/plan.md`, revision 3, E3 row and referenced sections.
> - Branch `feat/cluster-mesh-engram-e3`; worktree `tmp/worktrees/mem-e3`; base E2 `75076d43e`, merge never rebase.
> - Make-only; `ENV=test-e2-int` last; 0 Python; no publication or merge.
> - Serialize Docker/test steps with the shared lock; existing Compose targets only; `make down` after each step.
> - Preserve P2 `2b85ff28b6fe06bda0abcdc19255f61a1ed1e4b7cfbb40c2e881c98dd234424b`; stop if an authored change alters it.
> - Keep old exports/signatures compatible; legacy safe-integer paths keep frozen behavior.
> - Specific-file staging; `make commit` only, each below 150 changed lines, without attribution trailers.
> - Unique pack-only `0.23.0-dev.6`; Engram stays exactly `0.21.1`.
> - Published SQL stays byte-identical; `007` is inherited from E2. No E3 migration or receipt table.
> 
> ## Branch Scope Boundaries (MANDATORY)
> - **Allowed Paths (implementation scope)**:
>   - `BRANCH.md`
>   - `packages/cluster-mesh/src/storage/postgres/scope.ts`
>   - `packages/cluster-mesh/src/storage/postgres/commit-results.ts`
>   - `packages/cluster-mesh/src/engram-memory/commit-result-recovery.ts`
>   - `packages/cluster-mesh/src/engram-memory/contract.ts`
>   - `packages/cluster-mesh/tests/storage/postgres-result-recovery.spec.ts`
>   - `packages/cluster-mesh/tests/storage/commit-result-corpus.ts`
>   - `packages/cluster-mesh/tests/storage/commit-result-process.ts`
>   - `packages/cluster-mesh/tests/fixtures/reserved-versions.ts` (inherited shared CI fix #767)
>   - `packages/cluster-mesh/tests/modules/registry.spec.ts` (inherited shared CI fix #767)
>   - `packages/cluster-mesh/tests/packaging/prepare-artifacts.spec.ts` (inherited shared CI fix #767)
>   - `packages/cluster-mesh/src/storage/atomic.ts` (additive `U64AtomicUnit` + `validateU64AtomicUnit` only)
>   - `packages/cluster-mesh/src/storage/postgres/codec.ts`
>   - `packages/cluster-mesh/src/storage/postgres/effects.ts`
>   - `packages/cluster-mesh/src/storage/postgres/journal.ts`
>   - `packages/cluster-mesh/src/storage/postgres/roots.ts`
>   - `packages/cluster-mesh/src/storage/postgres/readers.ts`
>   - `packages/cluster-mesh/src/storage/postgres/core.ts` (fence/provision epoch only)
>   - `packages/cluster-mesh/src/storage/postgres/queries.ts` (boundary version/sequence only)
>   - `packages/cluster-mesh/src/storage/postgres/ordinary-transactions.ts` (u64 unit acceptance only)
>   - `packages/cluster-mesh/assets/storage/postgres/007-consumed-counters.sql`
>   - `packages/cluster-mesh/assets/storage/postgres/manifest.json` (`007` entry only)
>   - `packages/cluster-mesh/tests/storage/generate-pg-manifest.mjs` (`007` file entry only)
>   - `packages/cluster-mesh/tests/storage/postgres-u64.spec.ts`
>   - `packages/cluster-mesh/tests/storage/postgres-u64-migration.spec.ts`
>   - `packages/cluster-mesh/tests/storage/postgres-module-migrations.spec.ts` (007 occupies order 7; hypothetical future asset moves 007→008)
>   - `packages/cluster-mesh/tests/storage/postgres-reattest.spec.ts` (007 shifts last-receipt ordinal 6→7)
>   - `PLAN.md` (inherited: E0 merge content, unauthored here)
>   - `packages/cluster-mesh/src/engram-memory/neutral-contract.ts` (inherited: E0 merge content, unauthored here)
>   - `packages/cluster-mesh/assets/storage/engram-memory/**` (inherited: E0 merge content, unauthored here)
>   - `packages/cluster-mesh/src/storage/u64.ts` (inherited: E1 content, unauthored here)
>   - `packages/cluster-mesh/src/storage/contracts.ts` (inherited: E1 content, unauthored here)
>   - `packages/cluster-mesh/src/storage/backend.ts` (inherited: E1 content, unauthored here)
>   - `packages/cluster-mesh/src/storage/instance-ownership.ts` (inherited: E1 content, unauthored here)
>   - `packages/cluster-mesh/tests/engram-memory/**` (inherited: E0 merge content, unauthored here)
>   - `packages/cluster-mesh/tests/comments-fragment-vectors.spec.ts` (inherited: E1 content, unauthored here)
>   - `packages/cluster-mesh/tests/storage/u64-corpus.ts` (inherited: E1 content, unauthored here)
>   - `packages/cluster-mesh/tests/storage/u64-contract.spec.ts` (inherited: E1 content, unauthored here)
>   - `packages/cluster-mesh/tests/storage/representation-contract.spec.ts` (inherited: E1 content, unauthored here)
>   - `packages/cluster-mesh/tests/storage/atomic-corpus.ts` (inherited: E1 content, unauthored here)
>   - `packages/cluster-mesh/tests/storage/chain-corpus.ts` (inherited: E1 content, unauthored here)
>   - `packages/cluster-mesh/tests/storage/read-corpus.ts` (inherited: E1 content, unauthored here)
>   - `packages/cluster-mesh/tests/storage/common-rule/vectors.ts` (inherited: E1 content, unauthored here)
>   - `packages/cluster-mesh/tests/storage/common-rule/contract.spec.ts` (inherited: E1 content, unauthored here)
>   - `packages/cluster-mesh/tests/storage/instance-ownership.spec.ts` (inherited: E1 content, unauthored here)
> - **Forbidden Paths (must not change in this branch)**:
>   - `Makefile`
>   - `docker-compose*.yml`
>   - `.github/workflows/**`
>   - `.cursor/rules/**`
>   - `.track/**`
>   - `packages/artifacts/**`
>   - `tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json`
>   - `packages/cluster-mesh/tests/packaging/fixtures/**`
>   - `packages/cluster-mesh/src/storage/u64.ts`
>   - `packages/cluster-mesh/src/storage/contracts.ts`
>   - `packages/cluster-mesh/src/storage/backend.ts`
>   - `packages/cluster-mesh/src/storage/instance-ownership.ts`
>   - `packages/cluster-mesh/src/storage/common-contract.ts`
>   - `packages/cluster-mesh/assets/storage/postgres/001-core.sql`
>   - `packages/cluster-mesh/assets/storage/postgres/002-map.sql`
>   - `packages/cluster-mesh/assets/storage/postgres/003-staged.sql`
>   - `packages/cluster-mesh/assets/storage/postgres/004-queries.sql`
>   - `packages/cluster-mesh/assets/storage/postgres/005-cleanup.sql`
>   - `packages/cluster-mesh/assets/storage/postgres/006-staged-coverage.sql`
>   - `packages/cluster-mesh/assets/storage/postgres/comments/**`
>   - `packages/cluster-mesh/src/storage/postgres/snapshots.ts`
>   - `packages/cluster-mesh/src/storage/postgres/preparation.ts`
>   - `packages/cluster-mesh/src/storage/postgres/units.ts`
>   - `packages/cluster-mesh/assets/storage/engram-memory/**`
> - **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
>   - `packages/cluster-mesh/package.json`
>   - `package-lock.json`
> - **Exception process**:
>   - [x] BR3-EX1: authorized pack-only package.json/root lock bump to `0.23.0-dev.6`; no publication; rollback both fields together.
> 
> ## Feedback Loop
> - [x] E2 #765 is in review at `75076d43e`; E3 owns recovery hooks next; E5 follows E3/E4 serially.
> - [x] Source manifest baseline is inherited `f2b094ae034514727dfe2f4c9a89b3742e3d75beafc8f70e5074cd49d7f16642`; no P2/P3 re-pin or manifest edit is authorized here.
> - [x] Known comments-installed `incompatible_version` on development bumps is explicitly out of scope.
> - [x] CI head `978b99770`: E2 qualification green; full package tests found dev-version registry/fixture assertions. Reuse shared #767 by serial atomic merges, retaining its original commit identities and frozen fixture bytes; Comments installed compatibility stays out of scope.
> - [x] Shared #767 merge 1/4: inherit `49abeb593` dev-pin assertions; E3 implementation and pack version remain unchanged.
> - [x] Shared #767 merge 2/4: inherit `66258e171` explicit pack-only dev predicate and its tests.
> - [x] Shared #767 merge 3/4: inherit `52747b5b0` bounded version helper and synthetic proofs; final stable-candidate proof follows separately to keep this merge under 150 lines.
> - [x] Restore the exact remaining stable-candidate proof from `52747b5b0`; the inherited test file is now byte-identical to that commit.
> - [x] Shared #767 merge 4/4: inherit `0cc3b1bf8` reserved-next Comments refusal proof. All three shared test files now match #767 exactly; frozen fixture and manifest bytes remain unchanged.
> - [x] The inherited E0/E1/E2 paths above describe stacked PR ancestry only; authored E3 changes are restricted to recovery files and pack metadata.
> - [ ] Push draft PR to `feat/engram-e2-integration`; get E2 qualification green; do not merge.
> 
> ## AI Flaky tests
> - [x] No AI tests or flaky waiver applies.
> 
> ## Orchestration Mode (AI-selected)
> - [x] Multi-branch: one E3 topic on E2, integrated by merge only; no delegated implementation.
> 
> ## UAT Management (in orchestration context)
> - [x] No web, Chrome or VS Code changes; qualify durable recovery and authority through storage tests.
> 
> ## Plan / Todo (lot-based)
> - [x] **Lot 0 — Baseline and branch setup**
>   - [x] Read Docker lock, mandatory rules, approved E3 plan and neutral recovery contract.
>   - [x] Create `tmp/worktrees/mem-e3` on E2 and pass mechanical harness branch check.
>   - [x] Use existing Compose qualification targets with shared Docker lock and cleanup after each step; ENV last.
> - [x] **Lot 1 — Tests first**
>   - [x] Add `tests/storage/commit-result-corpus.ts`: exact opaque result/time/epoch, absence, copy isolation, conflicting intent.
>   - [x] Add `tests/storage/postgres-result-recovery.spec.ts`: lost ACK, process restart, new epoch, current grant/fence, foreign scopes, transient failure.
>   - [x] Add `tests/storage/commit-result-process.ts` for independent writer crash and recovery.
>   - [x] Focused red run: missing `commit-result-recovery.js` before implementation (2026-10-26).
> - [ ] **Lot 2 — Implementation**
>   - [x] Add scoped lookup over existing immutable commit receipts; reuse stored moduleResult exclusively.
>   - [x] Add and export neutral recovery bridge with required current fence provider; keep memory factory closed until E7.
>   - [x] Preserve frozen manifests, SQL, neutral contract and Engram version; pack-only mesh bump is `0.23.0-dev.6`.
>   - [x] Crash injection targets the transaction returning a receipt, after the idempotency preflight; expired fences refuse reads.
>   - [x] Test grant expiry during the storage wait; revalidation must refuse the stored result.
> - [ ] **Lot 3 — Final validation**
>   - [x] Focused PostgreSQL recovery: 5 tests passed, zero skips; includes independent post-COMMIT SIGKILL/restart.
>   - [x] Typecheck identified generic base64 versus frozen memory UTF-8 boundary; bridge now refuses base64 without decoding or resampling.
>   - [x] Rerun focused recovery and typecheck after UTF-8 correction: 5 PG tests, zero skips; source/test typechecks and lint pass.
>   - [ ] `make scope-check` before each commit; commits under 150 lines via `make commit`.
>   - [ ] Run build, typecheck, lint, memory, common, grants and real PG lanes with `ENV=test-e2-int` last.
>   - [ ] Push and open draft PR targeting `feat/engram-e2-integration`; verify E2 qualification green without merging.


## Retained lot #779 plan

- [x] Inherited from lot #779 at `origin/feat/cluster-mesh-engram-e4`; its approved plan is preserved below.

> # Branch: feat/cluster-mesh-engram-e4 — Canonical PostgreSQL acquisition (lot E4)
> 
> ## Objective
> 
> Implement the EXISTING `CanonicalInstanceOwnershipV1` durably in PostgreSQL:
> new `src/storage/postgres/instance-*.ts` backed by additive core migration
> `008-instance-ownership`, reusing `CANONICAL_INSTANCE_OWNERSHIP_CONTRACT`
> name/version/meaning/digest, `CanonicalInstanceHandle` and
> `CanonicalOwnershipError` codes (no second PG ownership contract, no
> artifacts-coordinator reuse). G-P0a/G-P0b retained session, durable u64 epoch,
> journal/scope↔store identity, installed guard assets/catalog checks.
> E2 = #765 core 007; E4 reserves core **008** (recorded below).
> 
> ## Scope / Guardrails
> 
> - MUST reuse `CANONICAL_INSTANCE_OWNERSHIP_CONTRACT` name/version/meaning/digest, handles and `CanonicalOwnershipError` codes from `src/storage/instance-ownership.ts` (frozen file, import only).
> - NO second PostgreSQL ownership contract. NO artifacts-coordinator reuse.
> - Engram stays `0.21.1`; P2/P2+P3 manifests unchanged; stop if an authored change alters them.
> - Additive SQL only, chained `requires` on `007-consumed-counters@1`; `generate-pg-manifest.mjs` + `manifest.json` stay in sync (checksums pinned by specs).
> - Existing SQLite tests pass; the shared corpus keeps registry semantics identical.
> - Tests first; `ENV=test-e2-int` as the last make argument; `make commit MSG="type: …"` (<150 lines, `git add` specific files, no AI trailers). Never `ENV=dev`. 0 Python.
> 
> ## Branch Scope Boundaries (MANDATORY)
> 
> - **Allowed Paths (implementation scope)**:
>   - `BRANCH.md`
>   - `packages/cluster-mesh/src/storage/postgres/instance-ownership.ts` (new)
>   - `packages/cluster-mesh/src/storage/postgres/instance-guard.ts` (new)
>   - `packages/cluster-mesh/assets/storage/postgres/008-instance-ownership.sql` (new)
>   - `packages/cluster-mesh/assets/storage/postgres/manifest.json` (008 entry only)
>   - `packages/cluster-mesh/tests/storage/generate-pg-manifest.mjs` (008 file entry only)
>   - `packages/cluster-mesh/tests/storage/instance-corpus.ts` (new shared corpus)
>   - `packages/cluster-mesh/tests/storage/instance-ownership.spec.ts` (corpus reuse only, same outcomes)
>   - `packages/cluster-mesh/tests/storage/postgres-instance-ownership.spec.ts` (new)
>   - `packages/cluster-mesh/tests/storage/postgres-instance-guard.spec.ts` (new)
>   - `packages/cluster-mesh/tests/storage/postgres-module-migrations.spec.ts` (hypothetical 008→009 only)
>   - `packages/cluster-mesh/tests/storage/postgres-reattest.spec.ts` (last ordinal 7→8 only)
>   - `packages/cluster-mesh/tests/storage/postgres-u64-migration.spec.ts` (length 7→8 + 008 block only)
>   - `packages/cluster-mesh/tests/storage/postgres-manifest.spec.ts` (reverted to E2: opt-in leaves existing kernels unchanged)
>   - `packages/cluster-mesh/tests/storage/postgres-publication.spec.ts` (reverted to E2: same reason)
>   - `packages/cluster-mesh/tests/storage/postgres-corpus.spec.ts` (reverted to E2: same reason)
>   - `packages/cluster-mesh/tests/storage/postgres-lifecycle.spec.ts` (reverted to E2: same reason)
>   - `packages/cluster-mesh/src/storage/postgres/core.ts` (open wiring only: opt-in lease acquire in the open tx, per-kernel driver wrapper install, conditional G-P0b hook; no transaction rewiring)
>   - `packages/cluster-mesh/src/storage/postgres/protocol.ts` (`canonicalOwnership` opt-in option only; memory kernel only)
>   - `packages/cluster-mesh/src/storage/postgres/index.ts` (expose kernel ownership only)
>   - `packages/cluster-mesh/src/storage/postgres/errors.ts` (CanonicalOwnershipError passthrough in classifyPgFailure only)
>   - `packages/cluster-mesh/tests/storage/postgres-instance-multiprocess.spec.ts` (new: two OS processes, crash then takeover after lease expiry)
>   - `packages/cluster-mesh/tests/storage/pg-open-child.mjs` (new: child opener helper for the multiprocess spec)
>   - `packages/cluster-mesh/package.json` + `package-lock.json` (pack-only 0.23.0-dev.7 only)
> - **Forbidden Paths (must not change in this branch)**:
>   - `Makefile`
>   - `docker-compose*.yml`
>   - `api/**`
>   - `ui/**`
>   - `apps/**`
>   - `packages/engram/**` (stays 0.21.1)
>   - `packages/cluster-mesh/src/storage/instance-ownership.ts` (frozen, reuse only)
>   - `packages/cluster-mesh/src/storage/sqlite/**`
>   - `packages/cluster-mesh/src/storage/postgres/ordinary-transactions.ts` (G-P1 wiring belongs to E5)
>   - Any second ownership contract or artifacts-coordinator reuse.
> - **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
>   - None. Downstream coordination (integration order of #765 vs this PR) is recorded in the PR body, not exercised here.
> - **Exception process**:
>   - Declare `BRCM-E4-EXn` with reason, impact and rollback before any scope expansion.
>   - [x] `BRCM-E4-EX0`: reserved core migration number **008** (`008-instance-ownership`), next free after E2's 007 (`#765`). Impact: one additive asset + manifest entry chained on 007; rollback: drop the file and the manifest entry. No renumbering.
> 
> ## Plan / Todo (lot-based)
> 
> - [x] Lot E4-0 — setup: this BRANCH.md; harness branch check; pack-only `0.23.0-dev.7` (`package.json` + lock); record core 008 reservation (EX0 above).
> - [x] Lot E4-1 — tests first (red): `instance-corpus.ts` shared registry semantics; parameterize `instance-ownership.spec.ts` (same outcomes); new `postgres-instance-ownership.spec.ts` (two processes/copies, same principal, aliases, different store_id for one journal, exactly one live holder, prompt refusal, release/reacquire, exact u64 epoch advance, terminal loss); new `postgres-instance-guard.spec.ts` (G-P0a open, G-P0b commit guard, journal/scope↔store identity, installed asset/catalog checks, contract digest + error codes unchanged).
> - [x] Lot E4-2 — 008 migration + manifest sync: `008-instance-ownership.sql` (ownership table, exact u64 epoch, additive only); `manifest.json` 008 entry; generator entry; pinned-spec updates (module hypothetical→009, reattest ordinal→8, u64 length→8 + 008 block).
> - [x] Lot E4-3 — implementation (green): `instance-ownership.ts` (durable acquire/verify/release/mark-terminal/current, exact u64, `CanonicalOwnershipError` codes); `instance-guard.ts` (G-P0a retained-session open, G-P0b commit decision guard); wire open path only (no transaction rewiring — E5).
> - [ ] Lot E4-4 — gates: full `test-cluster-mesh SCOPE=tests/storage` green on `ENV=test-e2-int`; scope-check; `make commit` per file group (<150 lines); push; draft PR to `feat/engram-e2-integration`; CI green; no merge.
> 
> ## Feedback Loop
> 
> - Blocker: if E2's #765 lands on the integration branch with a different 008 occupant, stop and coordinate (requires-chain conflict) — do not renumber.
> - Resync R1: merged `origin/feat/cluster-mesh-engram-e2` at `09cff1f8b` (merge commit `41071d16d`); 007 checksum re-derived from E2 (`545e6f92…`); 008 stays chained after it.
> - R1 redesign (Opus r1 CHANGES): opt-in `canonicalOwnership` (intended for the memory kernel; composition owns the allow-list; Comments/M2 behavior unchanged, no 008 requirement); lease-based retained session (`holder_until`) with prompt `instance-busy` refusal (no supersede, no queue); in-commit-tx guard via per-kernel driver wrapper + AsyncLocalStorage session (no second tx, no pool deadlock); renewal piggyback on RW txs; deferred lease trigger in 008 as installed final backstop + catalog verification (`tgenabled='O'` born, `'A'` accepted; binding; deferral).
> - R2 fixes (Opus r2 CHANGES): open-time catalog refusal is `open-refused` (registry/SQLite parity; the catalog check runs before installation attestation so a missing/tampered catalog never surfaces as schema drift); COMMIT-time serialization races map to `instance-busy` at the opt-in open boundary; the two-OS-process spec opens real opt-in kernels through the same `.js→.ts` loader as the SQLite spec (plus `--experimental-transform-types`); corpus verdicts come from production (durable-row newness, real commit guard, DELETE+INSERT setup — the backstop rejects any UPDATE committing a dead lease).
> - Code mapping (neutral-contract parity, corpus-passing): superseded/released/unknown holder → `stale-epoch`; explicit terminal or expired-unclaimed lease → `terminal-loss`; live second opener → `instance-busy`; open-time refusal → `open-refused`; PG surfaces `CanonicalOwnershipError` unwrapped (passthrough in `classifyPgFailure`).
> - No deferred "final event" table: the guard's renewal UPDATE inside the commit tx is the in-tx enforcement (row-match atomicity, no TOCTOU); the deferred trigger re-checks liveness at COMMIT. No flush-code changes (E5 owns transactions).
> - Watch: `postgres-module-migrations.spec.ts` hypothetical must track the real latest core (009 while this branch owns 008).
> - Qualification limits (lease semantics): the holder renews only on read-write transactions (default TTL 5 min); a read-only or idle holder past TTL may be taken over and then reads as `stale-epoch`/`terminal-loss`. The deferred trigger rejects any UPDATE committing a dead lease, including test setup — seed/terminate rows via DELETE+INSERT, never UPDATE.
> - Qualification limits (replica mode): 008 creates a plain constraint trigger, born `tgenabled='O'` — skipped under `session_replication_role=replica`, so the backstop only guards the primary. E4 is single-primary by design (no replicas; writes never go to a standby), and the in-tx renewal UPDATE stays the primary guard. Pinned by `pg ownership catalog enablement` mock tests (`'O'`/`'A'` accept, `'D'`/`'R'`/missing refuse as `open-refused`). Requiring `'A'` (`ENABLE ALWAYS`) would change the 008 checksum — decided against; revisit if replicas ever enter scope.
> - AI CI job red-on-main is out of scope for this lot's gate (E4 gate = cluster-mesh lanes green).
> 
> ## Gate receipts (r3, head `d8132b821` + r3 commits)
> 
> All commands run as `flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make <target> ... ENV=test-e2-int` (`ENV` last, never `ENV=dev`):
> - `make test-cluster-mesh SCOPE=tests/storage CM_PG_URL=postgresql://app:app@postgres:5432/app ENV=test-e2-int` → Test Files 75 passed | 1 skipped (76); Tests 470 passed | 2 skipped (472). Includes `postgres-instance-multiprocess.spec.ts` 2/2 (real kernels, deterministic expiry injection, no sleeps), `postgres-instance-guard.spec.ts` 15/15 (incl. 5 `pg ownership catalog enablement` mock rows), `postgres-instance-ownership.spec.ts` 15/15, shared corpus neutral + PG green.
> - `make typecheck-cluster-mesh ENV=test-e2-int` → exit 0, no TS errors.
> - `make lint-cluster-mesh ENV=test-e2-int` → exit 0, clean (covers the new `tests/storage/pg-open-child.mjs`).
> - `make scope-check ENV=test-e2-int` → PASS C2 before every commit.
> - CI on the pushed head: PR #779 draft → `feat/engram-e2-integration`, do not merge.


## Retained lot #764 plan

- [x] Inherited from lot #764 at `origin/feat/cluster-mesh-engram-e8`; its approved plan is preserved below.

> # Feature: Engram E8 authoritative candidate scope liaison
> 
> ## Objective
> - [ ] Exercise the frozen Engram 0.21.1 candidate-to-invocation/store/scope liaison outside sealed bytes; C7 acceptance remains `unverified` pending E7 integration evidence.
> 
> ## Scope / Guardrails
> - [x] Approved root `.tmp/engram-e2-host-tuple/plan.md`, revision 3, E8 only; base E0 `ad4164534`.
> - [x] Branch `feat/cluster-mesh-engram-e8`; worktree `tmp/worktrees/mem-e8`; merge only, no rebase.
> - [x] Make only; `ENV=test-e2-int` last; no Python, publication, merge, or Engram re-pin.
> - [x] Preserve frozen 0.21.1 DTOs and P2 `2b85ff28b6fe06bda0abcdc19255f61a1ed1e4b7cfbb40c2e881c98dd234424b`; stop on a changed P2.
> - [x] Shared Docker lock for builds/tests/containers; sanctioned Compose targets; cleanup after each step.
> - [x] No service ports published; reserve API 9040, UI 5240, mail 1140 if needed.
> - [x] Specific-file staging; `make commit` only; each commit below 150 changed lines; no attribution trailers.
> 
> ## Branch Scope Boundaries (MANDATORY)
> - **Allowed Paths (implementation scope)**:
>   - `BRANCH.md`
>   - `packages/cluster-mesh/tests/engram-memory/host-scope-binding.ts`
>   - `packages/cluster-mesh/tests/engram-memory/scope.spec.ts`
>   - `packages/cluster-mesh/tests/engram-memory/candidate-scope.spec.ts`
>   - `packages/cluster-mesh/src/engram-memory/host-scope-binding.ts`
>   - `packages/cluster-mesh/package.json`
>   - `package-lock.json`
>   - `PLAN.md`
>   - `packages/cluster-mesh/assets/storage/engram-memory/C6-FREEZE.md`
>   - `packages/cluster-mesh/assets/storage/engram-memory/neutral-asset-inventory.json`
>   - `packages/cluster-mesh/assets/storage/engram-memory/neutral-equivalence.json`
>   - `packages/cluster-mesh/src/engram-memory/neutral-contract.ts`
>   - `packages/cluster-mesh/tests/engram-memory/binding-compatibility.spec.ts`
>   - `packages/cluster-mesh/tests/engram-memory/contract-vectors.spec.ts`
>   - `packages/cluster-mesh/tests/engram-memory/neutral-contract-types.ts`
> - **Forbidden Paths (must not change in this branch)**:
>   - `Makefile`
>   - `docker-compose*.yml`
>   - `.github/workflows/**`
>   - `.cursor/rules/**`
>   - `.track/**`
>   - `packages/cluster-mesh/src/storage/**`
>   - `tools/memory-mcp-l5/artifacts/**`
> - **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
>   - `packages/cluster-mesh/package.json`
>   - `package-lock.json`
> - **Exception process**:
>   - [x] BRE8-EX1: owner assigns unique pack-only `0.23.0-dev.4`; manifest/root-lock version edits only; rollback both together; never publish.
> 
> ## Feedback Loop
> - [x] BRE8-EX2: integration base `6c3f9f04a` does not yet contain E0; list inherited E0 paths for actual-base CI scope only. `git diff --exit-code ad4164534 HEAD -- <inherited paths>` passes; E8 must not edit those bytes. Impact: scope declaration only; rollback: remove inherited entries after E0 integration. Manifest/root-lock entries remain version-only under BRE8-EX1.
> - [x] Producer answers 1–5 recorded in root `.tmp/engram-e2-host-tuple/e8-report.md`; E7 inputs: durable ledger, continuation grant, proof-only recovery. Composition ACK is partial; C7 acceptance remains `unverified`.
> - [ ] **Disposition before merge (P2-1)** — owner: release integrator on `feat/engram-e2-integration`; resolve both mandated dev.N bump failures below and obtain green `validate-cluster-mesh`, or record an explicit waiver. No test/fixture patch in E8.
> - [ ] `tests/modules/registry.spec.ts` — `should accept the current comments leaf version and still require its optional peer`: Comments compatibility returns `incompatible_version` instead of `not_installed`.
> - [ ] `tests/packaging/prepare-artifacts.spec.ts` — `should keep the frozen selected fixture aligned with the candidate release tuple`: frozen `0.22.2` differs from `0.23.0-dev.4`.
> - [ ] Integrate after E7; durable E9 and installed E10 acceptance remain separate.
> - [x] Host fixture keeps the factory-stamped store object; invocation and crypto dependencies are host/engine-private; a fresh ledger refuses until host authority is restored.
> - [x] Resume: retain prior commits; type the DTO fixtures and crypto result explicitly; cover admission, asynchronous issuance revocation and ambiguous commit refusal.
> - [x] Known llm-gateway 404 is outside E8 scope per owner.
> - [x] Registry 2026-10-26: latest mesh 0.22.1; assigned 0.23.0-dev.4 returns 404 and exceeds registry/base; pack-only manifest/root-lock bump, no publication.
> 
> ## AI Flaky tests
> - [x] No AI-dependent tests, flaky waiver, or increased timeout.
> 
> ## Orchestration Mode (AI-selected)
> - [x] Multi-branch: independent E8 topic targets `feat/engram-e2-integration`.
> 
> ## UAT Management (in orchestration context)
> - [x] No UI change; host integration and producer co-review replace interactive UAT.
> 
> ## Plan / Todo (lot-based)
> - [x] **Lot 0 — Baseline**: read Docker lock, E8 row, E0 ACK, rules/template; mechanical branch check; P2 pinned.
> - [x] **Lot 1 — Tests first**: candidate probe reproduced 5 failures/1 pass before liaison; expanded memory suite passes 92/92 across 12 files, including installed constructor provenance and DTO compilation.
> - [x] **Lot 2 — Host liaison**: host-owned fixture; private authoritative issuance and pre-effect guards; no caller DTO or copied invocation creates a mapping; no production seam needed before E7.
> - [x] **Resume qualification**: 16/16 candidate scenarios pass; full pre-extension memory run 92/92; P2 unchanged; PR #764 is draft, targets integration and remains unmerged. Actual-base inherited E0 scope is explicit.
> - [x] **Review refinement**: all three foreign identity fields also refuse candidate lifecycle after a valid pending commit; focused 16/16 rerun passes.
> - [x] **Opus r1 P2-2 / answer 4**: release definitive-failure reservations for owner retries; spent pending reads return `NOT_FOUND`; foreign/unknown and second effects refuse. Repro: 5 failures; final memory 103/103 (25 candidate), typecheck/lint pass; P2 unchanged. P2-1 remains assigned above before merge.
> - [ ] **Lot 3 — Validation**: focused tests, memory suite, typecheck/lint/build, dev.4 manifest commit, scope checks, unchanged P2.
> - [ ] **Lot 4 — Handoff**: push; draft PR from this file; green E2 qualification; report PR/head/CI and producer questions; do not merge.


## Retained lot #793 plan

- [x] Inherited from lot #793 at `origin/feat/engram-e2-memory-pg`; its approved plan is preserved below.

> # Wire shared PG for the memory lane (integration)
> 
> ## Objective
> Run the `memory` lane of `engram-e2-qualify` against the shared Postgres service (`ENV=test-e2-int` style) so PG-backed memory cases execute instead of skipping, fail-closed when PG is absent.
> 
> ## Scope / Guardrails
> - Base `origin/feat/engram-e2-integration` (`d22fc3f24`); PR targets `feat/engram-e2-integration`.
> - Make-only; `ENV=test-e2-int` last; 0 Python; no publication or merge.
> - Serialize Docker/test steps with the shared lock; existing Compose targets only; `make down` after each step.
> - Makefile lane wiring only: no src, range, version or product change.
> - Specific-file staging; `make commit` only, each below 150 changed lines, without attribution trailers.
> 
> ## Branch Scope Boundaries (MANDATORY)
> - **Allowed Paths (implementation scope)**:
>   - `BRANCH.md`
>   - `Makefile` (BR-MEMPG-EX1: memory lane shares `engram-e2-postgres-up` and `CM_PG_URL` with the postgres lane; fail-closed under `set -eu` when PG is absent)
> - **Forbidden Paths (must not change in this branch)**:
>   - `docker-compose*.yml`
>   - `.github/workflows/**`
>   - `.cursor/rules/**`
>   - `.track/**`
>   - `packages/cluster-mesh/src/**`
>   - `packages/cluster-mesh/tests/**`
>   - `packages/cluster-mesh/assets/**`
>   - `packages/cluster-mesh/package.json`
>   - `package-lock.json`
> - **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
>   - _none_
> - **Exception process**:
>   - [x] BR-MEMPG-EX1 (integrator): the memory lane starts the shared PG service and exports the lane `CM_PG_URL`, mirroring the postgres lane; a missing PG aborts the lane before any test runs.
> 
> ## Feedback Loop
> - [x] Root cause: the `memory` lane ran `test-cluster-mesh SCOPE=tests/engram-memory` with no `CM_PG_URL` and no PG service, so PG-backed memory cases skipped and any PG stage never ran in CI.
> - [x] Fix: same `CM_PG_URL` value and same `engram-e2-postgres-up` gate as the `postgres` lane; `set -eu` keeps it fail-closed.
> - [x] No `ci.yml` change: `qualify-engram-e2` already runs `engram-e2-qualify` on the `test-e2-int` Compose project that provides the `postgres` host (proven by the postgres lane).
> - [ ] Push draft PR targeting `feat/engram-e2-integration`; verify validate-cluster-mesh green without merging.
> 
> ## AI Flaky tests
> - [x] No AI tests or flaky waiver applies.
> 
> ## Orchestration Mode (AI-selected)
> - [x] Mono-branch: one integration fix; no delegated implementation.
> 
> ## UAT Management (in orchestration context)
> - [x] No web, Chrome or VS Code changes; qualify the memory lane locally on integration with PG up (skips become executions where PG-backed).
> 
> ## Plan / Todo (lot-based)
> - [x] **Lot 0 — Branch setup**: worktree `tmp/worktrees/mem-pg-wire` on the integration base; `harness check branch` PASS.
> - [x] **Lot 1 — Wiring**: `CM_PG_URL` + `postgres-up` for the memory lane.
> - [ ] **Lot 2 — Final validation**
>   - [ ] `make scope-check` before each commit; commits under 150 lines via `make commit`.
>   - [ ] Run `make engram-e2-lane E2_LANE=memory ENV=test-e2-int` locally; receipts retained, cleanup done.
>   - [ ] Push and open draft PR targeting `feat/engram-e2-integration`; verify validate-cluster-mesh green without merging.


## Retained lot #792 plan

- [x] Inherited from lot #792 at `origin/feat/engram-e2-p3-repin`; its approved plan is preserved below.

> # P3 re-pin after #769 (integration)
> 
> ## Objective
> Re-pin `feat/engram-e2-integration` from the P2 generation (`f2b094ae`, retained history `2b85ff28`) to the P3 generation frozen by main #769: manifest `1c96bada2a749155f29aae763fa73ea6379c385d619f70614110f59b6b10b730`, catalog `9bf377b774dda54a3b37189eea57cb845acca7b27b8b55b399f23c20215a1211`, l0-freeze `0541b15ba4d5e49ba3b30d92da1c5e3c2fd668e40937e4f942103a678e849bfb`.
> 
> ## Scope / Guardrails
> - Base `origin/feat/engram-e2-integration` (`d22fc3f24`); PR targets `feat/engram-e2-integration`.
> - Make-only; `ENV=test-e2-int` last; 0 Python; no publication or merge.
> - Serialize Docker/test steps with the shared lock; existing Compose targets only; `make down` after each step.
> - Pin files only: no src, range, version or product change.
> - Specific-file staging; `make commit` only, each below 150 changed lines, without attribution trailers.
> 
> ## Branch Scope Boundaries (MANDATORY)
> - **Allowed Paths (implementation scope)**:
>   - `BRANCH.md`
>   - `spec/evidence/memory-mcp-l5/l0-freeze.json` (P3 content, from main #769)
>   - `tools/memory-mcp-l5/proof-catalog-v1.json` (P3 content, from main #769)
>   - `tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json` (P3 manifest, from main #769)
>   - `tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json.sha256` (P3 pin)
>   - `tools/memory-mcp-l5/artifacts/history/f2b094ae034514727dfe2f4c9a89b3742e3d75beafc8f70e5074cd49d7f16642.json` (outgoing-pin archive, per retention spec)
>   - `tools/memory-mcp-l5/artifacts/history/f2b094ae034514727dfe2f4c9a89b3742e3d75beafc8f70e5074cd49d7f16642.json.sha256` (archive sidecar)
>   - `tools/memory-mcp-l5/tests/receipt-contract.test.mjs` (P09: 18 files + requiredCases, from main #769 — no main merge, single hunk)
> - **Forbidden Paths (must not change in this branch)**:
>   - `docker-compose*.yml`
>   - `.github/workflows/**`
>   - `.cursor/rules/**`
>   - `.track/**`
>   - `tools/memory-mcp-l5/artifacts/history/**` (immutable history stays)
>   - `packages/cluster-mesh/src/**`
>   - `packages/cluster-mesh/assets/**`
>   - `packages/cluster-mesh/package.json`
>   - `package-lock.json`
> - **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
>   - _none_
> - **Exception process**:
>   - _none required_
> 
> ## Feedback Loop
> - [x] `C6-FREEZE.md` has no integration counterpart (E0/E6 lot file keeping its own P2 line); the re-pin ports the P3 generation files that exist on integration: the two content files plus manifest and sidecar, so the freeze check stays coherent.
> - [x] Frozen sha256 verified after the change: l0-freeze `0541b15b…`, catalog `9bf377b7…`, manifest `1c96bada…` (sidecar contains the manifest hash).
> - [x] Retained history (`2b85ff28` generation) untouched; outgoing `f2b094ae` archived under `history/` as the spec prescribes (archive content hashes to the pin).
> - [x] Opus r1 (memory-l5 gate): the P09 hunk taken from main #769 without a main merge (single hunk, no other main delta); a full `origin/main` merge would explode this PR's scope.
> - [x] `C6-FREEZE.md` has no integration counterpart (E0/E6 lot file); not ported — E6 keeps its own P2 line.
> - [ ] Push draft PR targeting `feat/engram-e2-integration`; verify validate-cluster-mesh green without merging.
> 
> ## AI Flaky tests
> - [x] No AI tests or flaky waiver applies.
> 
> ## Orchestration Mode (AI-selected)
> - [x] Mono-branch: one integration fix; no delegated implementation.
> 
> ## UAT Management (in orchestration context)
> - [x] No web, Chrome or VS Code changes; no test campaign (pin files only, hashes verified byte for byte).
> 
> ## Plan / Todo (lot-based)
> - [x] **Lot 0 — Branch setup**: worktree `tmp/worktrees/p3-repin` on the integration base; `harness check branch` PASS.
> - [x] **Lot 1 — Re-pin**: copy the four P3 files from `origin/main`; verify the three frozen sha256.
> - [ ] **Lot 2 — Final validation**
>   - [ ] `make scope-check` before commit; commits under 150 lines via `make commit`.
>   - [ ] Push and open draft PR targeting `feat/engram-e2-integration`; verify validate-cluster-mesh green without merging.


## Retained lot #790 plan

- [x] Inherited from lot #790 at `origin/feat/cluster-mesh-engram-e9`; its approved plan is preserved below.

> # Test: Durable memory acceptance corpus (E9; blocked on E7)
> 
> ## Objective
> 
> - [ ] Qualify approved plan row E9 through the shipped E7 bindings; current status `blocked: E7-fenced-writers`. Worktree `tmp/worktrees/mem-e9`, branch `feat/cluster-mesh-engram-e9`, draft PR targeting `feat/engram-e2-integration`.
> - [ ] Run real PostgreSQL memory Stage B through installed Engram 0.21.1, its exact `['read','write']` binding and E7's separate host maintenance binding. Host snapshot/journal reads are `blocked: E7`. Pack-only reservation `0.23.0-dev.10`; P3 re-pin and CI PG wiring belong to the integration lane.
> 
> ## Scope / Guardrails
> 
> - MUST reuse the neutral memory contract and `CanonicalOwnershipError` codes (frozen files, import only). NO new ownership contract, NO second PG ownership contract.
> - E9 authors acceptance tests only. The source paths declared below are inherited E7 scope; all E9 production changes have been reverted. Fenced-writer and maintain-read bindings belong to E7; CI PG wiring and P3 re-pin belong to the integration lane.
> - E8-answers obligations: durable host-issued evidence (candidate→store/scope/invocation-or-continuation mapping, envelope binding, reservation/terminal/ambiguous state, receipt/cursor reconciliation); continuation grant needs fresh host authn/authz checked against retained authority (copied fields never grant); proof-only recovery path (authorized capture-proof reads, admission-outcome recovery, journal replay) that refuses unknown/foreign access and any second effect. Refusing on an empty ledger is correct until rehydration.
> - Existing `binding-compatibility`/`binding-errors` keep passing; shared corpus semantics unchanged (additive cases only).
> - Tests first; `ENV=test-e2-int` as the last make argument; `make commit MSG="type: …"` (<150 lines, `git add` specific files, no AI trailers). Never `ENV=dev`. 0 Python.
> - Disk is tight: reuse `ENV=test-e2-int` images; `make down ENV=test-e2-int` only if this session owns the compose project.
> 
> ## Branch Scope Boundaries (MANDATORY)
> 
> - **Allowed Paths (implementation scope)**:
>   - `BRANCH.md`
>   - `packages/cluster-mesh/tests/engram-memory/memory-corpus.ts`
>   - `packages/cluster-mesh/tests/engram-memory/memory-*.ts`
>   - `packages/cluster-mesh/tests/engram-memory/memory-*.mjs`
>   - `packages/cluster-mesh/tests/engram-memory/durable-memory.spec.ts`
>   - `packages/cluster-mesh/tests/engram-memory/qualification.mk`
>   - `packages/cluster-mesh/tests/engram-memory/candidate-scope.spec.ts` (inherited E8)
>   - `packages/cluster-mesh/tests/engram-memory/host-scope-binding.ts` (inherited E8)
>   - `packages/cluster-mesh/tests/engram-memory/scope.spec.ts` (inherited E8)
>   - `packages/cluster-mesh/tests/storage/postgres-memory.spec.ts`
>   - `packages/cluster-mesh/src/engram-memory/binding.ts` (new: public host assembly, Engram `['read','write']` handle only)
>   - `packages/cluster-mesh/src/engram-memory/postgres.ts` (extend: host PG driver/pool injection, identity/qualification checks)
>   - `packages/cluster-mesh/src/engram-memory/host-maintenance.ts` (new: host-only fence/checkpoint/poison/retry/resync/snapshot ports)
>   - `packages/cluster-mesh/src/engram-memory/ledger.ts` (new only if the durable host-evidence ledger cannot live in host-maintenance.ts; smallest file that holds)
>   - `packages/cluster-mesh/tests/engram-memory/postgres-driver-injection.spec.ts` (new: positive installed driver calls, missing/weak driver refusal, no fallback)
>   - `packages/cluster-mesh/tests/engram-memory/host-maintenance-binding.spec.ts` (new: host-only checkpoint/resync/snapshot/fence; runtime/type denial through the memory handle; revoked/foreign maintain refusal)
>   - `packages/cluster-mesh/tests/engram-memory/binding-compatibility.spec.ts` (extend: Engram handle stays `['read','write']`)
>   - `packages/cluster-mesh/tests/engram-memory/binding-errors.spec.ts` (extend: typed host-seam failures)
>   - `packages/cluster-mesh/tests/engram-memory/pg-host.ts` (extend fixture only: host assembly + maintenance authority)
>   - `packages/cluster-mesh/package.json` + `package-lock.json` (pack-only 0.23.0-dev.10 only)
>   - `packages/cluster-mesh/assets/storage/engram-memory/C6-FREEZE.md` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/assets/storage/engram-memory/neutral-asset-inventory.json` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/assets/storage/engram-memory/neutral-equivalence.json` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/assets/storage/postgres/007-consumed-counters.sql` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/assets/storage/postgres/008-instance-ownership.sql` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/assets/storage/postgres/engram-memory/001-projections.sql` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/assets/storage/postgres/engram-memory/manifest.json` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/assets/storage/postgres/manifest.json` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/src/engram-memory/commit-result-recovery.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/src/engram-memory/contract.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/src/engram-memory/neutral-contract.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/src/engram-memory/postgres-queries.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/src/engram-memory/projection.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/src/storage/atomic.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/src/storage/backend.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/src/storage/contracts.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/src/storage/postgres/codec.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/src/storage/postgres/commit-results.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/src/storage/postgres/core.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/src/storage/postgres/effects.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/src/storage/postgres/installed.ts` (BR9-EX3 exact memory chain count adaptation)
>   - `packages/cluster-mesh/src/storage/postgres/manifests.ts` (BR9-EX3 exact memory chain count adaptation)
>   - `packages/cluster-mesh/src/storage/postgres/errors.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/src/storage/postgres/index.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/src/storage/postgres/instance-guard.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/src/storage/postgres/instance-ownership.ts` (inherited E1 bytes only, E7 untouched; BR7-EX2)
>   - `packages/cluster-mesh/src/storage/instance-ownership.ts` (inherited E1 bytes only, E7 untouched; BR7-EX2)
>   - `packages/cluster-mesh/src/storage/postgres/journal.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/src/storage/postgres/migrations.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/src/storage/postgres/ordinary-transactions.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/src/storage/postgres/protocol.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/src/storage/postgres/queries.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/src/storage/postgres/readers.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/src/storage/postgres/roots.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/src/storage/postgres/scope.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/src/storage/postgres/snapshots.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/src/storage/postgres/transactions.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/src/storage/u64.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/tests/comments-fragment-vectors.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/tests/engram-memory/contract-vectors.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/tests/engram-memory/neutral-contract-types.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/tests/engram-memory/postgres-registration.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/tests/engram-memory/projection.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/tests/engram-memory/queries.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/tests/fixtures/reserved-versions.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/tests/modules/registry.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/tests/packaging/prepare-artifacts.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/tests/storage/atomic-corpus.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/tests/storage/chain-corpus.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/tests/storage/commit-result-corpus.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/tests/storage/commit-result-process.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/tests/storage/common-rule/contract.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/tests/storage/common-rule/vectors.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/tests/storage/generate-pg-manifest.mjs` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/tests/storage/instance-corpus.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/tests/storage/instance-ownership.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/tests/storage/pg-open-child.mjs` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/tests/storage/postgres-authority.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/tests/storage/postgres-corpus.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/tests/storage/postgres-crashes.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/tests/storage/postgres-instance-admission.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/tests/storage/postgres-instance-guard.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/tests/storage/postgres-instance-multiprocess.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/tests/storage/postgres-instance-ownership.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/tests/storage/postgres-memory.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/tests/storage/postgres-module-migrations.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/tests/storage/postgres-reattest.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/tests/storage/postgres-replay.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/tests/storage/postgres-result-recovery.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/tests/storage/postgres-transactions.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/tests/storage/postgres-u64-migration.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/tests/storage/postgres-u64.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/tests/storage/read-corpus.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/tests/storage/representation-contract.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/tests/storage/u64-contract.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `packages/cluster-mesh/tests/storage/u64-corpus.ts` (inherited base lots E0-E6 only; BR7-EX2)
>   - `PLAN.md` (inherited base lots E0-E6 only; BR7-EX2)
>   - `tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json` (inherited base lots E0-E6 only; BR7-EX2)
>   - `tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json.sha256` (inherited base lots E0-E6 only; BR7-EX2)
> - **Exception process**:
>   - [x] BR7-EX2: r1 qualification scope — the stacked diff base...HEAD carries 76 unknown paths plus the frozen `instance-ownership.ts` files (inherited bytes) from base lots E0-E6; E7 authors none of them. Docs-only declaration, no implementation authorized. Rollback: drop these annotation lines.
>   - [x] BR7-EX3: P1-5 activates the conditional `002-*.sql` path — new file `assets/storage/postgres/engram-memory/002-host-ledger.sql` (sha256 `e4dc0805…63d6d9b`, memory-only `memory_host_ledger` table, requires 001) authored by E7; `migrations.ts` untouched and `engram-memory/manifest.json` registration deferred to E2-writer coordination (E2 owns the migration single-writer; the P1-5 test applies the asset SQL directly). Rollback: delete the 002 file.
> - **Forbidden Paths (must not change in this branch)**:
>   - `Makefile`
>   - `docker-compose*.yml`
>   - `api/**`
>   - `ui/**`
>   - `apps/**`
>   - `packages/engram/**` (stays 0.21.1)
>   - `packages/cluster-mesh/src/storage/instance-ownership.ts` (frozen, reuse only)
>   - `packages/cluster-mesh/src/storage/sqlite/**`
>   - `packages/cluster-mesh/assets/storage/postgres/001-008*.sql` (published, byte-identical)
>   - `packages/cluster-mesh/assets/storage/engram-memory/001-projections.sql` (E6, byte-identical)
>   - Any second ownership contract or artifacts-coordinator reuse.
> - **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
>   - `packages/cluster-mesh/assets/storage/postgres/engram-memory/002-*.sql` (new memory-only ledger asset ONLY if host-evidence durability needs it; E2 owns `migrations.ts` single-writer — STOP and coordinate before touching it).
> 
> ## Plan / Todo (lot-based)
> 
> - [x] r1 status: checked pre-r1 campaign steps below are historical fixture-run provenance only. Current acceptance is blocked as specified in Objective and Feedback Loop; none of these runs qualifies the shipped host assembly.
> - [x] Lot E9-0 — read approved plan and binding sections 7–10; mechanically check branch; merge E8 into E7; retain inherited scope declarations; freeze Engram/P3 bytes.
> - [x] Lot E9-1a — initial tests first: `memory-corpus.ts`, `durable-memory.spec.ts`; real PostgreSQL required, initial run fails because the campaign fixture is not implemented yet. This is a scaffolding failure, not an invariant proof.
> - [x] Lot E9-1b — complete explicit profile/case inventory, zero skip/todo; failure controls assert the intended invariant.
> - [x] Lot E9-2 — PostgreSQL fixture: `memory-pg-host.ts`, `memory-neutral.ts`; neutral wire translation, real transactions and queries, separate host maintenance runner, injected driver, installed constructor and E8 candidate liaison.
>   - [x] Neutral transaction and query wire bridge preserves JSON values and exact decimal counters; kernel-backed commit identity index, no replay cache.
>   - [x] Initial real-PG fixture opens installed Engram 0.21.1 with exact read/write and durable canonical ownership. First execution exposes a real capture-proof wire-shape mismatch in the installed validator; no bytes rewritten by the bridge.
> - [x] Lot E9-3 — Stage B: capture/completion/admission/read, immutable proofs after destruction/replay, bounded snapshots/outbox, checkpoint/resync/fence/poison/retry, original receipts after crash/reopen, u64 crossings/exhaustion, G3 ownership, C4 recovery and C7 scope refusals.
>   - [x] Initial five-case real-PG run passes after the two evidenced wire fixes; add engine acceptance/rejection traces through E8's authoritative candidate liaison and actual key destruction.
>   - [x] Engine traces pass (7/7); add host checkpoint/resync/snapshot and poison/retry with independent maintain checks, plus host read/maintain grant without write. No read/write/maintain grant enters the campaign.
>   - [x] Host maintenance positive cases pass (9/9); add independent-process contention and real SIGKILL before/after COMMIT, own peer TCP pool and elapsed durable lease, original-result lookup in a new epoch.
>   - [x] Actual SIGKILL paths and process contention execute; correct two test-carrier errors (canonical source sequence and frozen `created_cursor` name). Add C5 sparse high-water cases at safe/signed/u64 boundaries through the same neutral PG handle.
>   - [x] Add same-handle second constructor, durable store/scope binding and independent memory-token revocation cases before changing acquisition behavior.
>   - [x] Resume: 20 real-PG cases pass at `1b8b36290`; add bounded accepted snapshot/outbox and a deferred-COMMIT rollback probe. Snapshot assertions retain the historical document set and eligibility digest; the observation cursor follows the current head under frozen Engram semantics.
>   - [x] Bounded reads and SQL-trigger rollback pass (23/23 at `422ac36c3`); complete inventory enforcement, engine proof-only replay after destruction/reopen, terminal-loss discrimination and runtime/migration facts.
>   - [x] Test-first expansion: 170/173 pass (18 memory files, zero skipped). Three deliberate new failures expose missing terminal-authority rehydration in the campaign liaison and foreign-scope lookup refusal precedence. Wire E7's existing durable ledger and bind-scope checks in the fixture; frozen Engram/P3 stay unchanged.
>   - [x] Fixture correction: apply E7's unchanged 002 ledger asset directly (as its existing tests do), retain seal/admission evidence through its PG API, and authorize terminal proof recovery only against current host authority plus the retained store/scope/principal/invocation. Explicitly reject foreign neutral grants before fence lookup.
>   - [x] All 18 memory files pass: 173/173, zero skipped/todo, including 24 Stage B cases. Profile counts: atomic 8, chains 3, boundaries 3, outbox 3, fenced writers 6; one additional inventory case. Runtime: Node 24.21.0 x64, PostgreSQL 17.11, serializable and synchronous_commit=on. Fix the lint-reported extra assertion in fixture cleanup before final quality gates.
> - [x] Lot E9-4 — `test-cluster-mesh` scoped memory and PostgreSQL lanes; typecheck/lint; mechanical scope gate before each `make commit`; every authored commit under 150 lines; no AI trailers.
> - [x] Final build exits 0; retained Stage B at `c5ef55b64` passes 24/24 with zero skip/todo. Campaign and cleanup both exit 0; log SHA-256 `9dbc013e793f3c4e829cf16e4431676f3dd5960e9ad975b3ceec3aa725f2c5f1` in `tmp/memory-stage-b/`. The final report-only commit changes no tested package bytes.
> - [x] Lot E9-5 — retain campaign facts and counts per profile; push retry every ten minutes until successful; draft PR from this file; record CI; do not merge or publish.
>   - [x] Author source `68783a1f6`: memory 18 files / 173 passed; Stage B 24 passed / zero skip/todo. Atomic 8, immutable chains 3, immutable boundaries 3, scope outbox 3, fenced writers 6, plus inventory 1.
>   - [x] Supplementary storage regressions: 78 passing files / 502 passed; `postgres-crashes.spec.ts` has 4 phase-selected server-crash tests outside this invocation. E9's separate SIGKILL-before/after-COMMIT cases both execute and pass; no E9 case is skipped.
>   - [x] `make typecheck-cluster-mesh lint-cluster-mesh ENV=test-e2-int` exits 0; local and E7-base stacked mechanical scope both PASS C2. Every E9 author commit is below 150 changed lines.
>   - [x] Retained logs/status/hashes: `tmp/memory-e9-receipts/`; runtime Node 24.21.0 x64 and PostgreSQL 17.11, serializable transactions, synchronous_commit=on. Compose PG data is tmpfs: this campaign proves process death/reopen, not host power-loss durability. Native backend and Engram semantic profile digests are retained separately.
>   - [x] Reproduce: `make -f Makefile -f packages/cluster-mesh/tests/engram-memory/qualification.mk memory-stage-b ENV=test-e2-int`. This target takes the shared lock, starts only existing Compose PostgreSQL, retains source/log hashes, then tears down the owned stack and releases the lock on success or failure.
>   - [x] Engram remains pinned to 0.21.1; pack-only mesh version 0.23.0-dev.10; no P3/candidate edits. The inherited pre-candidate bytes are unchanged from E7 (`2b85ff28b6fe06bda0abcdc19255f61a1ed1e4b7cfbb40c2e881c98dd234424b`); they are historical bytes, not a newly generated P3 claim. The externally frozen candidate remains `26a0edd50c338f30593d22ae1f06ac13d82f5557f18558750659bcfefec64c10`.
>   - [x] Push succeeds at 08:26 UTC after ten-minute retries; remote author head `e6495b6799887da41a7057adcee01366c7185a44` verified by `git ls-remote`. Draft [PR #790](https://github.com/rhanka/sentropic/pull/790) targets `feat/engram-e2-integration`, mergeable=true. [CI 40473787086](https://github.com/rhanka/sentropic/actions/runs/40473787086) is queued on that head; no CI-green claim, merge, publication, consensus review or E10 installed mesh-tarball qualification is made by this author report.
> 
> ## Orchestration Mode (AI-selected)
> 
> - [x] Mono-branch: one E9 author, merge-only integration, no delegated implementation.
> 
> ## UAT Management (in orchestration context)
> 
> - [x] Library-only work; no application, browser, Chrome or VSCode changes or interactive UAT.
> - [x] Reuse existing `ENV=test-e2-int` PostgreSQL stack and pinned Node 24 image; no image build. Docker lock held only while campaign commands run and released between steps.
> - [x] Never tear down a shared stack owned by another session. Test schemas are private and removed by their fixtures.
> 
> ## Feedback Loop
> 
> - [x] r1 source verification at committed clean `a25bc3dfb`: memory 18 files / 150 passed / 23 explicitly blocked (Vitest skipped), total 173. Qualification correctly exits 2 and cleanup exits 0; receipt `tmp/memory-e9-r1/final-memory/`. Final head is rerun after this report-only commit, with its exact SHA/tree retained in `tmp/memory-e9-r1/head-memory/`.
> - [x] r1 corpus disposition: preserve all 23 behavioral cases and the inventory case; every behavioral case depends on the fixture handle and is explicitly `blocked: E7-fenced-writers`. The three host maintenance cases additionally carry `blocked: E7` for snapshot/journal reads. Skips represent unmet source dependencies, never accepted profile evidence; the zero-skip qualification gate remains open.
> - [x] P2-2: remove the fixture-issued `memory-host-reader` token entirely. Snapshot and journal reads bind only `binding.maintainGrant`; current E7 cannot authorize those reads. Retain the positive corpus and extend its revoked-authority probe to journal replay; enable it only against E7's shipped host assembly.
> - [x] r1 receipt guard: refuse any dirty tree, record exact HEAD/tree, verify both remain unchanged after the campaign, and fail qualification if the inventory reports blocked cases. A successful inventory check cannot turn the 23 blocked scenarios into accepted evidence.
> - [ ] Integration rerun: after the separate CI PG/P3 lane lands and the conductor integrates E9, rerun the same corpus on the clean committed integration head. E7 fenced-writer and host-read blockers remain open until its shipped bindings are wired; no implementation is authorized here.
> - [x] r1 disposition supersedes the historical campaign completion claims above: fixture semantics do not qualify the shipped host assembly; no five-profile or `fenced-writers-v1` qualification is claimed.
> - [x] P2-1 reproduced and corrected for the historical tree: clean committed `02c626ca471ac5d051cda9eee991ff16bcc28ab8`, memory 18 files / 173 passed, zero skip/todo; `exit=0 cleanup=0`. Receipt `tmp/memory-e9-r1/committed-173/`, campaign SHA-256 `33e39849eca323a2dc9072c243763305f05e1846bb6a0d42e16a1d83545b85d8`; this is not a receipt for subsequent revisions.
> - [x] BR9-EX1 reverted in r1: `postgres.ts` restored to E7 `ee654ace2`; E6 owner suggestion: validate frozen Engram snake-case K7/K8 proofs without rewriting stored bytes, retaining first-proof immutability. Verification: real-PG installed capture/completion/admission/replay.
> - [x] BR9-EX2 reverted in r1: `projection.ts` restored to E7 `ee654ace2` (including the E9 ordinal adaptation); E6 owner suggestion: derive journal intent metadata from the frozen event payload, whose DTO lacks `intent_hash`. Verification: real-PG capture and conflicting/original replay. Both suggestions delivered to `s-conductor` via h2a.
> - [x] BR9-EX3 reverted in r1: E9 changes in `postgres/{effects,manifests,readers,scope}.ts` restored to E7 `ee654ace2`; no E9 production diff remains. E2 owner suggestion: exact-u64 chain count/position allocation and reads, checked exhaustion, with all three C5 real-PG crossings as acceptance. Delivered to `s-conductor` via h2a.
> - [x] E2 constraint: `chainRecordKey` pads to 16 digits while u64 positions reach 20; exact-key lookup only above 10^16, no lexical/range ordering assumption. Owner decides representation; E9 does not change it.
> - Blocker: if E2/E3/E6 move under this branch (new migration writer, changed `migrations.ts`, moved `scope.ts` hooks), stop and coordinate — do not renumber or rewire around them.
> - Base refs: E5 `8bad820e9` (E5-1/E5-2 done, E5-3 CI pending on #787 for structural E2-base reasons, not code); E6 `9b476e20d` (projection/resync, memory PG assets, `postgres-memory.spec.ts` in the E2 real-PG lane).
> - Pack-only `0.23.0-dev.9` resolves the merge conflict (E5 `dev.8` vs E6 `dev.5`); version fields only, rollback both fields together. Known dev-bump gate friction (release-only `satisfiesRange`) tolerated until #774, as in E5/E6.
> - Engram 0.21.1 DTOs frozen; memory files unchanged at 0.21.2, so the E8 answers hold.
> - E7 gate = engram-memory lanes + PG storage lanes green (E9 runs the five-profile acceptance later, not here).
> - AI CI job red-on-main is out of scope for this lot's gate.
> - Slices landed: PG provider check, host assembly, fail-closed maintenance ports, ledger + continuation + proof-only, positive host calls through the injected pool, neutral-handle denial; binding-compatibility pinned.
> - E7 receipts (ENV=test-e2-int, CM_PG_URL=postgresql://app:app@postgres:5432/app, head `aba2cbb97`): `SCOPE=tests/engram-memory` 16 files 122 passed, 0 todo; `SCOPE=tests/storage` 78 passed | 1 skipped files, 502 passed | 4 skipped; typecheck/lint exit 0; scope-check PASS C2. CI rerun pending.

