# Feature: engram L6a — explicit live host declarations and registration persistence (S seat)

## Objective
- [ ] Deliver the sentropic (S) seat of engram plan L6a: durable live workspace declaration registration in `@sentropic/cluster-mesh` (bind to workspace fingerprint + revision, replay after projection loss, withdrawal that cancels deferred work and requests a private purge without deleting committed history) and product declaration persistence in the app control schema (authorized code-workspace bindings without changing membership or enrollment).
- [ ] RED first, then GREEN; contract work runs without a live DB or projection provider (injected ports only).

## Scope / Guardrails
- [ ] Scope limited to `packages/cluster-mesh` live-storage registration + its spec, and the api live declaration control table, migration and Postgres store service.
- [ ] One migration max in `api/drizzle/control/*.sql` (`0010_live_git_declarations.sql`; first free number on main, `0009` reserved by an unmerged cowork branch).
- [ ] Make-only workflow, no direct Docker commands.
- [ ] Branch development happens in isolated worktree `tmp/worktrees/live-git-l6a-s` (branch `feat/live-git-l6a-s`).
- [ ] Automated test campaigns run on `ENV=test-live-l6a-s` with `API_PORT=9455 UI_PORT=5655 MAILDEV_UI_PORT=1555`, never on root `dev`.
- [ ] In every `make` command, `ENV=test-live-l6a-s` is passed as the last argument.
- [ ] All new text in English.

