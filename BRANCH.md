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
  - `packages/artifacts/probe/adapter-consumer.mjs`
  - `packages/artifacts/package.json`
  - `packages/artifacts/src/mcp-core.ts` (version constant only)
  - `package-lock.json` (artifacts workspace version only)
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
- [x] BR861-EX3 pack-only metadata: synchronize package/provider/workspace-lock versions; impact limited to 0.2.3 identity; rollback retains 0.2.2 metadata.
- [x] Independent review selection-failed: no live model catalog configured; tmp/artifacts-upt-review/dossier.md records evidence. No peer launched or consensus claimed.

## AI Flaky tests
- [x] No AI-dependent tests or accepted flakes.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; one package writer, no cherry-picks.

## UAT Management (in orchestration context)
- [x] Package conformance only; host/browser/deployment qualification stays with W3.a/A6.

## Plan / Todo (lot-based)
- [x] Lot 0: read lock/rules/specs/template; create isolated worktree; mechanically check branch.
- [x] Lot 1: filenames frozen above; tests first for namespace/bindings, collisions, expiry, commit visibility and uncertainty.
  - [x] Red: scoped integration target fails on missing postgres-activation module before implementation (2026-10-26).
  - [x] Add commit acknowledgement and uncertain-commit unit vectors in postgres-activation.test.ts.
  - [x] Correct the SQL unit double to return the ticket for a DELETE containing a flow subquery; real PG vectors pass.
- [x] Lot 2: versioned SQL, TicketStore/flow port, atomic consume, bounded cleanup and invalidation.
  - [x] Versioned SQL: immutable rows, full binding FK, namespace generation, 60s cap and indexed expiry.
  - [x] Companion flow/authority ports and leased transaction boundary; unknown COMMIT destroys the connection.
  - [x] Durable TicketStore and browser-flow storage; immutable inserts, exact association and DB-time expiry.
- [x] Lot 3: real PG vectors: two OS processes, restart, race, pre/post-commit crash, restore; no skipped vectors.
  - [x] Add independent OS-process witness and restart/race/crash tests; execute in the scoped PG gate.
  - [x] Add lock-delayed/authority-delayed expiry, real committed acknowledgement loss and bounded cleanup vectors.
  - [x] Add restored pre-consume snapshot invalidation, fresh authority/flow recovery, SQL immutability and missing migration denial.
  - [x] Scoped gate green: 18/18 tests (4 unit, 14 real PG), 2026-10-26; cleanup completed afterward.
- [ ] Lot 4: exact imports and authority/restore obligations; merge main again after #759.
  - [x] Export the adapter and unchanged versioned SQL; document W1.c/A6 composition and host authority/restore obligations.
- [x] Lot 5: separate pack-only 0.2.3 bump; typecheck/lint/unit/integration/pack gates.
  - [x] Registry pre-bump check: latest 0.2.1; reserve owner-selected 0.2.3 after pending #759/0.2.2, no publication.
  - [x] Separate pack-only bump: package manifest, provider constant and workspace lock set to 0.2.3.
  - [x] Full unit gate: 450/450, 37 suites; scoped UP-T gate: 18/18, zero skips.
  - [x] Typecheck, lint, full integration/E2E (190 tests) and real pack pass; SQL asset hash matches packed bytes.
  - [x] Frozen installed-consumer conformance: probe/adapter-consumer.mjs passes adapter/SQL imports from installed archives (PACKED_ADAPTERS_OK adapters=3 migrations=2 activationSql=1).
  - [x] SQL SHA-256: 13767c826a62aa5f880809ca2ebc60bdc638b2e59f983e195d4351356b282d8b; archive SHA-256: 53d6e84eee49e19fe1ef21468b93dffe6eac2451ee02c21cde539e0b2114828a.
- [ ] Lot 6: scope-check before atomic commits (<150 lines); push; draft PR body from this file; CI green; do not merge.
  - [x] Draft PR #782 targets main; first plan comment posted; CI requested at https://github.com/rhanka/sentropic/actions/runs/40412940723.
  - [x] Package gates use the shared Docker lock; isolated stack removed after each step; no owner environments touched.
