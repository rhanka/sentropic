# Fix: artifacts install/build/prebundle failure diagnostics

## Objective
Return a bounded, scrubbed recipe tail with exit code and signal from the worker pod install/build/prebundle ops, classify the cause (enospc, oom, enotcached, exit, signal), log it in artifact_live_phase, and size worker volumes plus the npm install heap so a ~1 GiB unpacked monorepo install fits with margin.

## Scope / Guardrails
- Scope limited to api/src/services/artifacts/live/** and api/tests/unit/artifacts-live/**.
- One migration max in `api/drizzle/*.sql` (none planned).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/worktrees/install-failed-diag`.
- Automated test campaigns run on dedicated environment (`ENV=test-install-diag`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off).
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/services/artifacts/live/**`
  - `api/tests/unit/artifacts-live/**`
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
- None yet.

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
- Rationale: Single generic api change, one PR train wagon, scoped unit tests only.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- No UI change in this branch, no UAT surface.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read rules/MASTER.md, rules/workflow.md, rules/testing.md, .tmp/packets/COMMON-RULES.md.
  - [x] Create isolated worktree tmp/worktrees/install-failed-diag on origin/main (67205fe00), branch fix/artifacts-install-failed-diag, VERIFY.
  - [x] Write BRANCH.md with BRLOCK-EX1 line, ENV=test-install-diag, API_PORT=8927 UI_PORT=5327 MAILDEV_UI_PORT=1227.
  - [x] Trace callers: builderPod (pods.ts ensure), bootstrapConfig (composeSupervisor), runToExit (install/prebundle/build ops), runPhase (install/build/prebundle/live phases), createProductBuilder env root.
  - [x] Confirm scope boundaries (api live + unit tests only, no migration, no workflow change).
- [ ] **Lot 1 — Pod recipe observability (tail + exit + signal)**
  - [ ] bootstrap-agent.ts: pipe recipe stdio, bounded 4 KiB tail, JS scrub, runToExit returns { exitCode, signal, output }.
  - [ ] bootstrap-deps.ts install op returns { exitCode, signal, output }.
  - [ ] bootstrap-procs.ts prebundle/build ops return diagnostics (prebundled flag kept).
  - [ ] bootstrap.ts/server: INSTALL_ENV threaded (frozen config, startBootstrap).
  - [ ] Lot gate:
    - [ ] `make typecheck-api ENV=test-install-diag`
    - [ ] **API tests**
      - [ ] Update bootstrap-deps.test.ts (install result shape, tail capture, scrub, bound, install env).
      - [ ] Update bootstrap-procs.test.ts (prebundle/build result shape, tail capture, scrub, bound).
      - [ ] Update bootstrap-server.test.ts (INSTALL_ENV in frozen config).
      - [ ] Extend bootstrap-harness.ts fakeSpawn with piped stdio output support.
      - [ ] Scoped runs: `make test-api SCOPE=tests/unit/artifacts-live/bootstrap-deps.test.ts ENV=test-install-diag` (and procs, server).
- [ ] **Lot 2 — API classification + phase logging**
  - [ ] NEW recipe-diagnostics.ts: scrub, truncate, classify (enospc, enotcached, oom, signal, exit), result validator.
  - [ ] records.ts: LiveError carries optional detail.
  - [ ] deadline.ts: artifact_live_phase fail line carries scrubbed bounded detail.
  - [ ] supervisor-install.ts: install_failed:<class> + detail; malformed result fails closed.
  - [ ] supervisor.ts: build_failed:<class> and prebundle_failed:<class> + detail.
  - [ ] Lot gate:
    - [ ] `make typecheck-api ENV=test-install-diag`
    - [ ] **API tests**
      - [ ] NEW recipe-diagnostics.test.ts (scrub, bound, classification incl. ENOSPC, OOM 137/SIGKILL, ENOTCACHED, plain exit, precedence).
      - [ ] Update supervisor-install.test.ts (classified reasons, malformed shape, detail absent from ledger).
      - [ ] Update supervisor.test.ts (prebundle/build diagnostic shapes).
      - [ ] Update deadline.test.ts (detail field scrubbed and bounded, absent when none).
      - [ ] Scoped runs for each file above.
- [ ] **Lot 3 — Capacity sizing**
  - [ ] recipes.ts: NODE_INSTALL_HEAP_OPTIONS 1024 + ARTIFACT_INSTALL_HEAP_MB override (validated).
  - [ ] pods.ts: WorkerSizing + readWorkerSizing env (source 384, scratch 1792, dependencies 1408 defaults), container limits unchanged (quota-bound).
  - [ ] service.ts + supervisor-composition.ts + product-builder.ts: thread sizing and installEnv from env.
  - [ ] README.md: update emptyDir numbers and sizing rationale.
  - [ ] Lot gate:
    - [ ] `make typecheck-api ENV=test-install-diag`
    - [ ] **API tests**
      - [ ] Update pods.test.ts (new defaults, env overrides, quota fit unchanged, heap env).
      - [ ] Update recipes.test.ts (install heap default + override).
      - [ ] Scoped runs for each file above.
- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint
  - [ ] Retest API (scoped suites above, full file runs unmodified)
  - [ ] Push branch early, open PR (train wagon, no merge), CI green on exact head
  - [ ] Write report to .tmp/rv/install-failed-diag.md (PR, head, CI, chosen sizes + justification)
  - [ ] `make down-volumes ENV=test-install-diag` at the end

## Environment
- Worktree: tmp/worktrees/install-failed-diag, branch fix/artifacts-install-failed-diag, base origin/main 67205fe00.
- ENV=test-install-diag, API_PORT=8927, UI_PORT=5327, MAILDEV_UI_PORT=1227.
- Docker only via .tmp/packets/docker-slot.sh in the FOREGROUND, scoped unit tests only.
- Full suites stay on GitHub CI (host saturated).
