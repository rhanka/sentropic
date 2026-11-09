# Feature: artifact builder workspace-scoped installs

## Objective
Add per-repository `installWorkspaces` so a workspace app (radar-immobilier P1 `ui`) installs only its root-lockfile subset instead of the whole monorepo lockfile.

## Scope / Guardrails
- Worktree tmp/worktrees/install-workspace-scope on branch feat/artifact-builder-install-workspaces from origin/main 67205fe00 (watchdog #982 merged in), verified before any action.
- ENV=test-install-ws always last, API_PORT=8923, UI_PORT=5323, MAILDEV_UI_PORT=1223; Docker only via .tmp/packets/docker-slot.sh in the foreground, one slot per command, never nested.
- Never ENV=dev, no Python, make commit only with no trailer, under 150 lines per commit.
- Generic api only, no app-specific code, no legacy fallback, frozen binding contract unchanged.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/artifacts/live/forge-binding.ts`
  - `api/src/services/artifacts/live/workspace-subset.ts`
  - `api/src/services/artifacts/live/recipes.ts`
  - `api/src/services/artifacts/live/cache.ts`
  - `api/src/services/artifacts/live/forge-lease.ts`
  - `api/src/services/artifacts/live/supervisor-install.ts`
  - `api/src/services/artifacts/live/bootstrap-deps.ts`
  - `api/tests/unit/artifacts-live/forge-binding.test.ts`
  - `api/tests/unit/artifacts-live/workspace-subset.test.ts`
  - `api/tests/unit/artifacts-live/cache.test.ts`
  - `api/tests/unit/artifacts-live/forge-lease.test.ts`
  - `api/tests/unit/artifacts-live/supervisor-install.test.ts`
  - `api/tests/unit/artifacts-live/bootstrap-deps.test.ts`
  - `api/tests/unit/artifacts-live/install-workspaces.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
  - `api/drizzle/*.sql` (max 1 file)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop

## AI Flaky tests
- [ ] Acceptance rule: non-systematic provider/network/model nondeterminism only, with same-commit success; never amend timeouts; record command + file + signature here; user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: single api-only feature, one branch, one CI.

## UAT Management (in orchestration context)
- [ ] **Mono-branch**: no UI change, no UAT; qualification is scoped unit tests plus CI.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read rules/MASTER.md, rules/workflow.md, rules/testing.md, .tmp/packets/COMMON-RULES.md, watchdog report .tmp/rv/fix-install-timeout.md.
  - [x] git fetch origin; worktree tmp/worktrees/install-workspace-scope on feat/artifact-builder-install-workspaces rebased on origin/main 67205fe00 (watchdog #982 merged in).
  - [x] Verify branch, ENV=test-install-ws, ports 8923/5323/1223.
  - [x] Confirm scope and guardrails.
- [x] **Lot 1 — Workspace subset core**
  - [x] New api/src/services/artifacts/live/workspace-subset.ts: safe names, declared-workspace validation, subset rule, inventory filter.
  - [x] forge-binding.ts: optional installWorkspaces per repository, shape plus traversal checks.
  - [x] recipes.ts: installRecipeFor with workspace flags, frozen base unchanged.
  - [x] Lot gate:
    - [x] `make typecheck-api ENV=test-install-ws` green (tsc --noEmit exit 0).
    - [x] `make lint-api ENV=test-install-ws` green (0 errors, 245 pre-existing warnings outside live/).
    - [x] **API tests**
      - [x] New api/tests/unit/artifacts-live/workspace-subset.test.ts with fixture monorepo lockfile.
      - [x] Update api/tests/unit/artifacts-live/forge-binding.test.ts for installWorkspaces validation.
      - [x] Scoped runs while evolving tests: `make test-api-unit SCOPE=tests/unit/artifacts-live/workspace-subset.test.ts ENV=test-install-ws`
      - [x] Sub-lot gate: scoped cache plus binding suites green.
- [x] **Lot 2 — Cache, lease, supervisor, pod**
  - [x] cache.ts: CacheIdentity carries installWorkspaces, key includes selection, acquire filters to subset after full lock validation.
  - [x] forge-lease.ts: snapshot validates selection against root package.json, sets identity and policyRevision from workspace recipe.
  - [x] supervisor-install.ts: accept workspace recipe, forward workspaces to the pod.
  - [x] bootstrap-deps.ts: run npm ci with workspace flags, subset coverage check stays strict.
  - [x] Lot gate:
    - [x] `make typecheck-api ENV=test-install-ws` green (tsc --noEmit exit 0).
    - [x] `make lint-api ENV=test-install-ws` green (0 errors, 245 pre-existing warnings outside live/).
    - [x] **API tests**
      - [x] New api/tests/unit/artifacts-live/install-workspaces.test.ts: subset correctness incl transitive and links, integrity preserved, cache key differs, unknown workspace refused.
      - [x] Update api/tests/unit/artifacts-live/cache.test.ts, forge-binding.test.ts, bootstrap-deps.test.ts fixtures for the new identity field (forge-lease and supervisor-install tests need no change: subset matchers).
      - [x] Scoped runs while evolving tests: `make test-api-unit SCOPE=tests/unit/artifacts-live/install-workspaces.test.ts ENV=test-install-ws`
      - [x] Full `tests/unit/artifacts-live/` directory: 55 files, 391 tests green.
- [ ] **Lot N-1 — Docs consolidation**
  - [ ] No spec consolidation needed (no spec file touched).

- [ ] **Lot N — Final validation**
  - [x] Typecheck & Lint (both green, see Lots 1-2 gates)
  - [x] Retest API (cf Lot1, copy checklist): full artifacts-live directory green
  - [x] Retest e2e (no e2e change: api-only builder feature, no e2e update)
  - [ ] Retest AI flaky tests (non-blocking only under acceptance rule) and document pass/fail signatures in `BRANCH.md`
  - [ ] Record explicit user sign-off if any AI flaky test is accepted
  - [ ] `packages/<pkg>/package.json` bump: N/A (api-only branch, no `packages/*/src/**` change; `enforce-package-bump` does not trigger).
  - [x] Final gate step 1: create/update PR using `BRANCH.md` text as PR body (source of truth): PR #985.
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers (CI run 42705976678 in progress on head 609823af6).
  - [ ] Final gate step 3: Do NOT merge (conductor owns the merge); leave `BRANCH.md` in place and report.
