# Feature: SQL-L1 — SQLite connection factory, PRAGMAs & Stage-0 extension gate

## Objective
- [x] Deliver fast-track plan r2 lot `SQL-L1`: `openSqliteDatabase()` in `packages/cluster-mesh/src/storage/sqlite/connection.ts` enforcing `WAL`, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000`, `trusted_schema=OFF`, and `SQLITE_DBCONFIG_ENABLE_LOAD_EXTENSION=1` only around a verified `sqlite-vec` load then `0`, plus the `packages/cluster-mesh/tests/storage/sqlite.mk` targets `cluster-mesh-sqlite-s0-qualify` and `cluster-mesh-sqlite-test`.

## Scope / Guardrails
- [x] Branch `feat/sql-l1` from `origin/main` (`1b7f8ab94`); worktree `tmp/sql-l1`; draft PR targets main.
- [x] Environment `ENV=test-memory-sqlite` (plan r2 §1.2/§4.2), always the LAST make argument; never `ENV=dev`; `make down ENV=<env>` after Docker steps; the post-rebase acceptance re-run (SQL-L1-EX7) uses `ENV=test-sql-l1` per the conductor packet, same rules.
- [x] Serialize Docker work under the flock at `.tmp/packets/DOCKER-LOCK.md`.
- [x] Make targets only; no Python, no direct npm/docker publication, no `clean-all`, no merge, no native addon builds.
- [x] CI lockfile-lane policy acknowledged (review_by=2026-11-30T00:00:00Z); installs resolve committed tool profiles or frozen consumer closures.
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
  - `packages/cluster-mesh/tests/fixtures/reserved-versions.ts` (pack-only reserved-next/published-pin contract; the mandated dev bump moves the reserved line to `0.26.0`)
  - `packages/cluster-mesh/tests/storage/pack-only-dev-gate.mjs` (the contract's bare-probe mirror, same move)
  - `packages/cluster-mesh/tests/storage/pack-only-dev-gate.spec.ts` (the mirror's table and refusal cases, same move)
  - `packages/cluster-mesh/tests/packaging/prepare-artifacts.spec.ts` (the contract's packaging-side `isPackOnlyDevBump` table, same move)
  - `scripts/ci/consumer-locks.json` (SQL-L1-EX6/EX7: frozen consumer closures for the published pins the installed CI lane resolves through this committed universe — `0.24.0` and, after the `0.25.0` release, `0.25.0`; #855 adds the same `0.24.0` profile line for its tuple move)
  - `package-lock.json` (only the `packages/cluster-mesh` workspace version entry; the CI `changes` train lock-sync gate requires the root lockfile to mirror the package bump, refreshed through `make chat-migration-lockfiles`)
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
- [x] SQL-L1-EX2: the first push failed the CI `changes` train lock-sync gate (`packages/cluster-mesh` manifest `0.26.0-dev.1` vs root lockfile `0.24.0`); the gate-mandated refresh ran through `make chat-migration-lockfiles` and the branch keeps only the `packages/cluster-mesh` lockfile entry; the refresh's collateral chat-core root/ui hunks (pre-existing main staleness: chat-core manifest `0.3.1` vs lockfile `0.3.0`, unchecked by the train gate) were reverted as out of scope for this lot; impact is one lockfile line plus this record; rollback is `git revert` of the lockfile commit.
- [x] SQL-L1-EX3: the first Stage-0 recipe installed the pinned tool with a direct registry resolution and the CI lock scan (`scripts/ci/ci-lockfile-installs.mjs`) rejected it as `unlocked npm resolution`; the recipe now resolves the committed frozen tool graph `tests/storage/sqlite-l1/vec-tool/` (manifest plus npm-authored lock, `sqlite-vec@0.1.9`) with `npm ci`, and the runner asserts the loaded vec version equals the committed pin; the record-only replacement of this file had also dropped the CI lockfile-lane acknowledgment line required by `scripts/ci/ci-lockfile-installs.test.mjs` (`review_by=2026-11-30T00:00:00Z`), restored here; impact is the vec-tool graph, the s0 recipe and this record; rollback is `git revert` of the remediation commit.
- [x] SQL-L1-EX4: the mandated dev bump `0.26.0-dev.1` moves the pack-only reserved-next/published-pin contract (`tests/fixtures/reserved-versions.ts` and its `tests/storage/pack-only-dev-gate.*` mirror) from the `0.24.0` line to `RESERVED_NEXT='0.26.0'` with `LATEST_PUBLISHED_CLUSTER_MESH='0.24.0'`, exactly as #855 moved the same contract for `0.25.0-dev.1`; impact is the constants, their mirrors and test tables; rollback is `git revert` of the tuple commit.
- [x] SQL-L1-EX5: EX4 missed the packaging-side `isPackOnlyDevBump` table in `tests/packaging/prepare-artifacts.spec.ts` that #855 moves together with the same contract (the full local suite rerun caught four deterministic row failures on the stale `0.24.0` line); the twelve `it.each` rows now mirror the same `0.26.0`-line mapping as the storage mirror; impact is twelve table rows, one allowed-path bullet and this record; rollback is `git revert` of the remediation commit.
- [x] SQL-L1-EX6: the third CI run (41100900152) failed the `validate-cluster-mesh (source installed major)` lane's installed-consumer step with `ETARGET No matching version found for @sentropic/cluster-mesh@0.24.0`: the lane resolves the published pin through the frozen registry universe built from committed consumer closures (`scripts/ci/consumer-locks.json`), which still offered only the `0.23.2` closure; #855's tuple move adds the `@sentropic/cluster-mesh@0.24.0` profile for exactly this reason and this branch mirrors that profile line verbatim (one npm-authored registry closure line); local parity before the commit: the lane's exact consumer install resolves `0.24.0` through `locked-consumer.mjs` (exit 0, 105 packages) and `node --test scripts/ci/ci-lockfile-installs.test.mjs` passes 11/11; impact is one data line in a conditional path plus this record; rollback is `git revert` of the remediation commit. The same run's `build-api-image` (GitHub Actions Cache 503), `ci-capacity-receipts` (Actions API `HttpError: Server Error`) and `security-container` (join reporting `security-container-api` unexpectedly skipped) failures are GitHub-side infrastructure: the concurrent #855 run 41099543104 failed exactly these three lanes plus the aggregate gate, and no branch content can address them.
- [x] SQL-L1-EX7: after #844 released `@sentropic/cluster-mesh@0.25.0` the branch rebased onto `origin/main` (`0cdbf146a`, conflicts resolved: `BRANCH.md` and the gate files keep this branch's `0.26.0` line, `packages/cluster-mesh/package.json` keeps main's release manifest content with this branch's `0.26.0-dev.1` version, `package-lock.json` takes main's lock with the entry re-synced through `make chat-migration-lockfiles`); main's release commit moved the `selected` packaging fixture to the `0.25.0` tarball and the pack-only alignment derives its frozen base from that fixture, so the frozen published pin follows the release: `LATEST_PUBLISHED_CLUSTER_MESH` moves `0.24.0` → `0.25.0` with `RESERVED_NEXT='0.26.0'` unchanged (the pin is the latest published release whose dependency and peer metadata equals the candidate's — `0.25.0` published, candidate metadata unchanged), exactly as `eea2cf0a6`/`112d47285` (BRA2-EX2) moved constants and tables together; the tables in `pack-only-dev-gate.spec.ts` and `prepare-artifacts.spec.ts` roll to the `0.25.0` pin on the same `0.26.0` reserved line; the installed CI lane's frozen registry universe gains the npm-authored `@sentropic/cluster-mesh@0.25.0` consumer closure (mirroring `258aa6a49`/EX6 for `0.24.0`); impact is the pin constants, their mirrors and tables, one consumer-closure data line, one lockfile line plus this record; rollback is `git revert` of the three commits.

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
- [x] **Lot 3-R — Post-rebase acceptance re-run (SQL-L1-EX7, `ENV=test-sql-l1`)**
  - [x] `make chat-migration-lockfiles` — root lock idempotent at `0.26.0-dev.1`; the ui chat-core `0.3.0 → 0.3.1` collateral hunk is pre-existing main drift outside this branch's paths and stays reverted.
  - [x] Post-Rebase Gate `npm view @sentropic/cluster-mesh version` → published `0.25.0` < head `0.26.0-dev.1`; bump gate at merge-base `0cdbf146a` (`0.25.0` → `0.26.0-dev.1`); train lock-sync `cluster-mesh@0.26.0-dev.1` (llm-mesh `0.32.2`, llm-gateway `0.22.2` from main).
  - [x] `make scope-check ENV=test-sql-l1` and the harness scope check on the full `origin/main..HEAD` file list — PASS C2.
  - [x] `make -f Makefile -f packages/cluster-mesh/tests/storage/sqlite.mk cluster-mesh-sqlite-s0-qualify ENV=test-sql-l1` — 10 cases, 0 skipped (engine `3.53.4`, vec `v0.1.9`).
  - [x] `make -f Makefile -f packages/cluster-mesh/tests/storage/sqlite.mk cluster-mesh-sqlite-test SCOPE=tests/storage/sqlite-l1 ENV=test-sql-l1` — 6/6, Type Errors none.
  - [x] `make test-cluster-mesh ENV=test-sql-l1` — 163 files passed | 65 skipped, 1471 tests passed | 246 skipped, Type Errors none (pack-only gates `pack-only-dev-gate.spec.ts` 17/17, `prepare-artifacts.spec.ts` 17/17).
  - [x] `make lint-cluster-mesh ENV=test-sql-l1` and `make typecheck-cluster-mesh ENV=test-sql-l1` — green.
  - [x] `make test-ci-lockfile-installs ENV=test-sql-l1` — 11/11; installed-lane consumer parity `@sentropic/cluster-mesh@0.25.0 @sentropic/comments@0.3.0` through the frozen universe — exit 0, 105 packages.
  - [x] `make down ENV=test-sql-l1`.
- [ ] **Lot 4 — Review-ready head**
  - [ ] Single push of the final head; draft PR from this file; one CI run on the final head; report to `.tmp/rv/lot-SQL-L1.md`.
