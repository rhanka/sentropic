# Feature: Cluster mesh identity core lot A2.2 (tenants, memberships, workspaces, resolution, tid)

## Objective
Implement durable PostgreSQL and SQLite backends for the lot A2.2 identity stores behind the frozen A2.0 ports, with the lot's own specs, without changing contract semantics.

## Scope / Guardrails
- Scope limited to lot A2.2 stores and wiring in `packages/cluster-mesh`.
- No change to `packages/cluster-mesh/src/identity-contracts/` semantics.
- No touch to A2.1 stores (accounts, proofs, invitations, device codes, login sessions) or A2.3 stores (RBAC inputs, cascade, fresh decision, audit/escalation ledger).
- One data migration max: none in this branch (stores only, no app migration).
- Make-only workflow, no direct Docker commands; one Docker build at a time under `flock /home/antoinefa/.cache-tmp/sentropic-docker.lock`.
- Branch development in isolated worktree `tmp/worktrees/cm-identity-a2-2`.
- Automated tests on `ENV=test-cm-a2-2` only, never on root dev; `ENV` last in every make command.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/cluster-mesh/src/identity-stores/**`
  - `packages/cluster-mesh/src/index.ts`
  - `packages/cluster-mesh/tests/identity-a22-*.spec.ts`
  - `packages/cluster-mesh/tests/identity-a22-scenarios.ts`
  - `packages/cluster-mesh/tests/identity-*.spec.ts`
  - `packages/cluster-mesh/package.json`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/**`
  - `packages/cluster-mesh/src/identity-contracts/**`
  - `api/**`
  - `ui/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
  - `packages/cluster-mesh/tests/storage/**`
  - `package-lock.json` (one-line workspace version sync only, under BR22-EX1)
  - `packages/cluster-mesh/tests/fixtures/reserved-versions.ts` (release-train constants only, under BR22-EX2)
  - `packages/cluster-mesh/tests/packaging/prepare-artifacts.spec.ts` (train-state unit rows only, under BR22-EX2)
  - `packages/cluster-mesh/tests/storage/pack-only-dev-gate.spec.ts` (train-state unit rows only, under BR22-EX2)
- **Exception process**:
  - Declare exception ID `BR22-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- [x] BRLOCK-EX1 carried verbatim from `origin/main` for gate continuity (owner=CI maintainers; review_by=2026-11-30T00:00:00Z; this branch exercises the lock scope via the one-line root lockfile workspace version sync under BR22-EX1; remove on PR closure; rollback by reverting this branch).
- [x] BR22-EX1: allow the one-line root `package-lock.json` workspace version sync (`packages/cluster-mesh` entry only) for the CI train lock-sync gate, because the bump gate requires a manifest version change for `src/` changes and the lock-sync gate requires the lockfile entry to match. Rationale: `packages/cluster-mesh/src/identity-stores/` is new source, so `packages/cluster-mesh/package.json` moves `0.25.0` → `0.26.0-dev.0` (next free `-dev.N`; nothing published, sibling lots still at `0.25.0`). Impact: two version strings, no dependency change. Rollback: revert both version strings to `0.25.0`.
- [x] BR22-EX2: allow the release-train constant rollover in `packages/cluster-mesh/tests/fixtures/reserved-versions.ts` and `packages/cluster-mesh/tests/storage/pack-only-dev-gate.mjs` (`RESERVED_NEXT` `0.25.0` → `0.26.0`, `LATEST_PUBLISHED_CLUSTER_MESH` `0.24.0` → `0.25.0`), plus the train-state unit-table rows in `packages/cluster-mesh/tests/packaging/prepare-artifacts.spec.ts` and `packages/cluster-mesh/tests/storage/pack-only-dev-gate.spec.ts` (same value rollover, row intent preserved; untouched rows still evaluate as before), required by the `0.26.0-dev.0` bump so the pack-only dev tolerance keeps matching the frozen `0.25.0` fixture tuple (precedent `eea2cf0a6`). Impact: constants plus eight unit rows; no predicate change. Rollback: revert the constants and the eight rows.

## AI Flaky tests
- No accepted flaky tests; no timeout increases.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: single lot on disjoint store slice; one PR to main.

## UAT Management (in orchestration context)
- [x] No UI surface in this lot; no UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read COMMON-RULES, r2 spec, A2-lots, gap illustration, owner answers.
  - [x] Create worktree `tmp/worktrees/cm-identity-a2-2` on branch `feat/cm-identity-a2-2` from `origin/main`.
  - [x] Run contract suite UNMODIFIED: `tests/identity-lifecycle.spec.ts` (17), `tests/identity-membership.spec.ts` (13), `tests/identity-resolution.spec.ts` (10) — all pass.
  - [x] Confirm scope boundaries and sibling-lot disjointness (A2.1/A2.3 slices untouched; `make scope-check` PASS C2).
- [x] **Lot 1 — Durable backends for the five A2.2 stores**
  - [x] Add `src/identity-stores/schema` DDL for both profiles (tenants, tenant memberships, workspaces, workspace members, oauth consents, service clients).
  - [x] Add PostgreSQL port implementations (`TenantRegistryStore`, `TenantMembershipStore`, `WorkspaceDirectoryStore`, `WorkspaceMembershipStore`, `OAuthTenantStore`).
  - [x] Add SQLite port implementations of the same five ports over `node:sqlite`.
  - [x] Export backend factories from `src/index.ts` (domains stay in `identity-contracts` untouched).
  - [x] Lot gate: `make typecheck-cluster-mesh` + `make lint-cluster-mesh` with `ENV=test-cm-a2-2` last — both pass.
- [x] **Lot 2 — Lot specs on both profiles**
  - [x] Contract suite UNMODIFIED passes against both backends (domains composed over PG/SQLite stores).
  - [x] Uniqueness/alias/transition specs (second enrolment returns existing id, clones join via approved alias, distinct repos stay distinct, repo-less recording, last-admin guard, membership transition table).
  - [x] Shadow-vs-strict replay specs (shadow measures without changing, strict refuses, divergence metrics).
  - [x] Gap-§1 scenario end-to-end (account approved differs from membership approved; forged workspace/tenant ids never yield a tid).
  - [x] Lot gate: targeted `make test-cluster-mesh SCOPE=... ENV=test-cm-a2-2` plus PG lane (49/49 pass), then `make down ENV=test-cm-a2-2`.
- [ ] **Lot N — Final validation**
  - [x] Typecheck & Lint.
  - [x] Retest contract suite plus lot specs on both profiles.
  - [x] Bump gate requires a dev bump (`src/` changes vs base): `packages/cluster-mesh/package.json` `0.25.0` → `0.26.0-dev.0` (next free `-dev.N`) plus the one-line root lockfile sync (BR22-EX1); verified against the CI lock-sync check below.
  - [ ] Final gate step 1: create draft PR to main using `BRANCH.md` text as PR body.
  - [ ] Final gate step 2: ONE CI run on the final head; resolve blockers if the failure is branch-caused.
  - [ ] Final gate step 3: write report to `.tmp/rv/lot-A2.2.md`, then stop without merging.
