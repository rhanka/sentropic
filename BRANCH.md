# Fix: e2e UI flaky non-AI (matrix lock, org viewer, matrix export)

## Objective
Fix three non-AI UI e2e flakes and one low-priority chat flake with deterministic waits and minimal app/test changes.

## Scope / Guardrails
- Scope limited to e2e specs and one UI popover z-index.
- One migration max in `api/drizzle/*.sql` (none planned).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/worktrees/fix-e2e-ui-flaky`.
- Automated test campaigns run on dedicated environments (`ENV=e2e-fix-flaky`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off).
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `e2e/tests/07-matrix.spec.ts`
  - `e2e/tests/02-organizations.spec.ts`
  - `e2e/tests/03-chat.spec.ts`
  - `e2e/helpers/lock-ui.ts`
  - `ui/src/lib/components/MenuPopover.svelte`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose.dev.yml` (only if verification forces a compose change; untouched so far)
  - `.tmp/rv/compose-backup-owner.md` (French verification report, untracked)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile` (covered by BRCBO-EX1 below)
  - `docker-compose*.yml` (covered by BRCBO-EX1 below)
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file, not needed here)
  - `.github/workflows/**` (not needed here)
- **Exception process**:
  - [ ] BRCBO-EX1 declared in ## Feedback Loop before touching any conditional/forbidden path.

## Feedback Loop
- [ ] BRCBO-EX1 (scope exception for Makefile + docker-compose*.yml, default-forbidden): rationale: PR #973 left postgres/minio bind-mount writes into ./data/backup root-owned and 9 workspace-writing docker runs without host user (verified audit: 370 docker run sites, 211 already host-user, 134 deletion-only, 16 others classified below); impact: Makefile-only behavior change (run writers as UID:GID, chown backup after pg_dump), no image/volume/data-layout change, backups stay host-visible bind-mount files; rollback: git revert the branch commits, ownership normalizes again on next backup run.
- [ ] Root-stay exceptions (verified, must stay root with reason): 134 pure rm -rf deletion-only docker runs (need root to delete legacy root-owned cruft, deletions create no files); chown normalizers Makefile 355/368/2547/1182 + new db-backup step (chown itself requires 0:0); :ro mounts (kernel read-only, cannot create host files); no-workspace-mount runs 672/780/2069/3078/3995 (no host write possible, 3078 output via host redirect); scanners 3929/3942-trivy/4025/4026 (scan-only, JSON via host-shell redirect); minio/minio-init user 0:0 kept (Chainguard uid 65532 vs pre-existing root-owned minio_data named volume, backup writes go through MINIO_EXEC as host user); test.yml api root default (no workspace bind, CI ephemeral).
- [ ] Already-compliant equivalence note: 167 docker run sites already pass literal -u "$$(id -u):$$(id -g)" -e HOME=/tmp, behaviorally identical to the new variable, left untouched for diff minimality.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [ ] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: Single fix branch for four e2e flakes, one PR, one CI.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- UAT checkpoints must be listed as checkboxes inside each relevant lot (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run tests in `tmp/worktrees/fix-e2e-ui-flaky`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/top-ai-ideas-fullstack`, `ENV=dev`).
  - Switch back to `tmp/worktrees/fix-e2e-ui-flaky` after UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/testing.md`, `rules/workflow.md`, `.tmp/packets/COMMON-RULES.md`.
  - [x] Create isolated worktree `tmp/worktrees/fix-e2e-ui-flaky` on `fix/e2e-ui-flaky` from `origin/main` (HEAD 00d160d79).
  - [x] Confirm branch with `git -C tmp/worktrees/fix-e2e-ui-flaky branch --show-current`.
  - [x] Define environment `ENV=e2e-fix-flaky` with ports `API_PORT=8929 UI_PORT=5329 MAILDEV_UI_PORT=1229`.
  - [x] Confirm command style `make ... ENV=e2e-fix-flaky` with `ENV` last, Docker via `.tmp/packets/docker-slot.sh` in foreground.
  - [x] Capture CI evidence for runs 42679203883, 42707316864, 42709378130, 42715826902 plus 42680623520 (org second occurrence).
  - [x] Validate scope boundaries and declare exceptions if needed (none planned).
- [x] **Lot 1 — Fix matrix export cover (app) + org viewer selector (test)**
  - [x] Fix `ui/src/lib/components/MenuPopover.svelte`: absolute menu `z-20` to `z-50` so Actions menu stays above lock badge tooltip.
  - [x] Fix `e2e/tests/07-matrix.spec.ts` Export: scope Export button to open menu, hover `h1` to close badge tooltip before click, keep download wait.
  - [x] Fix `e2e/tests/02-organizations.spec.ts:391`: select seeded `Org Readonly E2E` by name, wait for list GET 200 before click, wait for detail GET 200 after click.
  - [x] Lot gate:
    - [x] `make typecheck-ui ENV=e2e-fix-flaky` + `make lint-ui ENV=e2e-fix-flaky`
    - [x] **E2E tests**
      - [x] Prepare E2E build: `make build-api build-ui-image API_PORT=8929 UI_PORT=5329 MAILDEV_UI_PORT=1229 ENV=e2e-fix-flaky`
      - [x] Scoped runs: `make test-e2e E2E_SPEC=tests/02-organizations.spec.ts API_PORT=8929 UI_PORT=5329 MAILDEV_UI_PORT=1229 ENV=e2e-fix-flaky`
      - [x] Scoped runs: `make test-e2e E2E_SPEC=tests/07-matrix.spec.ts API_PORT=8929 UI_PORT=5329 MAILDEV_UI_PORT=1229 ENV=e2e-fix-flaky`
- [x] **Lot 2 — Fix matrix lock leave (test) + chat queue poll (test)**
  - [x] Fix `e2e/tests/07-matrix.spec.ts:477`: use isolated members, ensure workspace scope, wait for lock POST 201 for User A and User B, use `waitForNoLocker` helper instead of 2s poll.
  - [x] Fix `e2e/tests/03-chat.spec.ts` `waitForQueueJobSettled`: catch network errors and return retryable string so poll retries on socket hang up.
  - [x] Lot gate:
    - [x] `make typecheck-ui ENV=e2e-fix-flaky` + `make lint-ui ENV=e2e-fix-flaky`
    - [x] Scoped runs: `make test-e2e E2E_SPEC=tests/03-chat.spec.ts API_PORT=8929 UI_PORT=5329 MAILDEV_UI_PORT=1229 ENV=e2e-fix-flaky`
    - [x] Scoped runs: `make test-e2e E2E_SPEC=tests/07-matrix.spec.ts API_PORT=8929 UI_PORT=5329 MAILDEV_UI_PORT=1229 ENV=e2e-fix-flaky`
- [ ] **Lot N — Final validation**
  - [x] Typecheck & Lint
  - [x] Retest UI (none changed except popover, covered by E2E)
  - [x] Retest API (none)
  - [x] Retest e2e scoped specs for 02-organizations, 07-matrix, 03-chat
  - [ ] Retest AI flaky tests run (non-blocking only under acceptance rule) and document pass/fail signatures in `BRANCH.md`
  - [ ] Record explicit user sign-off if any AI flaky test is accepted
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` text as PR body (source of truth).
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge.
