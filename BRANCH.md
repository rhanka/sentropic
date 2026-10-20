# Feature: API image canonical artifact

## Objective
Fix main CI publish-api-image tag collision on global-only changes while keeping the immutable-tag collision guard intact.

## Scope / Guardrails
- Scope limited to production API image build/resolve/publish lanes, tag inputs, and guard tests.
- One migration max in `api/drizzle/*.sql` (if applicable).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-<slug>` (even for one active branch).
- Automated test campaigns must run on dedicated environments (`ENV=test` / `ENV=e2e`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `scripts/resolve-api-image.sh`
  - `scripts/test-api-image-canonical.sh`
  - `scripts/publish-api-image.sh`
  - `scripts/test-api-tag-guard.sh`
  - `.dockerignore`
  - `api/Dockerfile`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `Makefile`
  - `<other-sensitive-paths>`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- `attention`: BR01-EX1 declared — `Makefile` (forbidden): extend API_VERSION hash inputs to all shipped build inputs, add resolve-api-image + canonical test targets. Impact: tag rotates once to a new absent tag; no collision possible. Rollback: revert Makefile hunk.
- `attention`: BR01-EX2 declared — `.github/workflows/ci.yml` (conditional): build-api-image job logs in to registry and resolves canonical tag before building; api filter extended to cover new hash inputs; canonical guard test wired. Impact: CI-only; publish guard unchanged. Rollback: revert ci.yml hunks.
- `attention`: BR01-EX3 declared — `api/Dockerfile` (allowed via Allowed Paths, recorded here for traceability): pin tar@7.5.22 (was tar@latest). Impact: deterministic toolchain input; one-time digest rotation on next absent-tag build. Rollback: revert one line.

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
- Rationale: single orthogonal fix, one test cycle, no sub-workstreams.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- **Multi-branch**: no UAT on sub-branches; UAT happens only after integration on the main branch.
- UAT checkpoints must be listed as checkboxes inside each relevant lot (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run tests in `tmp/feat-<slug>`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/top-ai-ideas-fullstack`, `ENV=dev`).
  - Switch back to `tmp/feat-<slug>` after UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, packet, diagnosis.
  - [x] Confirm worktree `tmp/worktrees/api-image-canonical`, branch `fix/api-image-canonical-artifact`.
  - [x] Capture targets: `make build-api-image save-api load-api publish-api-image test-ci-api-tag-guard check-ci-version-filters scope-check commit`.
  - [x] Define environment mapping: dedicated `ENV=test-api-image-fix` for all test runs.
  - [x] Confirm command style: `make ... ENV=<env>` with `ENV` last.
  - [x] Declare scope exceptions BR01-EX1 (Makefile), BR01-EX2 (ci.yml), BR01-EX3 (Dockerfile pin).

- [x] **Lot 1 — Canonical artifact resolution**
  - [x] Add `scripts/resolve-api-image.sh`: existing tag pulls and records receipt, absent tag builds, other errors fail closed.
  - [x] Makefile: `build-api-image` resolves first; add `build-api-image-fresh` for forced rebuilds.
  - [x] ci.yml: build-api-image job logs in and resolves before SUT lanes.
  - [ ] Lot gate:
    - [ ] `make test-ci-api-image-canonical ENV=test-api-image-fix`
    - [ ] `make test-ci-api-tag-guard ENV=test-api-image-fix`
    - [ ] `make check-ci-version-filters ENV=test-api-image-fix`
    - [ ] `make scope-check ENV=test-api-image-fix`

- [x] **Lot 2 — Tag inputs aligned with shipped bytes**
  - [x] Makefile API_VERSION: hash all consumed workspace inputs, api templates/tests, security gate files, Dockerfile inputs, .dockerignore.
  - [x] api/Dockerfile: pin tar@7.5.22.
  - [x] .dockerignore: exclude files no image stage needs (global-only and non-consumed paths).
  - [x] ci.yml api filter extended to cover every new hash input.
  - [x] Lot gate:
    - [x] `make test-ci-api-image-canonical ENV=test-api-image-fix` (12/12)
    - [x] `make check-ci-version-filters ENV=test-api-image-fix`
    - [x] `make scope-check ENV=test-api-image-fix`
  - [x] Real no-cache production build with reduced context: `local/sentropic-api:d7bfda` built, runtime verified (no npm, node v24.22.0).
  - [x] Builder probes: `COPY Makefile` refused (excluded), `COPY e2e/package.json ui/package.json api/package.json` kept.

- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint
  - [ ] Retest API (cf Lot1, copy checklist)
  - [ ] Retest e2e (cf lots e2e_groups like in Lot1)
  - [ ] Retest AI flaky tests (non-blocking only under acceptance rule) and document pass/fail signatures in `BRANCH.md`
  - [ ] Record explicit user sign-off if any AI flaky test is accepted
  - [ ] Bumped affected `packages/<pkg>/package.json` version (semver) for every package whose `src/**` changed in this branch — enforced by CI `enforce-package-bump`. See `rules/workflow.md → Package Publication`.
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` text as PR body (source of truth).
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge.
