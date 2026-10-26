# Feature: UP-T shared PostgreSQL activation adapter (0.2.3)

## Objective
- [ ] Deliver one durable activation adapter for app W1.c/W3.a and Radar M1-P S1/A6.

## Scope / Guardrails
- [x] Branch `feat/artifacts-up-t`, worktree `tmp/worktrees/artifacts-up-t`, base `origin/main`; merge only, never rebase.
- [x] Additive public API; L3 publication coordinator and listKeys parity remain separate.
- [x] Docker lock for every build/test, cleanup after each step; no Python; English artifacts.
- [x] `ENV=test-artifacts-upt` last; existing qualification compose file, without host ports.
- [x] Pack-only 0.2.3 bump; CI publication after owner GO; draft PR, never merge.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/src/adapters/postgres-activation.ts`
  - `packages/artifacts/sql/0001_activation.sql`
  - `packages/artifacts/tests/postgres-activation.test.ts`
  - `packages/artifacts/tests/postgres-activation.integration.test.ts`
  - `packages/artifacts/tests/fixtures/activation-process.mjs`
  - `packages/artifacts/package.json`
  - `packages/artifacts/README.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `api/**`
  - `plan/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] BR861-EX3 authorized by owner: shared adapter/SQL/tests; additive only; rollback disables activation and retains SQL.

## Feedback Loop
- [x] BR861-EX3: existing TicketStore plus browser-flow port; namespace binding, immutable IDs, <=60s lifetime, leased transaction, database clock after waits, no grant on uncertain COMMIT.
- [x] Hosts own authority locks, migration/journal, scheduling, rotation and serving policy; restore invalidates activation state and rotates signing keys before serving.

## AI Flaky tests
- [x] No AI-dependent tests or accepted flakes.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; one package writer, no cherry-picks.

## UAT Management (in orchestration context)
- [x] Package conformance only; host/browser/deployment qualification stays with W3.a/A6.

## Plan / Todo (lot-based)
- [x] Lot 0: read lock/rules/specs/template; create isolated worktree; mechanically check branch.
- [ ] Lot 1: filenames frozen above; tests first for namespace/bindings, collisions, expiry, commit visibility and uncertainty.
- [ ] Lot 2: versioned SQL, TicketStore/flow port, atomic consume, bounded cleanup and invalidation.
- [ ] Lot 3: real PG vectors: two OS processes, restart, race, pre/post-commit crash, restore; no skipped vectors.
- [ ] Lot 4: exact imports and authority/restore obligations; merge main again after #759.
- [ ] Lot 5: separate pack-only 0.2.3 bump; typecheck/lint/unit/integration/pack gates.
- [ ] Lot 6: scope-check before atomic commits (<150 lines); push; draft PR body from this file; CI green; do not merge.
