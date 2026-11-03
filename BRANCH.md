# Feature: make down-volumes — remove Docker volumes of TEST environments (disk hygiene)

## Objective
Add `make down-volumes ENV=<env>` which runs the same compose project as `make down` but with `down --volumes --remove-orphans`, and refuses (clear error) any ENV that is empty, `dev`, or not a `test-*`/`e2e-*` name. Goal: test lanes stop leaking node_modules, pg and minio volumes (disk reached 96-97%). Owner-approved 2026-11-02 (« Cible make + nettoyage »).

## Scope / Guardrails
- Scope limited to the Makefile (new `down-volumes` + `check-down-volumes` targets only; `make down` untouched), one new guard script under `scripts/`, and the `rules/testing.md` doc line.
- No migration (`api/drizzle/*.sql`).
- Make-only workflow, no direct Docker commands; the guard test never starts a stack (refusal happens before any compose call; allowed cases are asserted via `make -n` dry-run only).
- Branch development in isolated worktree `tmp/worktrees/make-down-volumes` on branch `chore/make-down-volumes` from `origin/main`.
- `ENV=<test-env>` always last in every `make` command; never `ENV=dev` for real runs (the guard test passes `ENV=dev` only to assert the refusal, which exits before any Docker call).
- CI lockfile-lane policy acknowledged (review_by=2026-11-30T00:00:00Z); installs resolve committed tool profiles or frozen consumer closures.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `Makefile` (only under `BRDV-EX1`; only the two new targets, `down` and every other existing target unchanged)
  - `scripts/check-down-volumes-guard.sh` (new)
  - `rules/testing.md` (doc bullet under Environment Isolation Rules)
  - `BRANCH.md`
  - `docs/runbooks/app-artifact-content-infrastructure.md` (BR01-EX4, docs-only review-r1 fix)
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `api/**`, `ui/**`, `e2e/**`, `packages/**`, `apps/**`, `deploy/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `scripts/**` except `scripts/check-down-volumes-guard.sh`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file) — not used
  - `.github/workflows/**` — not used
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.
  - [x] `BRDV-EX1` (owner-approved 2026-11-02, « Cible make + nettoyage »): scope exception to touch the `Makefile`, forbidden by default.
    - Reason: the owner-approved change IS a make target (`make down-volumes ENV=<test-env>`); there is no other make-only place to add it.
    - Impact: additive only — one new `down-volumes` target (guarded to `test-*`/`e2e-*`, refuses empty/`dev`/other) placed right after `down`, one new `check-down-volumes` target next to `check-ci-version-filters`, plus the `##` help text picked up by `make help`. `make down` and all other targets are byte-unchanged. The ARTIFACTS_COMPOSE family is covered by mirroring the same `ifneq ($(filter $(ENV),...))` selection `make down` already uses. No compose file, no CI workflow, no package `src/**` change, so no `enforce-package-bump` bump applies.
    - Rollback: revert the single commit (or delete the two new targets); `make down` behavior is untouched, so nothing else to restore.

## Feedback Loop
- [x] `BRDV-EX1` declared above before touching `Makefile` (owner approval date 2026-11-02 recorded).
- [x] Disk-pressure rationale: test lanes leak node_modules/pg/minio volumes; disk reached 96-97% (owner report 2026-11-02).

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.
- [x] No AI flaky tests involved; the guard test is a deterministic shell assertion.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: one additive Makefile target + one guard script + one doc line; single branch, single CI.

## UAT Management (in orchestration context)
- **Mono-branch**: no UAT surface (no app behavior change); acceptance is the guard test (`make check-down-volumes`) plus one CI run on the PR head.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `.tmp/packets/COMMON-RULES.md`.
  - [x] Worktree `tmp/worktrees/make-down-volumes` on branch `chore/make-down-volumes` from `origin/main` (HEAD `5b1d1dcd2`).
  - [x] `harness check branch` PASS (C1).
  - [x] Declare `BRDV-EX1` (Makefile exception, owner-approved 2026-11-02) before any Makefile edit.
- [x] **Lot 1 — Makefile targets**
  - [x] Add `down-volumes` right after `down`: shell guard `case "$(ENV)" in test-*|e2e-*) ;; *) error+exit 1 ;; esac`, then the same `ifneq ($(filter $(ENV),<ARTIFACTS family list>),)` selection as `down`, both branches with `down --volumes --remove-orphans`; `##` help text documents the test-env-only rule.
  - [x] Add `check-down-volumes` next to `check-ci-version-filters` running `./scripts/check-down-volumes-guard.sh`.
  - [x] `make down` and all other targets unchanged.
- [x] **Lot 2 — Guard test + docs**
  - [x] New `scripts/check-down-volumes-guard.sh`: assert `make down-volumes ENV=dev` and `make down-volumes ENV=` (empty) fail with the refusal message and never print a compose command; assert `make -n down-volumes ENV=test-guard` and `ENV=e2e-guard` print `down --volumes --remove-orphans`; assert the ARTIFACTS_COMPOSE family (`ENV=test-mem-e10`) dry-run prints the `docker-compose.immo-861.yml` compose with `--volumes --remove-orphans`.
  - [x] `rules/testing.md`: every test lane ends with `make down-volumes ENV=<its test env>`, including on failure.
  - [x] Local gate: `make check-down-volumes ENV=test-make-down-volumes` PASS; `make scope-check` PASS before commit.
- [x] **Lot 3 — Commit, PR, CI**
  - [x] Selective `git add` (Makefile, scripts/check-down-volumes-guard.sh, rules/testing.md, BRANCH.md) + `make commit MSG="..."`.
  - [x] Push `chore/make-down-volumes`, open READY PR (body = this BRANCH.md), one CI run on the final head.
  - [x] Report to `.tmp/rv/make-down-volumes.md`; do not merge.
