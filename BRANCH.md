# Feature: compose-host-user

## Objective
- [ ] Run sentropic Docker compose services as the host user so bind-mounted outputs are no longer root-owned.

## Scope / Guardrails
- [ ] Scope limited to compose user mapping and Makefile UID/GID exports plus container HOME/npm cache writability.
- [ ] No migration in `api/drizzle/*.sql`.
- [ ] Make-only workflow, Docker via `.tmp/packets/docker-slot.sh make ...` only, `ENV` always last.
- [ ] Branch work in `tmp/worktrees/compose-host-user`, never on root.
- [ ] Test env `ENV=test-compose-host-user`, ports `API_PORT=8891 UI_PORT=5291 MAILDEV_UI_PORT=1191`.
- [ ] Never `ENV=dev`, never `make clean-all`, no Python.
- [ ] Commits via `make commit MSG="..."` single line English, no attribution trailer, stage specific files only.
- [ ] Do NOT clean existing root-owned files of other worktrees (needs root, out of scope).
- [ ] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- [ ] **Allowed Paths (implementation scope)**:
- [ ] `docker-compose.dev.yml`
- [ ] `docker-compose.idp.yml`
- [ ] `docker-compose.e2e-vscode.yml`
- [ ] `docker-compose.test.yml`
- [ ] `BRANCH.md`
- [ ] **Forbidden Paths (must not change in this branch)**:
- [ ] `Makefile`
- [ ] `docker-compose*.yml`
- [ ] `.cursor/rules/**`
- [ ] `plan/NN-BRANCH_*.md` (except this branch file)
- [ ] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
- [ ] `api/drizzle/*.sql` (max 1 file)
- [ ] `.github/workflows/**`
- [ ] **Exception process**:
- [ ] Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- [ ] `attention` BRCHU-EX1: exception to touch `Makefile` and `docker-compose.dev.yml`, `docker-compose.idp.yml`, `docker-compose.e2e-vscode.yml`, `docker-compose.test.yml` (default-forbidden).
- [ ] Rationale: owner order 08/11 — bind-mounted outputs are root-owned in 31 worktrees, needs sudo cleanup.
- [ ] Impact: dev/test compose services run as `UID:GID`; postgres and named-volume-only services unchanged.
- [ ] Rollback: revert the commit.

## AI Flaky tests
- [ ] Acceptance rule:
- [ ] Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
- [ ] Non-systematic means at least one success on the same commit and same command.
- [ ] Never amend tests with additive timeouts.
- [ ] If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
- [ ] Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [ ] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] Rationale: single compose ownership fix, one test cycle, no sub-workstream CI.

## UAT Management (in orchestration context)
- [ ] **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- [ ] UAT checkpoints must be listed as checkboxes inside each relevant lot (no separate UAT section).
- [ ] Execution flow (mandatory):
- [ ] Develop and run tests in `tmp/worktrees/compose-host-user`.
- [ ] Push branch before UAT.
- [ ] Run user UAT from root workspace (`ENV=dev` reserved for user, branch never touches it).
- [ ] Switch back to `tmp/worktrees/compose-host-user` after UAT.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
- [ ] Read `rules/MASTER.md`, `rules/workflow.md`, `.tmp/packets/COMMON-RULES.md`.
- [ ] Create isolated worktree `tmp/worktrees/compose-host-user` on `fix/compose-host-user` from `origin/main` (HEAD `a56b19c01`).
- [ ] Verify branch via `git -C tmp/worktrees/compose-host-user branch --show-current` returns `fix/compose-host-user`.
- [ ] Capture Makefile targets for debug/testing.
- [ ] Define environment mapping (`ENV=test-compose-host-user`, `API_PORT=8891`, `UI_PORT=5291`, `MAILDEV_UI_PORT=1191`).
- [ ] Confirm command style: `.tmp/packets/docker-slot.sh make ... ENV=test-compose-host-user` with `ENV` last.
- [ ] Confirm scope and guardrails.
- [ ] Validate scope boundaries and declare `BRCHU-EX1` before touching forbidden paths.
- [x] **Lot 1 — Compose user mapping**
- [x] Add `user: "${UID:-1000}:${GID:-1000}"` to bind-mount writer services in `docker-compose.dev.yml` (`api`, `ui`, `openvscode-dev`, `ui-playwright-dev`, `playwright-dev`).
- [x] Add `user: "${UID:-1000}:${GID:-1000}"` to `auth-idp` in `docker-compose.idp.yml`; keep `idp-screen-smoke` unchanged (read-only bind, no bind writes).
- [x] Add `user: "${UID:-1000}:${GID:-1000}"` to `openvscode` and `e2e-vscode` in `docker-compose.e2e-vscode.yml`; keep `mock-api-vscode` unchanged (no volumes).
- [x] Add `user: "${UID:-1000}:${GID:-1000}"` to `e2e` in `docker-compose.test.yml`; keep base `docker-compose.yml` unchanged (no bind mounts; `postgres` named volume unchanged).
- [x] Keep `postgres`, `minio`, `minio-init` unchanged (named volumes or no bind writes).
- [x] List every other compose file with evidence of bind writes or no writes.
- [x] Set `HOME=/tmp` and `npm_config_cache=/tmp/npm-cache` env on switched Node services; no `chmod 777`; no legacy fallback, no dual path.
- [x] Makefile: export `UID`/`GID` from `id -u`/`id -g`; replace any `sudo chown 1000:1000` with `chown $(id -u):$(id -g)`.
- [ ] Lot gate:
- [ ] `make scope-check` advisory before commit.
- [ ] **Lot 2 — Validation**
- [ ] `make typecheck` via docker-slot on `ENV=test-compose-host-user`.
- [ ] Scoped `make test-api SCOPE=... ENV=test-compose-host-user` (single focused scope).
- [ ] `make up-api-test ENV=test-compose-host-user` (project equivalent) then create file in bind mount and check `stat -c %U` equals host user.
- [ ] `make down ENV=test-compose-host-user` after validation.
- [ ] **Lot N-1 — Docs consolidation**
- [ ] No spec file touched; nothing to consolidate.
- [ ] **Lot N — Final validation**
- [ ] Typecheck & Lint
- [ ] Retest UI (cf Lot 2, copy checklist)
- [ ] Retest API (cf Lot 2, copy checklist)
- [ ] Retest e2e (cf lots e2e_groups like in Lot 1)
- [ ] Retest AI flaky tests (non-blocking only under acceptance rule) and document pass/fail signatures in `BRANCH.md`
- [ ] Record explicit user sign-off if any AI flaky test is accepted
- [ ] Bumped affected `packages/<pkg>/package.json` version (semver) for every package whose `src/**` changed in this branch — enforced by CI `enforce-package-bump`. See `rules/workflow.md` to `Package Publication`.
- [ ] Final gate step 1: create/update PR using `BRANCH.md` text as PR body (source of truth).
- [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
- [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge.
