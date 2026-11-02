# Feature: SQLite local durable artifacts adapter set (upstream request U1)

## Objective
Ship a durable LOCAL SQLite adapter set in @sentropic/artifacts equivalent to the Postgres adapters (bindings, intents, idempotency, ACL, lifecycle, publication state, refcounts, commit coordinator with the 0.2.6 CAS, activation store, local PublicationBlobStore with digest verification), proven by one parameterized conformance suite run against BOTH Postgres and SQLite, exported as the new `@sentropic/artifacts/sqlite` subpath so the root/portable entries stay free of node:sqlite.

## Scope / Guardrails
- Scope limited to packages/artifacts (new sqlite adapters + tests + packaging), the cluster-mesh artifacts peer-range widening, api APP-P1 digest refresh, and the two workspace lock version entries.
- Make-only workflow, no direct Docker commands; the single Docker lock is /home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md taken PER COMMAND via flock.
- Branch development happens in isolated worktree tmp/worktrees/artifacts-sqlite-u1 on branch feat/artifacts-sqlite-u1 from origin/main.
- Tests run on ENV=test-artifacts-u1 (passed LAST), never ENV=dev; `make down ENV=test-artifacts-u1` after.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English. No secrets anywhere. No [skip ci]. Commits via `make commit MSG="..."` only, <=150 lines, selective staging, push after each commit.
- Driver: node:sqlite (DatabaseSync), the same driver cluster-mesh identity/storage uses; no new native dependency, no better-sqlite3.
- Where SQLite cannot give the same atomicity as Postgres, one serialized writer transaction (BEGIN IMMEDIATE) is used and documented in the adapter header. There is no second behaviour.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/artifacts/**` (new `src/adapters/sqlite*.ts`, `src/adapters/local-blob.ts`, `sql/sqlite/*`, tests, package.json, CHANGELOG.md, README.md)
  - `packages/cluster-mesh/src/modules/catalog.ts`
  - `packages/cluster-mesh/package.json`
  - `packages/cluster-mesh/CHANGELOG.md`
  - `packages/cluster-mesh/tests/packaging/artifacts-tuple.spec.ts`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
  - `api/src/services/mcp/cluster-registry.ts`
  - `api/tests/api/app-mcp-registry.test.ts`
  - `api/tests/api/app-mcp-installed.test.ts`
  - `package-lock.json` (workspace version entries only)
  - `api/package-lock.json` (workspace version entries only)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `packages/artifacts/src/server/**` (ports and domain stay untouched)
  - `packages/artifacts/src/adapters/postgres*.ts`, `packages/artifacts/src/adapters/s3.ts` (reference adapters stay untouched)
  - `packages/artifacts/src/index.ts` (root barrel must stay free of node:sqlite)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.
- BR-U1-EX1: `packages/cluster-mesh/tests/packaging/fixtures/selected/{package.json,package-lock.json}` added to Allowed Paths; they mirror the cluster-mesh version/peer bump exactly as 4ed0b4009 did on main (BR01-EX1/EX2). First scope-check run flagged them as unknown before the declaration; re-run after declaring.

## AI Flaky tests
- Acceptance rule: non-systematic provider/network/model nondeterminism only, with one success on the same commit and command; never additive timeouts; record command + file + signature here if accepted.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single branch, single final test cycle)
- Rationale: one deliverable (U1) on one branch; no orthogonal sub-workstreams.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read rules/MASTER.md, rules/workflow.md, COMMON-RULES packet, h2a plan §1.3 U1 wording.
  - [x] Create worktree tmp/worktrees/artifacts-sqlite-u1 on feat/artifacts-sqlite-u1 from origin/main; `harness check branch` PASS.
  - [x] Write BRANCH.md from plan/BRANCH_TEMPLATE.md.
  - [x] Confirm command style: `flock <docker-lock> make ... ENV=test-artifacts-u1` with ENV last.
- [x] **Lot 1 — Tests first: parameterized conformance suite (RED)**
  - [x] `packages/artifacts/tests/fixtures/adapter-conformance.ts` — one parameterized suite over a backend factory: store conformance (ensure/bindings incl. concurrent + terminal gone, intents, preparation-intent cleanup reads, idempotency replay/conflict, ACL, sources, lifecycle, publication state + CAS, refcounts/pins, registered blobs), commit-executor conformance (coordination-row convergence, serialized finalization, receipt exactly-once + replay, rollback residue, CAS), activation conformance (vector list incl. concurrent-consume, single-use, expiry, cleanup bounds, invalidation, ttl cap, commit-unknown), blob-store conformance (round-trip, digest verification, hostile keys, prefix listing, strict delete), restart durability (reopen), concurrent writers.
  - [x] `packages/artifacts/tests/fixtures/activation-conformance.ts` + `tests/fixtures/sqlite-backend.ts` — driver-neutral vector runner and sqlite backend.
  - [x] `packages/artifacts/tests/sqlite-conformance.test.ts` — runs the suite against SQLite only (unit run, no services): 20/20 GREEN.
  - [x] `packages/artifacts/tests/adapter-conformance.integration.test.ts` — runs the SAME suite against Postgres (DATABASE_URL) and SQLite in one file (parity proof): 36/36 GREEN.
  - [x] RED first: suite failed while `../src/adapters/sqlite.js` did not exist.
- [x] **Lot 2 — SQLite store adapter (GREEN)**
  - [x] `packages/artifacts/sql/sqlite/0001_artifacts.sql` + `0002_activation.sql` — SQLite DDL mirroring migrations 0001-0005 + sql/0001_activation.sql semantics.
  - [x] `packages/artifacts/src/adapters/sqlite.ts` + `sqlite-sql.ts` + `sqlite-store.ts` — `createSqliteArtifactStore` over node:sqlite, BEGIN IMMEDIATE serialized writer, documented atomicity note.
  - [x] Targeted run: `make test-artifacts SCOPE=tests/sqlite-conformance.test.ts ENV=test-artifacts-u1` GREEN; `make down ENV=test-artifacts-u1`.
- [x] **Lot 3 — Commit coordinator + management unit**
  - [x] `packages/artifacts/src/adapters/sqlite-commit.ts` — `createSqliteCommitExecutor` (ensureCoordinationRow, beginFinalization with BEGIN IMMEDIATE, lockOperationKey as in-transaction serialization, receipts with 23505 mapping, commit/rollback/release).
  - [x] `packages/artifacts/src/adapters/sqlite-management.ts` — `createSqliteManagementUnit` (ManagementUnit port).
  - [x] Coordinator conformance vectors GREEN on both backends.
- [x] **Lot 4 — Activation store**
  - [x] `packages/artifacts/src/adapters/sqlite-activation.ts` — tickets/flows/consume/cleanup/invalidate with the same semantics (generation invalidation, single-use consume, bounded cleanup, ActivationCommitUnknownError on commit-ack loss).
  - [x] Activation conformance vectors GREEN on both backends.
- [x] **Lot 5 — Local blob store**
  - [x] `packages/artifacts/src/adapters/local-blob.ts` — `createLocalBlobStore({ root })` implementing PublicationBlobStore on the filesystem with sha256 digest verification on put and get, same key validation, strict delete, sorted prefix listing, restart durability.
- [x] **Lot 6 — Packaging**
  - [x] package.json: `./sqlite` subpath export, files, version 0.3.0 (minor over published 0.2.6), peerDependenciesMeta unchanged (node:sqlite is builtin).
  - [x] Root/portable entries stay free of node:sqlite: `tests/sqlite-export.test.ts` asserts the root barrel module graph loads no sqlite module and no better-sqlite3, and that `@sentropic/artifacts/sqlite` resolves with all factories (2/2 GREEN); pack guard bounds package.json at MAX_MANIFEST_BYTES=1MiB.
  - [x] `ARTIFACTS_PROVIDER_VERSION` = '0.3.0' in mcp-core.ts; artifacts CHANGELOG 0.3.0 entry.
  - [x] cluster-mesh: ARTIFACTS_RANGE `>=0.2.0 <0.4.0` (catalog.ts + package.json peerDependencies), artifacts-tuple.spec.ts assertion, cluster-mesh 0.26.0-dev.6 bump.
  - [x] Lock pins: root + api package-lock.json workspace version entries + selected tuple fixture.
  - [x] APP-P1 refresh: APP_P1_MANIFEST_DIGEST recomputed as cb03aeae35dfcaad215b5a3d9f685587677a5bdde9bdc81950ba6d9d7f35ca82 (probe reproduces the pinned c69c8ce... digest at version 0.2.6, proving faithfulness); updated api cluster-registry.ts + app-mcp-registry.test.ts + app-mcp-installed.test.ts.
- [x] **Lot 7 — Full verification**
  - [x] `make build-artifacts typecheck-artifacts lint-artifacts ENV=test-artifacts-u1` GREEN (flock per command).
  - [x] `make test-artifacts ENV=test-artifacts-u1` GREEN: 527/527 tests, 49 files (incl. sqlite conformance 20/20 and sqlite-export 2/2).
  - [x] `make test-artifacts-integration SCOPE=tests/adapter-conformance.integration.test.ts ENV=test-artifacts-u1` GREEN on BOTH backends: 36/36; then `make down ENV=test-artifacts-u1`.
  - [x] `make pack-artifacts ENV=test-artifacts-u1` guarded pack GREEN: `PASS @sentropic/artifacts@0.3.0 mode=block (standalone-default) sha256=d43ce28738cb77aa0daf74ebbef092711e25bbb1f47fb1a715db5d520ef67a70`.
  - [x] api scoped tests for the APP-P1 refresh: app-mcp-registry + app-mcp-installed GREEN (24/24) after `up-api-test REGISTRY=local ENV=test-artifacts-u1` booted with the new digest; `make down` after.
  - [x] cluster-mesh artifacts-tuple source coherence GREEN (4 passed, 3 pre-existing skips).
- [x] **Lot 8 — Ship**
  - [x] Commits <=150 lines via make commit, `make scope-check` PASS C2 before each, push after each commit (21 commits, head `06af81ce5`).
  - [x] READY PR #891 (base main, head `06af81ce5b713216971a6df667d4b867b2dd7953`); CI dispatched manually (pull_request event spawned no Actions run): run 41513527288 on `02b867035` FAILED only on the selected-fixture candidate-version pin, fixed in `06af81ce5` (fixture + tuple-spec integrity pinned to the 0.3.0 candidate archive; local `make test-cluster-mesh SCOPE=tests/packaging ENV=test-artifacts-u1` 83 passed / 55 pre-existing skips); re-run 41524343776 on `06af81ce5` **success**, zero failed jobs. Report at `.tmp/rv/artifacts-sqlite-u1.md`. Not merged.
