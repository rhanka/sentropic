# Feature: build-only seeding for never-reconciled bindings

## Objective
Let the first publication of a new artifact run build-only from its admitted host job when the binding was never reconciled, and retire a REVIVING runtime with a gone pod to DORMANT on the scheduler tick.

## Scope / Guardrails
- Scope limited to builder live service seeding, tick retire, live-host job contract, scoped unit tests.
- No migration in `api/drizzle/*.sql`.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/worktrees/build-only-seeding`.
- Automated test campaigns must run on dedicated environments (`ENV=test-build-seed`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/services/artifacts/live/build-only.ts`
  - `api/src/services/artifacts/live/controller.ts`
  - `api/src/services/artifacts/live/ports.ts`
  - `api/src/services/artifacts/live/service.ts`
  - `api/src/services/artifacts/live/remote-host.ts`
  - `api/src/services/artifacts/live/README.md`
  - `api/tests/unit/artifacts-live/fixture.ts`
  - `api/tests/unit/artifacts-live/job-admission.test.ts`
  - `api/tests/unit/artifacts-live/controller.test.ts`
  - `api/tests/unit/artifacts-live/remote-drafts.test.ts`
  - `api/tests/unit/artifacts-live/remote-host.test.ts`
  - `packages/artifacts/src/live-host/recheck.ts`
  - `packages/artifacts/src/mcp-core.ts` (provider version tracks the bump; same file as release f395a897f)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json` (follow 0.2.26, precedent 8c2e210d4)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json` (same)
  - `packages/cluster-mesh/tests/packaging/artifacts-tuple.spec.ts` (pin integrity, precedent 42d6224f2)
  - `packages/artifacts/tests/live-host-recheck.test.ts`
  - `packages/artifacts/tests/live-host-accept.test.ts`
  - `packages/artifacts/package.json`
  - `package-lock.json`
  - `api/package-lock.json`
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
- [x] Scope extension (no EXn: unknown→allowed, same files as release f395a897f/8c2e210d4): the 0.2.26 bump requires `mcp-core.ts` (probe asserts provider version), `api/package-lock.json` sync, and the cluster-mesh selected fixture + tuple pin (prepare-artifacts.spec + pin test assert the candidate tuple). Added to Allowed Paths.
- [ ] CI security-container UI/e2e: 2 HIGH libxslt findings (CVE-2026-87636, CVE-2026-9947, base image, no Dockerfile pin) unrelated to this diff; needs a security-lane decision (dedicated branch or register entry with owner + review_by). Not touched from this lane.

## AI Flaky tests
- [ ] Acceptance rule: accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
- [ ] No AI suites touched by this branch; none run.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: single PR on origin/main (rebased after #994 merged, stacking dropped), one test cycle, no sub-workstreams.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- No UI changes in this branch, no UAT surface.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read rules/MASTER.md, rules/workflow.md, rules/testing.md, .tmp/packets/COMMON-RULES.md.
  - [x] Create isolated worktree tmp/worktrees/build-only-seeding on fix/artifacts-build-only-seeding stacked on origin/fix/artifacts-binding-unreconciled.
  - [x] Copy root .env into worktree, set ENV=test-build-seed API_PORT=8937 UI_PORT=5337 MAILDEV_UI_PORT=1237.
  - [x] Replace inherited BRANCH.md with this lane scope (finalize scope boundaries with make scope-check).
- [x] **Lot 1 — Host job carries the binding owner**
  - [x] Extend HostJob and HostRecheckView binding with ownerId, populate in resolvePendingJob.
  - [x] Require ownerId in builder remote-host job validation.
  - [x] Update package tests live-host-recheck and live-host-accept.
  - [x] Bump packages/artifacts to 0.2.26 and sync lock version lines.
  - [x] Lot gate:
    - [x] `make typecheck-api API_PORT=8937 UI_PORT=5337 MAILDEV_UI_PORT=1237 ENV=test-build-seed`: pass (rebased head, observed exit 0)
    - [x] **API tests** (`make test-api-unit SCOPE=tests/unit/artifacts-live ... ENV=test-build-seed`): 57 files, 447 tests passed
      - [x] `api/tests/unit/artifacts-live/job-admission.test.ts` (seed path, no-job refusal, monotonic fence)
      - [x] `api/tests/unit/artifacts-live/controller.test.ts` (REVIVING retire)
      - [x] `api/tests/unit/artifacts-live/remote-drafts.test.ts` (unchanged, regression green)
      - [x] `api/tests/unit/artifacts-live/remote-host.test.ts` (ownerId validation)
    - [x] **Package tests**: live-host-recheck 23 passed, live-host-accept 9 passed
- [x] **Lot 2 — Build-only seeding and REVIVING retire**
  - [x] Add LivePorts seedBinding wired to remote reconciled.
  - [x] Seed binding view from admitted job on binding_unreconciled, fail closed otherwise.
  - [x] Retire REVIVING with gone or failed pod to DORMANT on scheduler tick.
  - [x] Update live README seeding paragraph.
  - [x] Lot gate: same scoped unit tests as Lot 1.
- [ ] **Lot 3 — Final validation**
  - [ ] Typecheck API.
  - [ ] Retest scoped API suites.
  - [ ] Bumped packages/artifacts/package.json version (0.2.26) for changed src, enforced by CI enforce-package-bump.
  - [x] Final gate step 1: create PR on origin/main using BRANCH.md text as PR body (PR #995, draft).
  - [ ] Final gate step 2: run and verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once CI is green, commit removal of BRANCH.md, push, do not merge.
