# Feature: A2-M0-MIG — repair drizzle control migration chain 0007–0011 & journal integrity

## Objective
- [x] Deliver fast-track plan r2 Wave 0 lot `A2-M0-MIG`: a linearized, deterministic drizzle migration chain `0007`–`0011` in `api/drizzle/control/` and its `_journal.json`, with zero duplicate tags and zero broken foreign-key ordering (plan r2 §2.2 `A2-M0-MIG`; identity spec r2 `§9 M0`, `§9.3` condition 1).
- [x] Keep migration application order, `when` timestamps and SQL contents byte-identical so every already-migrated database (prod, preprod, test, CI) observes zero behavioral change; the repair only realigns file names, journal tags and journal integrity.

## Scope / Guardrails
- Scope limited to the drizzle control migration stream (`api/drizzle/control/**`) and a locking unit test; no application code, no schema change, no new migration statement.
- No new schema migration added (renames only); the public stream `api/drizzle/*.sql` and its journal are untouched.
- Make-only workflow, no direct Docker commands; Docker steps under the shared flock (`.tmp/packets/DOCKER-LOCK.md`).
- Branch development in isolated worktree `tmp/worktrees/a2-m0-mig` from `origin/main 1b7f8ab94`.
- Automated tests on dedicated environment `ENV=test-a2-m0-mig` (never `dev`), `ENV=` last argument; `make down ENV=test-a2-m0-mig` after each Docker step.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/drizzle/control/*.sql` (renames only, no content change)
  - `api/drizzle/control/meta/_journal.json`
  - `api/tests/unit/drizzle-journal-integrity.test.ts`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `api/src/**`
  - `packages/**`
  - `api/drizzle/meta/_journal.json` (public stream journal)
  - `api/drizzle/0*.sql` (public stream migrations)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/control/*.sql` (max 1 new file normally; this branch renames 2 existing files — see exception)
- **Exception process**:
  - `A2M0-EX1`: rename `api/drizzle/control/0011_session_workspace_bindings.sql` to `0009_session_workspace_bindings.sql` and `api/drizzle/control/0012_decision_host.sql` to `0011_decision_host.sql`, and retag `api/drizzle/control/meta/_journal.json` accordingly (idx and `when` values unchanged). Reason: journal integrity repair per plan r2 lot `A2-M0-MIG` — the journal applies tag `0011` before tag `0010` (non-linear) and the numbering gap at `0009` makes the next drizzle-kit generate collide with the existing `0012_decision_host`. Impact: zero — application order, timestamps and file contents are byte-identical, so drizzle's `created_at`-based migrator state on every existing database is unaffected. Rollback: single revert of this branch's commits (pure renames + journal tags).

## Feedback Loop
Actions with the following status should be included around tasks only if really required (cf. Task 1 feedback loop):
- `blocked` / `deferred` / `cancelled` / `attention`: message (requires clarification about ...)
- `clarification` / `acknowledge` / `refuse`: explanation

## AI Flaky tests
- Acceptance rule: accept only non-systematic provider/network/model nondeterminism as `flaky accepted` (at least one success on the same commit and same command); never amend tests with additive timeouts; if flaky, analyze impact vs `main` — this branch adds a deterministic filesystem-only test, no flaky lane applies.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: single atomic repair lot with one test cycle; no sub-workstreams.

## UAT Management (orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- No UAT checkpoint in this branch: no UI change, no user-facing behavior.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Create/confirm isolated worktree `tmp/worktrees/a2-m0-mig` on `feat/a2-m0-mig` from `origin/main 1b7f8ab94`; branch verified with `git branch --show-current`.
  - [x] Capture Makefile targets: `up-api-test`, `db-migrate`, `test-api-smoke-restore`, `test-api-unit` (SCOPE), `typecheck-api`, `scope-check`, `commit`, `down`.
  - [x] Environment mapping: `ENV=test-a2-m0-mig`, ports `API_PORT=8831`, `UI_PORT=5231`, `MAILDEV_UI_PORT=1131`; `ENV=` last in every command.
  - [x] Confirm scope and guardrails; declare `A2M0-EX1`.

- [x] **Lot 1 — Journal integrity repair (test first)**
  - [x] Add `api/tests/unit/drizzle-journal-integrity.test.ts` asserting, for both drizzle streams (public `api/drizzle` and control `api/drizzle/control`): contiguous `idx` sequence, unique and strictly tag-ordered entries, strictly increasing `when`, journal tag ↔ `.sql` file bijection, unique numeric prefixes and a free next-generate number.
  - [x] Prove RED on the unmodified chain (control journal out-of-order tags).
  - [x] Apply `A2M0-EX1`: rename control `0011_session_workspace_bindings.sql` → `0009_session_workspace_bindings.sql`, `0012_decision_host.sql` → `0011_decision_host.sql`; retag `control/meta/_journal.json` (idx, `when`, application order, SQL bytes unchanged).
  - [x] Prove GREEN: `make test-api-unit SCOPE=tests/unit/drizzle-journal-integrity.test.ts ENV=test-a2-m0-mig`.
  - [x] Lot gate: `make typecheck-api ENV=test-a2-m0-mig`.

- [ ] **Lot 2 — Acceptance & train**
  - [x] Fresh-database chain proof: `make up-api-test ENV=test-a2-m0-mig` (under flock), `make db-migrate ENV=test-a2-m0-mig`, `make test-api-smoke-restore ENV=test-a2-m0-mig`, `make down ENV=test-a2-m0-mig`.
  - [x] `make scope-check` clean.
  - [x] Atomic commits ≤150 lines via `make commit`.
  - [ ] Push only after local tests pass; draft PR; single CI run on the final head; record PR, head, CI run and acceptance evidence in `.tmp/rv/lot-A2-M0-MIG.md`.
