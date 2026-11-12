# Feature: T3 5-minute window driver

## Objective
Deliver a standalone Node window driver (W0..W9) with watchdog, pre-commit rollback, dry-run, schema-checked SQL and fault-injection tests.

## Scope / Guardrails
- Scope limited to T3 window driver under deploy/ci/preprod-a4 and one API schema test.
- No Python anywhere.
- Never write to namespace sentropic; preprod read-only only.
- Secrets by NAME only, never printed, logged or committed.
- Make-only workflow, Docker via docker-slot.sh in foreground.
- ENV=test-t3-driver always last; ports API_PORT=8965 UI_PORT=5365 MAILDEV_UI_PORT=1265.
- One PR, CI green, no merge.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `deploy/ci/preprod-a4/t3-*`
  - `api/tests/api/t3-*`
  - `deploy/ci/artifact-content/tests.mk` (one read-only `-v` mount line for the
    manifests gate so it resolves the same canonical `t3-classify.sql`; see T3-EX1)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
  - `api/drizzle/*.sql`
  - `deploy/k8s/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- **T3-EX1** (declared before use): mount `api/tests/api` read-only into the
  `test-artifact-content-manifests` gate container (`deploy/ci/artifact-content/tests.mk`,
  one `-v` line). Reason: the single canonical `t3-classify.sql` lives under `api/` so the
  CI api image (which ships `api/` but never `deploy/`) can play it against a migrated DB;
  the driver and its node tests resolve the same file, and this gate mounts `deploy/` but
  not `api/`. Impact: gate container gains read-only visibility of api test sources only;
  no behavior change for any other test (verified: no other preprod-a4 test reads `api/`).
  Rollback: delete the one `-v` line.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing file + failure signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.
- [ ] Flaky candidate (unrelated, no merge requested): CI run 43153823649 `test-e2e (5)`,
  `e2e/tests/00-ai-generation.spec.ts` — `Failed to start generation: Impossible de creer
  un brouillon de dossier` + `waitForResponse` 60 s timeout (provider-side signature,
  no UI/chat/generation path touched by this branch). Awaiting re-run on the fixed head
  before any verdict.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: Single lane builds one driver; no orthogonal sub-workstreams.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- **Multi-branch**: no UAT on sub-branches; UAT happens only after integration on the main branch.
- UAT checkpoints must be listed as checkboxes inside each relevant lot (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run tests in `tmp/worktrees/t3-driver`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/top-ai-idees-fullstack`, `ENV=dev`).
  - Switch back to `tmp/worktrees/t3-driver` after UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read rules/MASTER.md, rules/workflow.md, rules/testing.md, COMMON-RULES.md
  - [x] Read plan v4, reviews Fable + Astra v1/v2/v4, fence journal, runbooks, targets.mk
  - [x] Create worktree tmp/worktrees/t3-driver on feat/t3-window-driver from origin/main
  - [x] Verify branch feat/t3-window-driver
  - [x] Record ENV=test-t3-driver, API_PORT=8965 UI_PORT=5365 MAILDEV_UI_PORT=1265
  - [x] Confirm scope and guardrails
- [x] **Lot 1 — Driver core + watchdog + rollback**
  - [x] Add api/tests/api/t3-classify.sql (schema-safe Q1..Q6)
  - [x] Add deploy/ci/preprod-a4/t3-rollback.mjs (JWT_SECRET + SECRET_ENCRYPTION_KEY, real selectors)
  - [x] Add deploy/ci/preprod-a4/t3-window-driver.mjs (W0..W9, budgets, dry-run)
  - [x] Add deploy/ci/preprod-a4/t3-watchdog.mjs (heartbeat, self rollback)
  - [x] Add deploy/ci/preprod-a4/t3-finish-open.mjs (post-commit convergence)
  - [x] Add deploy/ci/preprod-a4/t3-emergency.sh + t3-emergency-classify.mjs (single human command)
  - [x] Lot gate:
    - [x] typecheck + lint impacted components
    - [x] No UI changes, no E2E changes
- [x] **Lot 2 — Tests**
  - [x] Add deploy/ci/preprod-a4/t3-driver.test.mjs (fault injection matrix, dry-run, budgets)
  - [x] Add api/tests/api/t3-classify.test.ts (migrated DB schema check, wrong column fails)
  - [x] Scoped runs: make test-preprod-a4 SCOPE=t3-driver.test.mjs ENV=test-t3-driver
  - [x] Scoped runs: make test-api-endpoints SCOPE=tests/api/t3-classify.test.ts ENV=test-t3-driver
- [x] **Lot 3 — Preprod read-only dry-run + report**
  - [x] Run driver DRY-RUN against sentropic-preprod read-only via docker-slot.sh
  - [x] Record read-only step latencies
  - [x] Write /home/antoinefa/src/sentropic/.tmp/rv/t3-driver.md (FR, per finding)
- [x] **Lot 5 — RUN 3 Argon BLOCKERs + MAJORs (each with a fails-before test)**
  - [x] B1 W7b gate commitVerified + apiReady; W5 cutoff 110_000; step-bounded delivered timeouts
  - [x] B2 single-flight claim (no same-owner regrant) + pid expiry 120 s + watchdog reentrancy guard + group kill
  - [x] B3 recover stops api first, verifies locks, records Q5 relations; waitZeroPods scoped to api
  - [x] B4 W8/W9 share the 300 s budget (FINISH_CUTOFF 300_000); W5/W8/W9 assertions
  - [x] B5 emergency stops automation, takes the lock, classifies after api stop, passes preCmDir
  - [x] B6 W3 poses rotation keys as explicit file-fed stdin steps after wire
  - [x] M1 frontal Terminating wait loop; M2 awaited verifyService + export force-suspend; M3 dry-run nominal + key patch print
  - [x] M4 effectiveTimeout bound to the live step deadline (delivered + kubectl)
  - [x] M5 post-commit resume matrix (patch-in-place, no probe replay, BACKUP_RESUMED/ONE_HOST_OPEN) + Q5 present + Q6 planted enc row
  - [x] Suite: make test-preprod-a4 88/88 + make test-api-endpoints t3-classify 6/6 ENV=test-t3-driver
  - [x] make typecheck-api + make lint-api green; make scope-check PASS
- [ ] **Lot 4 — PR + CI**
  - [ ] Push feat/t3-window-driver, open PR, CI green
  - [ ] No merge
