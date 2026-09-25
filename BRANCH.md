# Feature: BRERAD — Eradicate CLI, build-cli and focus from sentropic

## Objective
Remove `packages/cli` (`@sentropic/cli`, `stp`), `packages/build-cli` (`@sentropic/build-cli`) and `packages/focus` (`@sentropic/focus`) from sentropic, remove every API use of focus, and add a durable CI guard. CLI = h2a; focus is h2a-owned and h2a consumes the published `@sentropic/focus@0.3.0`.

## Scope / Guardrails
- Scope limited to the three package deletions, API focus removal, CI/Makefile wiring removal, lockfile refresh, CI guard, one rule line and live doc pointers.
- No migration in `api/drizzle/*.sql` (focus-only table `track_owner_signatures` kept; owner follow-up).
- No npm registry action of any kind (no publish, unpublish, deprecate, dist-tag).
- `packages/cluster-mesh/**` is not touched (catalog handled by cluster-mesh 0.13.0).
- Make-only workflow, no direct Docker commands.
- Branch development in isolated worktree `tmp/chore-eradicate-cli-focus`.
- Automated tests on `ENV=test-chore-eradicate-cli-focus` with `API_PORT=9195 UI_PORT=5395 MAILDEV_UI_PORT=1295`, never on `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/cli/**`
  - `packages/build-cli/**`
  - `packages/focus/**`
  - `api/package.json`
  - `api/package-lock.json`
  - `api/vitest.config.ts`
  - `api/src/app.ts`
  - `api/src/routes/namespaces/focus.ts`
  - `api/src/routes/namespaces/focus-cutover.ts`
  - `api/src/services/focus/**`
  - `api/tests/**`
  - `e2e/tests/10-cluster-mesh-control-plane.spec.ts` (namespace inventory drops `/focus`)
  - `scripts/ci/**`
  - `rules/MASTER.md`
  - `rules/workflow.md` (frozen-package line)
  - `track/TRACK.md`
  - `PLAN.md`
  - `spec/SPEC_VOL_FOCUS.md`
  - `spec/SPEC_EVOL_STP_FEDERATION.md`
  - `spec/SPEC_EVOL_BUILD_APP_CLI.md`
  - `ui/**` (only callers of removed focus routes)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/cluster-mesh/**`
  - `plan/done/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile` (BRERAD-EX1)
  - `.github/workflows/ci.yml` (BRERAD-EX2)
  - `api/Dockerfile` (BRERAD-EX3)
  - `package.json`, `package-lock.json` (BRERAD-EX4)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- [x] `acknowledge` BRERAD-EX1 `Makefile`: remove cli/build-cli/focus lanes, focus build dependencies, `owner-sign` target (posts to removed `/focus` route); add `check-eradicated-packages`. Impact: build/test lanes only. Rollback: `git revert`.
- [x] `acknowledge` BRERAD-EX2 `.github/workflows/ci.yml`: remove validate/publish/bootstrap/filter wiring of the three packages; add guard step in `validate-publishable-manifests`. Impact: CI graph only. Rollback: `git revert`.
- [x] `acknowledge` BRERAD-EX3 `api/Dockerfile`: drop focus manifest copy and build. Impact: API image no longer builds focus. Rollback: `git revert`.
- [x] `acknowledge` BRERAD-EX4 `package-lock.json`: regenerated via `make lock-root` after workspace removal; `@sentropic/track` becomes an explicit API dependency (previously hoisted through focus). Impact: dependency graph. Rollback: `git revert`.
- [x] `acknowledge` BRERAD-EX5: pure-deletion commits exceed the 150-line rule (one commit per package, API focus removal). Rollback: `git revert`.
- [x] `attention` owner follow-up: npm deprecation of already-published `@sentropic/cli@0.5.0`, `@sentropic/build-cli@0.2.0` and `@sentropic/focus` (latest published 0.3.0); no registry action taken in this branch (no publish, unpublish, deprecate or dist-tag change).
- [x] `attention` owner follow-up: DB table `track_owner_signatures` is focus-only; no drop migration written.
- [x] `acknowledge` focus source for 0.4.0-0.6.0 (never published) is preserved in git history at `c50c0aabad54680b7f97907d3c062758b63482b1` (last `main` before deletion) for h2a to adopt if needed.
- [x] `acknowledge` `packages/cluster-mesh` has no dependency on `@sentropic/focus`; its catalog keeps inert gated ids `focus`, `cli`, `build-cli` (`source_unavailable`), handled by cluster-mesh 0.13.0 outside this branch.
- [x] `acknowledge` API `/cli` namespace (`productCliModule`, device/CLI auth) is not part of the removed packages and is kept.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: single urgent removal PR, one test cycle.

## UAT Management (in orchestration context)
- **Mono-branch**: no UI change; no UAT surface beyond API boot (typecheck/build/tests).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `plan/BRANCH_TEMPLATE.md` and the three live specs.
  - [x] Create worktree `tmp/chore-eradicate-cli-focus` from `origin/main` `c50c0aabad54680b7f97907d3c062758b63482b1`.
  - [x] Env `ENV=test-chore-eradicate-cli-focus`, ports `API_PORT=9195 UI_PORT=5395 MAILDEV_UI_PORT=1295`.
  - [x] Declare BRERAD-EX1..EX5.

- [ ] **Lot 1 — API focus removal**
  - [x] Remove `/focus` namespace registration from `api/src/app.ts`.
  - [x] Delete `api/src/routes/namespaces/focus.ts`, `api/src/routes/namespaces/focus-cutover.ts`, `api/src/services/focus/**`.
  - [x] Delete tests `api/tests/unit/focus-owner-signature-route.test.ts`, `api/tests/unit/focus-decision-validator.test.ts`, `api/tests/unit/track-event-owner-signature-port.test.ts`, `api/tests/unit/track-owner-signature-adapter.test.ts`, `api/tests/api/cluster-mesh-focus-cutover.test.ts`, `api/tests/helpers/owner-sign-child.ts`.
  - [x] Update `api/tests/api/cluster-mesh-track.test.ts` (local intent type) and `api/tests/api/cluster-mesh-namespace-inventory.test.ts` (no `/focus`) and `e2e/tests/10-cluster-mesh-control-plane.spec.ts` (28 modules).
  - [x] Drop focus from `api/package.json`, `api/package-lock.json`, `api/vitest.config.ts`, `api/Dockerfile`; declare `@sentropic/track` explicitly.
  - [x] Lot gate:
    - [x] `make typecheck API_PORT=9195 UI_PORT=5395 MAILDEV_UI_PORT=1295 ENV=test-chore-eradicate-cli-focus`
    - [x] `make lint API_PORT=9195 UI_PORT=5395 MAILDEV_UI_PORT=1295 ENV=test-chore-eradicate-cli-focus`
    - [x] **API tests**
      - [x] Updated: `api/tests/api/cluster-mesh-track.test.ts`, `api/tests/api/cluster-mesh-namespace-inventory.test.ts`
      - [x] Sub-lot gate: `make test-api-unit API_PORT=9195 UI_PORT=5395 MAILDEV_UI_PORT=1295 ENV=test-chore-eradicate-cli-focus` (980 passed, 2 skipped)
- [x] Scoped: `make test-api-endpoints SCOPE="tests/api/cluster-mesh-track.test.ts tests/api/cluster-mesh-namespace-inventory.test.ts tests/api/cluster-mesh-apps.test.ts" API_PORT=9195 UI_PORT=5395 MAILDEV_UI_PORT=1295 ENV=test-chore-eradicate-cli-focus` (13 passed)
    - [x] **UI tests (TypeScript only)**
      - [x] No UI caller of `/api/v1/focus` exists; no UI test change.
    - [x] **E2E tests**
      - [x] No E2E change; CI e2e groups cover non-regression.

- [x] **Lot 2 — Package deletion and wiring**
  - [x] `git rm -r packages/focus`, `packages/cli`, `packages/build-cli` (one commit each).
  - [x] Remove Makefile lanes (typecheck/test/build/pack/publish/publish-token), `owner-sign`, focus in `API_VERSION`, `install-internal-packages`, `prepare-node-workspace`, `up-api-test-ci`.
  - [x] Remove ci.yml filters, outputs, validate/publish jobs, bootstrap option/step for the three packages.
  - [x] Update `scripts/ci/publishable-manifests.mjs` lists and `scripts/ci/publishable-*.test.mjs` expectations.
  - [x] Regenerate `package-lock.json` with `make lock-root ENV=test-chore-eradicate-cli-focus`.
  - [x] Lot gate:
    - [x] `make test-publishable-manifests ENV=test-chore-eradicate-cli-focus`
    - [x] `make build-api API_PORT=9195 UI_PORT=5395 MAILDEV_UI_PORT=1295 ENV=test-chore-eradicate-cli-focus`

- [x] **Lot 3 — Durable guard**
  - [x] Add `scripts/ci/eradicated-packages.mjs` (Node) + `scripts/ci/eradicated-packages.test.mjs`.
  - [x] Add `make check-eradicated-packages`, wire into `validate-publishable-manifests`.
  - [x] Add one line in `rules/MASTER.md`.
  - [x] Lot gate:
    - [x] Mutation proof: a workspace package named `@sentropic/focus` makes `make check-eradicated-packages ENV=test-chore-eradicate-cli-focus` fail, removal makes it pass.
    - [x] `make test-publishable-manifests ENV=test-chore-eradicate-cli-focus`

- [x] **Lot N-1 — Docs consolidation**
  - [x] Superseded note at top of `spec/SPEC_VOL_FOCUS.md`, `spec/SPEC_EVOL_STP_FEDERATION.md`, `spec/SPEC_EVOL_BUILD_APP_CLI.md`.
  - [x] Pointers in `track/TRACK.md` and `PLAN.md`.

- [x] **Lot N — Final validation**
  - [x] Typecheck & Lint
  - [x] Retest API (cf Lot 1)
  - [x] No package `src/**` changed outside deleted packages (no bump required).
  - [ ] Final gate step 1: create PR using `BRANCH.md` text as PR body.
  - [ ] Final gate step 2: verify branch CI on that PR and resolve blockers.
  - [ ] Final gate step 3: once CI is `OK`, commit removal of `BRANCH.md`, push, and merge.
