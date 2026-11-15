# Feature: Restore rehearsal checkpoint accepts post-A4 production dumps
## Objective
- [x] Fix `test-smoke-restore` (`make restore-api-sut`) since the production A4 identity cutover: `runCmRestoreCheckpoint` read the dropped legacy `public.users`; it now verifies the durable A4 cutover evidence fail-closed on post-A4 dumps (no checkpoint is consumed there) and keeps the rehearsal checkpoint for pre-A4 dumps.
## Scope / Guardrails
- [x] Isolated worktree `tmp/worktrees/smoke-restore-fix` on branch `fix/smoke-restore-post-a4` from `origin/main` (`913e3bcbc`).
- [x] Make-only workflow via `.tmp/packets/docker-slot.sh`, `ENV=test-smoke-restore-fix` last (`API_PORT=9179`, `UI_PORT=5379`, `MAILDEV_UI_PORT=1279`).
- [x] No migration change, no timeout change, no relaxed check, commits under 150 lines, English only.
## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/identity/cm-cutover-evidence.ts`
  - `api/src/scripts/cm-restore-checkpoint.ts`
  - `api/src/scripts/cm-preprod-verify.ts`
  - `api/tests/unit/auth/cm-restore-checkpoint.test.ts`
  - `api/tests/unit/auth/cm-preprod-verify.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql`
  - `.github/workflows/**`
## Feedback Loop
- [x] Root cause: control migration `api/drizzle/control/0015_app_cm_identity_cutover.sql:161-173` dropped the legacy identity tables in production during the T3 A4 cutover (15/11 16:15-16:52Z); `api/src/scripts/cm-restore-checkpoint.ts:57` called `readA4IdentitySource` unconditionally, which locks `public.users` (`api/src/services/identity/cm-import-source.ts:23`) -> `42P01` on every post-A4 dump (CI run 43738031623).
- [x] Main stayed green only because `test-smoke-restore` is skipped there by the path filter; every PR that runs it fails.
## AI Flaky tests
- [x] No AI tests or flaky allowances.
## Orchestration Mode (AI-selected)
- [x] Mono-branch + cherry-pick: standalone small PR from `origin/main`; PR #1033 and every PR running `test-smoke-restore` pick it up after it lands.
## UAT Management (in orchestration context)
- [x] Backend/CI restore rehearsal only; no UI surface.
## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`, `.tmp/packets/COMMON-RULES.md`.
  - [x] Reproduce `relation "public.users" does not exist` on unmodified `913e3bcbc` (real post-A4 schema in the new unit test).
- [x] **Lot 1 — Shared A4 cutover evidence + post-A4 restore path**
  - [x] Extract `readA4CutoverEvidence` / `isA4CutoverJournaled` (`cm-cutover-evidence.ts`) from `cm-preprod-verify.ts`; deletion check now covers all 11 dropped legacy tables.
  - [x] `cm-restore-checkpoint.ts`: post-A4 dump -> verify evidence, remove stale rehearsal files, write no checkpoint; pre-A4 dump -> unchanged rehearsal checkpoint.
  - [x] Lot gate:
    - [x] `make typecheck-api` + `make lint-api` (0 errors)
    - [x] **API tests**
      - [x] `make test-api-unit SCOPE="tests/unit/auth/cm-restore-checkpoint.test.ts tests/unit/auth/cm-preprod-verify.test.ts"` (12/12; post-A4 case red before the fix)
      - [x] `make restore-api-sut verify-api-sut-restart test-api-smoke-restore` on today's production dump (`make db-backup-prod`, 1983324 bytes): `CHECKPOINT_NOT_REQUIRED`, business data preserved, smoke 9/9
- [ ] **Lot 2 — Final validation**
  - [x] `make down-volumes ENV=test-smoke-restore-fix`.
  - [ ] Push, open PR against `main` (no merge), CI green on the exact head.