## Branch Scope Boundaries (MANDATORY)
- [ ] **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/src/live-storage/registration.ts`
  - `packages/cluster-mesh/tests/live-registration.spec.ts`
  - `packages/cluster-mesh/package.json`
  - `package-lock.json`
  - `api/src/services/cluster-mesh/live-declarations.ts`
  - `api/src/db/control-schema.ts`
  - `api/drizzle/control/0010_live_git_declarations.sql`
  - `api/drizzle/control/meta/_journal.json`
- [ ] **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `api/tests/**`
  - `packages/cluster-mesh/src/**` (except `live-storage/registration.ts`)
  - `api/src/**` (except `services/cluster-mesh/live-declarations.ts` and `db/control-schema.ts`)
  - `api/drizzle/**` (except `control/0010_live_git_declarations.sql` and `control/meta/_journal.json`)
- [ ] **Conditional Paths**: none.
- [ ] **Exception process**: none required; no conditional or forbidden path touched. `packages/cluster-mesh/package.json` + `package-lock.json` are the workflow-mandated version bump for a `packages/cluster-mesh/src` change.

## Feedback Loop
- [ ] `deferred` (S, engram L6a): the engram-live L6a contract `645d2f13` was REJECTED by Sol; a revised SHA will move revocation to a unique `declarationId` (attached to `cloneId`/`worktreeId`), add identity-uncertainty states (`shallow_history`, `no_history`) with optional fingerprints, make product binding the full workspace/issuer/revision triple with strictly increasing revision, and export ONE canonical id derivation. Per the conductor UPDATE this branch builds only what does not depend on those fields (control table, migration, replay, purge/withdrawal mechanics) and keeps identity fields behind the thin adapter in `api/src/services/cluster-mesh/live-declarations.ts`; swapping the revised contract touches that adapter (and the registration DTOs) only.

## AI Flaky tests
- [ ] Acceptance rule: none expected; no AI/provider-dependent test in scope. If a flaky failure appears, record command + failing file + signature here and treat as blocking when related to this branch.

## Orchestration Mode (AI-selected)
- [ ] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: single orthogonal seat (S) of plan lot L6a; E and H seats live in their owning repositories.

## UAT Management (in orchestration context)
- [ ] **Mono-branch**: no UI change; no user UAT required for this branch.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`, `plan/BRANCH_TEMPLATE.md`, plan `09-BRANCH_LIVE_GIT_INDEXING.md` L6a, engram-live `contracts.ts`/`registration.ts` at `645d2f13` (read-only).
  - [x] Verify branch `feat/live-git-l6a-s`, base `origin/main` `dc95f7e4f`; `harness check branch` PASS.
  - [x] Environment mapping: `ENV=test-live-l6a-s`, `API_PORT=9455`, `UI_PORT=5655`, `MAILDEV_UI_PORT=1555`; `ENV` last in every make command.
  - [x] Confirm scope boundaries (Allowed/Forbidden/Conditional); no exception required.

- [x] **Lot 1 — RED: cluster-mesh live registration spec**
  - [x] Add `packages/cluster-mesh/tests/live-registration.spec.ts` with the three L6a RED cases: declarations bind workspace fingerprint and revision and replay after projection loss; removal cancels delayed work and requests private purge without deleting committed history; product declarations use authorized code-workspace bindings without changing membership or enrollment.
  - [x] Scoped run shows the expected RED failures (module absent): `make test-cluster-mesh SCOPE=packages/cluster-mesh/tests/live-registration.spec.ts API_PORT=9455 UI_PORT=5655 MAILDEV_UI_PORT=1555 ENV=test-live-l6a-s`.
  - [x] Lot gate: RED evidence recorded in commit; `make scope-check ... ENV=test-live-l6a-s`.

- [x] **Lot 2 — GREEN: cluster-mesh live declaration registration module**
  - [x] Implement `packages/cluster-mesh/src/live-storage/registration.ts`: data-pure declaration/withdrawal DTOs mirroring the engram-live L6a contract, `LiveDeclarationStorePort` (save/find/list/status/recordWithdrawal), deferred-work cancellation and private-purge ports, replay seam after projection loss, revision increments of exactly one, non-activating lifecycle classification, product binding trio coherence (server/issuer, workspace/fingerprint pair, binding revision).
  - [x] Scoped run green: `make test-cluster-mesh SCOPE=... ENV=test-live-l6a-s`.
  - [x] Lot gate:
    - [x] `make typecheck-cluster-mesh API_PORT=9455 UI_PORT=5655 MAILDEV_UI_PORT=1555 ENV=test-live-l6a-s`.
    - [x] `make test-cluster-mesh API_PORT=9455 UI_PORT=5655 MAILDEV_UI_PORT=1555 ENV=test-live-l6a-s` (full package suite).
    - [x] `make scope-check ... ENV=test-live-l6a-s`.

- [x] **Lot 3 — API product persistence: control table, migration, Postgres store**
  - [x] Add `control.live_git_declarations` to `api/src/db/control-schema.ts` (explicit `'live'` capability check, withdrawal reason and withdrawal coherence checks, no cross-namespace FK; per the conductor UPDATE, no contract identity field is a key column — declaration and withdrawal documents are stored as jsonb behind a thin identity adapter so the revised contract can be swapped without touching the schema).
  - [x] Add migration `api/drizzle/control/0010_live_git_declarations.sql` + `api/drizzle/control/meta/_journal.json` entry (first free number on main; `0009` reserved by unmerged cowork branch).
  - [x] Implement `api/src/services/cluster-mesh/live-declarations.ts`: Postgres `LiveDeclarationStorePort` adapter — thin identity adapter typed against the contract, save/find/list/status/recordWithdrawal, list returns declared rows only, withdrawal records the private-purge request and never deletes committed rows; product binding trio coherence stays in the cluster-mesh registration validators (not frozen in DDL).
  - [x] Export the registration module through a `./live-storage/registration` subpath in `packages/cluster-mesh/package.json` (root `index.ts` is outside this branch's scope).
  - [x] Lot gate:
    - [x] `make typecheck-api API_PORT=9455 UI_PORT=5655 MAILDEV_UI_PORT=1555 ENV=test-live-l6a-s`.
    - [x] Scoped API tests: `make test-api-endpoints SCOPE=tests/api/cluster-mesh-migration.test.ts API_PORT=9455 UI_PORT=5655 MAILDEV_UI_PORT=1555 ENV=test-live-l6a-s` (16 passed; `control.live_git_declarations` verified applied in the test database).
    - [x] `make scope-check ... ENV=test-live-l6a-s`.

- [ ] **Lot 4 — Package version bump**
  - [ ] Bump `packages/cluster-mesh/package.json` (minor: new live-storage feature) with pre-bump registry check strictly greater than the published version; update `package-lock.json` workspace entry.

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] No `spec/BRANCH_SPEC_EVOL.md` used; nothing to consolidate.

- [ ] **Lot N — Final validation**
  - [ ] Typecheck & lint for impacted components.
  - [ ] Retest scoped cluster-mesh suite (cf Lot 2) and scoped api suite (cf Lot 3).
  - [ ] Bumped `packages/cluster-mesh/package.json` version for the changed `packages/cluster-mesh/src/**` (enforced by CI `enforce-package-bump`).
  - [ ] Push branch `feat/live-git-l6a-s`; open DRAFT PR to `main` (never merge); verify CI.
  - [ ] `make down API_PORT=9455 UI_PORT=5655 MAILDEV_UI_PORT=1555 ENV=test-live-l6a-s`.
  - [ ] Report `.h2a/build/l6a_s_report.md`.
