# Feature: Engram E0 C6 asset freeze

## Objective
- [ ] Freeze the neutral declaration surface and additive asset mapping against installed Engram 0.21.1, preserving semantic digest `sha256:dff737ced37d801ef48bb4d7088fc4fbc92021d21fe2034ff33ea643b49bec28`.

## Scope / Guardrails
- [x] Approved specification: root `.tmp/engram-e2-host-tuple/plan.md`, revision 3, E0 only; PostgreSQL first under E2-Q1.
- [x] Branch `feat/cluster-mesh-engram-e0`; worktree `tmp/worktrees/mem-e0`; integration base `6c3f9f04a`; author codex / gpt-6.1-sol / high.
- [x] Make only; `ENV=test-e2-int` last; no Python; no publication or merge.
- [x] Serialize Docker/test steps with the shared lock; existing Compose targets only; `make down` after each step.
- [x] Preserve P2 `2b85ff28b6fe06bda0abcdc19255f61a1ed1e4b7cfbb40c2e881c98dd234424b`; stop if an authored change alters it.
- [x] Specific-file staging; `make commit` only, each below 150 changed lines, without attribution trailers.
- [x] Owner assigns this topic's unique pack-only `0.23.0-dev.1`; final declaration packaging remains serially assigned to the integrator.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `PLAN.md`
  - `packages/cluster-mesh/src/engram-memory/neutral-contract.ts`
  - `packages/cluster-mesh/assets/storage/engram-memory/**`
  - `packages/cluster-mesh/tests/engram-memory/contract-vectors.spec.ts`
  - `packages/cluster-mesh/tests/engram-memory/binding-compatibility.spec.ts`
  - `packages/cluster-mesh/tests/engram-memory/neutral-contract-types.ts`
  - [x] Inherited from integration #767/#774 (fixture alignment and installed-comments pack-only dev gates): `packages/cluster-mesh/tests/fixtures/reserved-versions.ts`, `packages/cluster-mesh/tests/modules/registry.spec.ts`, `packages/cluster-mesh/tests/packaging/prepare-artifacts.spec.ts`, `packages/cluster-mesh/tests/storage/installed-bare.mjs`, `packages/cluster-mesh/tests/storage/pack-only-dev-gate.mjs`, `packages/cluster-mesh/tests/storage/pack-only-dev-gate.spec.ts`, `packages/cluster-mesh/tests/storage/postgres.mk`.
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.github/workflows/**`
  - `.cursor/rules/**`
  - `.track/**`
  - `packages/artifacts/**`
  - `packages/cluster-mesh/src/storage/**`
  - `tools/memory-mcp-l5/artifacts/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `packages/cluster-mesh/package.json`
  - `package-lock.json`
- **Exception process**:
  - [x] BR0-EX1 (owner-authorized): serial pack-only package.json/root lock bump to unique 0.23.0-dev.1; satisfies topic bump gate, never published; rollback both version fields together.

## Feedback Loop
- [x] Owner update closes common-rule/Immo E2-D1 and Comments ACK gate; retained ACK in root `.tmp/engram-e2-host-tuple/e0-entry-check-2026-10-26.md`.
- [x] Integration-target bump probes retained; positive https://github.com/rhanka/sentropic/actions/runs/40314659239 at `e6a62bf52`: bump and E2 qualification job `121545389429` passed; publishers disabled.
- [x] Entry gates satisfied by owner update plus actual fail/pass probe; add neutral effect, grant, descriptor and fence-proof data types from the installed declaration.
- [x] Freeze transaction reads/effects, flat handle, grant-bound handle and sync/async binding, including optional original-result recovery.
- [x] Close constructor-option declarations locally (scope, clock, deadline, work limits); inventory installed structural error codes and terminal fence failures.
- [x] Reconcile the 0.21.0 handoff with exact 0.21.1 tarball/declaration hashes; add six additive mappings and complete surface inventory; preserve historical manifest/profile assets byte for byte.
- [x] Installed constructor/full-handle type fixture and standalone declaration emission/strict compilation pass; sync/async typed fence refusals pass (binding suite 12/12).
- [x] Contract vectors check additive identity/mapping, exact installed three-file declaration closure and unchanged semantic digest; local memory suite 76/76 across 11 files, zero skips/todos.
- [x] Negative probe: https://github.com/rhanka/sentropic/actions/runs/40314176780 at `6ff00cfff`; enforce-package-bump job `121542495040` failed on unchanged cluster-mesh 0.22.2.
- [x] Allocation: registry latest 0.22.1; 0.23.0 and 0.23.0-dev.1 return 404; no other E2 topic ref, 2026-10-26. 0.23.0-dev.1 exceeds registry/base and is reserved for E0 only.
- [x] Register E0 dependencies, worktree/BRANCH and environment ownership in PLAN.md within this PR.
- [x] Negative-probe source: initial C6 identity inventory only; package version unchanged from the actual integration base (0.22.2).
- [x] Owner sanctions `test-e2-int`; E0 exclusively owns that Compose qualification project while holding the shared Docker lock; no host ports published.
- [x] Integration fast-forwarded and pushed to main `6c3f9f04a`; no conflict or P2 change. #709 succession: E6 projection, E7 binding, E10 installed qualification; SQLite checkpoint 2026-10-30.
- [x] Admission probe was limited to C6 identity metadata plus the required version bump; complete declarations/tests followed the positive admission receipt. P2 never changed.
- [x] Local lint-cluster-mesh passed after memory 76/76; both steps use the locked E2 Compose route and cleanup.
- [ ] Engram producer ACK remains pending conductor relay; Sentropic freeze reference `b588dccbc`. No joint producer agreement or C9/L5 acceptance is claimed.
- [ ] Release-integrator handoff: admission run's broader validate-cluster-mesh fails registry Comments admission and selected fixture alignment on pack-only 0.23.0-dev.1 (jobs/121545389738); E2 qualification passes. Scope: integration-owned frozen Comments separation and selected installed tuple. Acceptance: full registry/packaging checks pass on the intended separate tuples without forced peers or widening. E0 does not alter those fixtures or claim installed acceptance.
- [x] Admission run's API lint failed npm installation with ECONNRESET (jobs/121545388775); final push starts a fresh run. No API source changes are indicated by that log.

## AI Flaky tests
- [x] No AI tests or flaky waiver applies.

## Orchestration Mode (AI-selected)
- [x] Multi-branch: one E0 topic targets the integration branch; serial metadata writer; no delegated implementation.

## UAT Management (in orchestration context)
- [x] No web, Chrome or VS Code changes; qualify declaration and installed constructor compatibility.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Entry gates**
  - [x] Read Docker lock, rules, approved plan and P2 binding; mechanical branch check passes.
  - [x] Verify #755 landing and ancestry; align existing clean E0 worktree with integration.
  - [x] Close Feedback Loop admission blockers; refresh registry/version allocation and retain actual-base fail/pass probes.
- [ ] **Lot 1 — E0 C6 asset freeze**
  - [x] Reconcile installed 0.21.1 constructor/options, full handle/errors, u64 limits and five profiles against the handoff.
  - [x] Add neutral-contract.ts and additive inventory/equivalence assets.
  - [ ] Freeze name `engram-memory-neutral-contract`, version `1.0.0`, intended path `contracts/engram-memory-neutral-contract-v1.d.ts` with both producers.
  - [x] Extend contract-vectors.spec.ts and binding-compatibility.spec.ts; add independently compilable neutral-contract-types.ts structural checks.
  - [x] Preserve the exact semantic digest; final emitted bytes, runtime/profile equivalence and backend acceptance remain pending.
- [ ] **Lot 2 — Docs consolidation and final validation**
  - [x] Consolidate the Sentropic freeze and interim conductor reply in assets/storage/engram-memory/C6-FREEZE.md; ACK remains pending.
  - [ ] Run permitted Compose build/typecheck/lint/scoped tests and current-head E2 qualification with receipts; scope-check before each commit.
  - [ ] Push and open draft PR using this BRANCH.md; verify E2 qualification green without merging.
  - [ ] Supply actual producer freeze reference and §6 interim reply through the conductor; request and retain identity acknowledgement.
