# Feature: SQL-L1 — SQLite connection factory, PRAGMAs & Stage-0 extension gate

## Objective
- [x] Deliver fast-track plan r2 lot `SQL-L1`: `openSqliteDatabase()` in `packages/cluster-mesh/src/storage/sqlite/connection.ts` enforcing `WAL`, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000`, `trusted_schema=OFF`, and `SQLITE_DBCONFIG_ENABLE_LOAD_EXTENSION=1` only around a verified `sqlite-vec` load then `0`, plus the `packages/cluster-mesh/tests/storage/sqlite.mk` targets `cluster-mesh-sqlite-s0-qualify` and `cluster-mesh-sqlite-test`.

## Scope / Guardrails
- [x] Branch `feat/sql-l1` from `origin/main` (`1b7f8ab94`); worktree `tmp/sql-l1`; draft PR targets main.
- [x] Environment `ENV=test-memory-sqlite` (plan r2 §1.2/§4.2), always the LAST make argument; never `ENV=dev`; `make down ENV=test-memory-sqlite` after Docker steps.
- [x] Serialize Docker work under the flock at `.tmp/packets/DOCKER-LOCK.md`.
- [x] Make targets only; no Python, no direct npm/docker publication, no `clean-all`, no merge, no native addon builds.
- [x] CI budget: local targeted tests green before any push; single push of the final head; draft PR; one CI run on the final head.
- [x] Selective staging plus `make commit`; every commit at most 150 changed lines except the disclosed `SQL-L1-EX1` record-only replacement of this file.
- [x] Bump `@sentropic/cluster-mesh` `0.24.0` → `0.26.0-dev.1` (src change requires a bump; `0.25.0` is reserved by #844 and `0.25.0-dev.1` by #855; final train minor is resolved at `CM-TRAIN-REL` per plan r2 §0.3).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/package.json`
  - `packages/cluster-mesh/src/storage/sqlite/connection.ts`
  - `packages/cluster-mesh/tests/storage/sqlite.mk`
  - `packages/cluster-mesh/tests/storage/sqlite-l1/**`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
  - `.track/**`
  - `scripts/ci/**`
  - `packages/contracts/**`
  - `api/**`
  - `ui/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - none planned
- **Exception process**:
  - Declare exception ID `SQL-L1-EXn` in `## Feedback Loop` before touching any conditional/forbidden path, with reason, impact and rollback.

## Feedback Loop
- [x] SQL-L1-EX1: commit 1 replaces `BRANCH.md` (previous branch's merged plan, 238 lines) with this lot's plan; a full-file replacement exceeds the 150-line cap by construction (238 deletions); impact is record-only, tree state is the new plan; rollback is not applicable (record-only).
- [x] SQL-L1-tests: unit suite written before the implementation and observed red (6/6 failed with `openSqliteDatabase is not a function` in the workspace container), then green after `openSqliteDatabase()` landed.
- [x] SQL-L1-acceptance: local acceptance commands from plan r2 §1.2 executed green in `tmp/sql-l1` before any push.

## AI Flaky tests
- Acceptance rule: accept only non-systematic provider/network/model nondeterminism as `flaky accepted`; never amend tests with additive timeouts; if flaky, analyze impact vs `main` and record command, failing file and signature here before any merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** — single lot, single branch, single final test cycle; the lot joins the SQLite train (`PR-CM-TRAIN`) at `CM-TRAIN-REL`, never merges to main alone.
- [ ] **Multi-branch**

## UAT Management (in orchestration context)
- Mono-branch: no UAT — storage-package-only change with no user-facing surface.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Worktree `tmp/sql-l1`, branch `feat/sql-l1` from `origin/main`, `.env` copied.
  - [x] `harness check branch --current-branch feat/sql-l1 --profile sentropic` → PASS C1.
  - [x] Confirm command style `make ... ENV=test-memory-sqlite` with ENV last; scope boundaries above.
- [x] **Lot 1 — Tests first (SQL-L1 harness)**
  - [x] `packages/cluster-mesh/tests/storage/sqlite-l1/connection.spec.ts`: PRAGMA enforcement with read-back, FK enforcement, reopen, refusal vocabulary (`:memory:`, empty path, missing vec extension), hard-closed extension gate without a vec path.
  - [x] `packages/cluster-mesh/tests/storage/sqlite-l1/s0-qualify.mjs`: Stage-0 runner proving the verified `sqlite-vec` load through the gate on the qualified container image (engine floor, vec0 virtual table roundtrip, gate closed after open).
  - [x] `packages/cluster-mesh/tests/storage/sqlite.mk`: add `cluster-mesh-sqlite-s0-qualify` (self-contained pinned `sqlite-vec@0.1.9` tool install), keep `cluster-mesh-sqlite-test`/`cluster-mesh-sqlite-run`, serialize Docker lanes under the common flock.
  - [x] Lot gate: suite observed red against the unimplemented `openSqliteDatabase`.
- [x] **Lot 2 — Implementation**
  - [x] `openSqliteDatabase()` in `packages/cluster-mesh/src/storage/sqlite/connection.ts`: durable path validation, PRAGMA application with read-back refusal, extension gate enabled only around the verified `sqlite-vec` load then disabled, verified-closed proof, close-on-failure.
  - [x] `packages/cluster-mesh/package.json` version bump to `0.26.0-dev.1`.
  - [x] Lot gate: `make typecheck-cluster-mesh ENV=test-memory-sqlite`.
- [x] **Lot 3 — Local acceptance (plan r2 §1.2)**
  - [x] `make -f Makefile -f packages/cluster-mesh/tests/storage/sqlite.mk cluster-mesh-sqlite-s0-qualify ENV=test-memory-sqlite`
  - [x] `make -f Makefile -f packages/cluster-mesh/tests/storage/sqlite.mk cluster-mesh-sqlite-test SCOPE=tests/storage/sqlite-l1 ENV=test-memory-sqlite`
  - [x] `make scope-check`
  - [x] `make down ENV=test-memory-sqlite`
- [ ] **Lot 4 — Review-ready head**
  - [ ] Single push of the final head; draft PR from this file; one CI run on the final head; report to `.tmp/rv/lot-SQL-L1.md`.
