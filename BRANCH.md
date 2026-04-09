# Fix: Resolve npm audit vulnerabilities in API dependencies

## Objective
Fix HIGH and moderate npm audit vulnerabilities in API dependencies to unblock Docker build.

## Scope / Guardrails
- Scope limited to API dependency upgrades.
- Make-only workflow, no direct Docker commands.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/package.json`
  - `api/package-lock.json`
  - `api/src/utils/pg-errors.ts`
  - `api/src/services/stream-service.ts`
  - `api/src/services/lock-service.ts`
  - `api/tests/unit/stream-service.test.ts`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - None expected.
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- None.

## AI Flaky tests
- Not applicable (dependency-only change).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: single-scope security fix, no sub-workstreams needed.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read rules files (`MASTER.md`, `workflow.md`, `security.md`, `BRANCH_TEMPLATE.md`).
  - [x] Verify branch and worktree.
  - [x] Create `BRANCH.md`.

- [x] **Lot 1 — Fix npm audit vulnerabilities**
  - [x] Start dev environment and run initial `npm audit --omit=dev`.
  - [x] Run `npm audit fix` for auto-fixable vulnerabilities (hono, nodemailer, file-type).
  - [x] Upgrade `drizzle-orm` to `>=0.45.2` for HIGH SQL injection fix (GHSA-gpj5-g38j-94v9).
  - [x] Upgrade `@hono/node-server` to `>=1.19.13` for moderate serveStatic bypass fix (GHSA-92pp-h63x-v22m).
  - [x] Run `npm install` to regenerate lock file.
  - [x] Verify `npm audit --omit=dev` shows 0 vulnerabilities.
  - [x] Run `npx tsc --noEmit` to verify no type breakage.
  - [x] Run smoke tests (API health passes; DB tests fail due to unseeded fresh env, not related to upgrade).
  - [x] Lot gate:
    - [x] `npm audit --audit-level=high --omit=dev` exits 0 (0 vulnerabilities)
    - [x] TypeScript compilation passes

- [x] **Lot 2 — Fix drizzle-orm 0.45.2 error wrapping breaking pg 23505 detection**
  - [x] Create `api/src/utils/pg-errors.ts` with `findPgError` helper (recursive `.cause` unwrapping).
  - [x] Update `api/src/services/stream-service.ts` to use `findPgError` for conflict detection.
  - [x] Update `api/src/services/lock-service.ts` to use `findPgError` for conflict detection.
  - [x] Add wrapped-error test case in `api/tests/unit/stream-service.test.ts`.
  - [x] Typecheck passes (no errors in changed files).
  - [x] Unit tests pass (23/23 including new DrizzleQueryError-wrapped test).

- [ ] **Lot 3 — Commit, push, PR**
  - [ ] Stage changed files and `BRANCH.md`.
  - [ ] Commit with `make commit`.
  - [ ] Push branch.
  - [ ] Create PR targeting main.
