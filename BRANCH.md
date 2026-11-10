# Feature: binding unreconciled error code

## Objective
Give a never-reconciled binding its own explicit refusal code at build admission so the host knows to reconcile first.

## Scope / Guardrails
- Scope limited to api live remote session error code, host job reason propagation, live README remote-host section, scoped unit tests.
- One migration max in `api/drizzle/*.sql` (not applicable, no migration).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/worktrees/binding-unreconciled` (even for one active branch).
- Automated test campaigns run on dedicated environments (`ENV=test-binding-unrec`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical under qualification (same HEAD SHA; no extra commits before sign-off).
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/services/artifacts/live/remote-live.ts`
  - `api/src/services/artifacts/live/README.md`
  - `api/tests/unit/artifacts-live/remote-drafts.test.ts`
  - `api/tests/unit/artifacts-live/host-build-api.test.ts`
  - `api/tests/unit/artifacts-live/job-admission.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- [ ] No open items.

## AI Flaky tests
- [ ] Acceptance rule: accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
- [ ] No AI suites touched by this branch; none run.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: One small api-only error-code fix with scoped unit tests.

## UAT Management (in orchestration context)
- [ ] **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- No UI changes in this branch; no UAT required.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`, `.tmp/packets/COMMON-RULES.md`.
  - [x] Create isolated worktree `tmp/worktrees/binding-unreconciled` on branch `fix/artifacts-binding-unreconciled` from `origin/main` (83f2bcc27).
  - [x] Verify branch: `git -C tmp/worktrees/binding-unreconciled branch --show-current` returns `fix/artifacts-binding-unreconciled`.
  - [x] Check PR #992 state: OPEN, not merged, so keep the BRLOCK-EX1 policy line above.
  - [x] Define environment mapping (`ENV=test-binding-unrec`) and ports for this branch.
  - [x] Confirm command style: `make ... ENV=<env>` with `ENV` last; Docker only via `.tmp/packets/docker-slot.sh make ...` in the foreground.
  - [x] Confirm scope and guardrails.
  - [x] Validate scope boundaries (`Allowed/Forbidden/Conditional`); no `BRxx-EXn` needed.
- [ ] **Lot 1 — Explicit binding_unreconciled refusal**
  - [ ] Update `api/src/services/artifacts/live/remote-live.ts`: `session()` throws `LiveError('git_live_conflict', 'binding_unreconciled')` when no row exists; older/other generation keeps `stale_session`.
  - [ ] Verify `api/src/services/artifacts/live/product-builder.ts` binding and `api/src/services/artifacts/live/host-build-api.ts` run need no code change (reason already propagates to the job ledger and `GET /v1/builds/:artifactId/:jobId`).
  - [ ] Document in `api/src/services/artifacts/live/README.md` remote-host section: host must `POST /v1/live/reconcile` once before the first build of an artifact.
  - [ ] Evolve API tests (file-by-file):
    - [ ] Update `api/tests/unit/artifacts-live/remote-drafts.test.ts`: never-reconciled `session()` expects `binding_unreconciled`; fences/other-generation still `stale_session`.
    - [ ] Extend `api/tests/unit/artifacts-live/job-admission.test.ts`: never-reconciled binding refusal at admission creates no pod and leaves the binding dormant.
    - [ ] Extend `api/tests/unit/artifacts-live/host-build-api.test.ts`: build throwing `binding_unreconciled` is carried on the host job record (`GET` shows `code`/`reason`).
  - [ ] Lot gate:
    - [ ] `make typecheck-api ENV=test-binding-unrec` (via `docker-slot.sh`, foreground)
    - [ ] Scoped API tests: `remote-drafts`, `host-build-api`, `job-admission` suites on `ENV=test-binding-unrec`
- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint for impacted components
  - [ ] Retest scoped API suites (cf Lot 1)
  - [ ] Bumped `packages/<pkg>/package.json` version only if `packages/<pkg>/src/**` changed (not applicable, api-only change)
  - [ ] Final gate step 1: create PR with `BRANCH.md` text as body (source of truth), `make commit` only, no trailer
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve blockers (no rerun of required checks, no `[skip ci]`)
  - [ ] Final gate step 3: leave `BRANCH.md` in place (merge prep deletes it only at merge time, which is out of scope: DO NOT merge)
  - [ ] Write French report to `.tmp/rv/binding-unreconciled.md`
