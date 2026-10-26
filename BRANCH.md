# Feature: Engram E1 Additive exact u64 counters

## Objective
Additive exact u64 counters for generic storage, with opt-in consumed paths and u64 epoch ownership.

## Scope / Guardrails
- Approved specification: root `.tmp/engram-e2-host-tuple/plan.md`, revision 3, E1 row and referenced sections.
- Branch `feat/cluster-mesh-engram-e1`; worktree `tmp/worktrees/mem-e1`; base `origin/feat/engram-e2-integration` plus `origin/feat/cluster-mesh-engram-e0` merge, no rebase.
- Make-only; `ENV=test-e2-int` last; 0 Python; no publication or merge.
- Serialize Docker/test steps with the shared lock; existing Compose targets only; `make down` after each step.
- Preserve P2 `2b85ff28b6fe06bda0abcdc19255f61a1ed1e4b7cfbb40c2e881c98dd234424b`; stop if an authored change alters it.
- Preserve repaired file-local common v1 allowlist in `common-contract.ts`; no PG migration; do not widen common-contract domain.
- Keep old exports and signatures compatible.
- Specific-file staging; `make commit` only, each below 150 changed lines, without attribution trailers.
- Unique pack-only `0.23.0-dev.2`, next free N after E0.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/src/storage/u64.ts`
  - `packages/cluster-mesh/src/storage/contracts.ts`
  - `packages/cluster-mesh/src/storage/atomic.ts`
  - `packages/cluster-mesh/src/storage/backend.ts`
  - `packages/cluster-mesh/src/storage/instance-ownership.ts`
  - `packages/cluster-mesh/tests/storage/u64-corpus.ts`
  - `packages/cluster-mesh/tests/storage/u64-contract.spec.ts`
  - `packages/cluster-mesh/tests/storage/representation-contract.spec.ts`
  - `packages/cluster-mesh/tests/storage/atomic-corpus.ts`
  - `packages/cluster-mesh/tests/storage/chain-corpus.ts`
  - `packages/cluster-mesh/tests/storage/read-corpus.ts`
  - `packages/cluster-mesh/tests/storage/instance-ownership.spec.ts`
  - `packages/cluster-mesh/tests/storage/common-rule/vectors.ts`
  - `packages/cluster-mesh/tests/storage/common-rule/contract.spec.ts`
  - `packages/cluster-mesh/tests/storage/scope-grant-modules.spec.ts`
  - `packages/cluster-mesh/tests/comments-fragment-vectors.spec.ts`
  - `PLAN.md` (inherited: E0 merge content, unauthored here)
  - `packages/cluster-mesh/src/engram-memory/neutral-contract.ts` (inherited: E0 merge content, unauthored here)
  - `packages/cluster-mesh/assets/storage/engram-memory/**` (inherited: E0 merge content, unauthored here)
  - `packages/cluster-mesh/tests/engram-memory/contract-vectors.spec.ts` (inherited: E0 merge content, unauthored here)
  - `packages/cluster-mesh/tests/engram-memory/binding-compatibility.spec.ts` (inherited: E0 merge content, unauthored here)
  - `packages/cluster-mesh/tests/engram-memory/neutral-contract-types.ts` (inherited: E0 merge content, unauthored here)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.github/workflows/**`
  - `.cursor/rules/**`
  - `.track/**`
  - `packages/artifacts/**`
  - `packages/cluster-mesh/src/storage/common-contract.ts`
  - `packages/cluster-mesh/src/storage/postgres/**`
  - `packages/cluster-mesh/src/storage/sqlite/**`
  - `packages/cluster-mesh/src/engram-memory/**`
  - `packages/cluster-mesh/assets/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `packages/cluster-mesh/package.json`
  - `package-lock.json`
- **Exception process**:
  - [x] BR1-EX1: pack-only package.json/root lock bump to unique `0.23.0-dev.2`; satisfies topic bump gate, never published; rollback both version fields together.

## Feedback Loop
- [x] E0 merged from `origin/feat/cluster-mesh-engram-e0` at `ad4164534`; integration base `6c3f9f04a`; P2 unchanged.
- [x] Registry check 2026-10-26: mesh latest `0.22.1`; `0.23.0` reserved, `0.23.0-dev.1` taken by E0; `0.23.0-dev.2` is next free N for E1.
- [x] Frozen guard: `isDecimalCounter` / `parseDecimalCounter` stay safe-integer only; generic `isStorageModuleId('engram-memory')` stays true while common v1 rejects that module.
- [x] Counter guard: otherwise valid `terminal.count = '9007199254740992'` fails with exactly `terminal count must be a decimal counter`.
- [x] Epoch domain: neutral `CanonicalInstanceOwnershipV1` keeps name/version/meaning/digest and error codes; internal epoch uses exact u64, public `storageEpoch` stays decimal string.
- [x] `src/storage/common-contract.ts` untouched; no PG migration; no domain widening.
- [x] Broader `test-cluster-mesh` shows 2 known pack-only failures on `0.23.0-dev.2` (same pair as E0 `dev.1`, job 121554531282): (a) `tests/packaging/prepare-artifacts.spec.ts` selected fixture pins `file:...-0.22.2.tgz` vs candidate `0.23.0-dev.2`; (b) `tests/modules/registry.spec.ts` comments leaf resolves `incompatible_version` on `@sentropic/cluster-mesh` instead of `not_installed` on `@sentropic/comments` (a dev version never satisfies the Comments 0.3.0 range `>=0.21.0 <0.22.0`; no silent widening). Both are outside this branch scope (plan L7 selected-fixture hotspot + Comments disposition, integrator-owned). `validate-cluster-mesh` therefore stops at the test step; skipped downstream for that CI head: installed MCP contracts, Build, Pack, sibling packs, installed-comments PG, PG major-upgrade, packed lazy gate, candidate install. Local evidence instead: `build-cluster-mesh` green, `pack-cluster-mesh` green (`0.23.0-dev.2` mode=block sha256=3c433eec3dfd6618798c6c42efba8e2696af71297d6c259bd783928f589ef40f); lazy install gate attempted but blocked by fixture-pinned `@sentropic/llm-gateway@0.21.1` missing from the registry (latest `0.21.0`), same pre-existing fixture staleness, untouched. E2 `qualify-engram-e2` is green and is the gate.
- [x] Lock lesson: `engram-e2-qualify` self-locks per lane; never wrap it in an outer shared-lock call (self-deadlock); run it bare with `ENV=test-e2-int` last.
- [x] Scope lesson: PR diff vs integration includes the E0 merge until PR #758 lands; E0-originated paths above are declared inherited/unauthored. After E0 lands, merge the integration base and drop those lines.
- [x] Draft PR #763 targeting `feat/engram-e2-integration` is open; E2 qualification green on the previous head.
- [ ] Merge order (P2-6): #763 stays unmerged until #758 lands; then merge the integration base and drop the inherited-path lines.

## AI Flaky tests
- [x] No AI tests or flaky waiver applies.

## Orchestration Mode (AI-selected)
- [x] Mono-branch: one E1 topic targets the integration branch; no delegated implementation.

## UAT Management (in orchestration context)
- [x] No web, Chrome or VS Code changes; qualify storage counters and ownership.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and branch setup**
  - [x] Read Docker lock, rules, approved plan, E0 entry check and P2 binding.
  - [x] Create worktree `tmp/worktrees/mem-e1` on integration base; merge E0 without rebase.
  - [x] Write BRANCH.md from template; reserve pack-only `0.23.0-dev.2`.
- [x] **Lot 1 — Tests first**
  - [x] Add `tests/storage/u64-corpus.ts` and `u64-contract.spec.ts`.
  - [x] Extend `representation-contract.spec.ts`, `atomic-corpus.ts`, `chain-corpus.ts`, `read-corpus.ts`, `instance-ownership.spec.ts`.
  - [x] Extend `common-rule/vectors.ts` and `contract.spec.ts` with above-safe terminal vector and exact error.
  - [x] Extend `comments-fragment-vectors.spec.ts` for original counter domain and encoded bytes.
  - [x] Keep `scope-grant-modules.spec.ts` green: memory registration and read/write grant accepted.
- [x] **Lot 2 — Implementation**
  - [x] Add `src/storage/u64.ts` validator, codec and types.
  - [x] Add opt-in consumed counter/version and atomic comparison/allocation paths in `contracts.ts`, `atomic.ts`, `backend.ts`.
  - [x] Extend `instance-ownership.ts` epoch to exact u64; keep public shape and contract identity.
  - [x] Preserve `common-contract.ts` v1 allowlist; no PG migration; no domain widening.
- [ ] **Lot 3 — Final validation**
  - [x] `make scope-check` before each commit; commits under 150 lines via `make commit`.
  - [x] Scoped suites green: u64 (8), ownership (9+3 skip), representation (5), common-rule (11), grants (3), comments-fragment (4); build, typecheck, lint green.
  - [x] E2 lanes green locally: mechanical (CI-equivalent vars), wiring, memory (76), common, grants, postgres (51+2 skip).
  - [x] Opus r1 P2 fixes: corpus vectors driven from `u64-contract.spec.ts`; u64 aggregate/guard/version validators covered; `common-rule/vectors.ts` extended; strict fragment counter assertion; failure description corrected.
  - [x] Build/pack/install evidence: `build-cluster-mesh` green, `pack-cluster-mesh` green (`0.23.0-dev.2` mode=block); lazy install gate blocked by pre-existing fixture peer `llm-gateway@0.21.1` 404 (out of scope).
  - [ ] Push new commits and verify E2 qualification green on PR #763 without merging (merges only after #758).
