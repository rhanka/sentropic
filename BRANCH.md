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
- (empty at branch start)

## AI Flaky tests
- Acceptance rule: non-systematic provider/network/model nondeterminism only, with one success on the same commit and command; never additive timeouts; record command + file + signature here if accepted.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single branch, single final test cycle)
- Rationale: one deliverable (U1) on one branch; no orthogonal sub-workstreams.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read rules/MASTER.md, rules/workflow.md, COMMON-RULES packet, h2a plan §1.3 U1 wording.
  - [x] Create worktree tmp/worktrees/artifacts-sqlite-u1 on feat/artifacts-sqlite-u1 from origin/main; `harness check branch` PASS.
  - [x] Write BRANCH.md from plan/BRANCH_TEMPLATE.md.
  - [x] Confirm command style: `flock <docker-lock> make ... ENV=test-artifacts-u1` with ENV last.
- [ ] **Lot 1 — Tests first: parameterized conformance suite (RED)**
  - [ ] `packages/artifacts/tests/fixtures/adapter-conformance.ts` — one parameterized suite over a backend factory: store conformance (ensure/bindings incl. concurrent + terminal gone, intents, preparation-intent cleanup reads, idempotency replay/conflict, ACL, sources, lifecycle, publication state + CAS, refcounts/pins, registered blobs), commit-executor conformance (coordination-row convergence, serialized finalization, receipt exactly-once + replay, rollback residue, CAS), activation conformance (vector list incl. concurrent-consume, single-use, expiry, cleanup bounds, invalidation, ttl cap, commit-unknown), blob-store conformance (round-trip, digest verification, hostile keys, prefix listing, strict delete), restart durability (reopen), concurrent writers.
  - [ ] `packages/artifacts/tests/sqlite-conformance.test.ts` — runs the suite against SQLite only (unit run, no services).
  - [ ] `packages/artifacts/tests/adapter-conformance.integration.test.ts` — runs the SAME suite against Postgres (DATABASE_URL) and SQLite in one file (parity proof).
  - [ ] RED: suite fails because `../src/adapters/sqlite.js` does not exist yet.
- [ ] **Lot 2 — SQLite store adapter (GREEN)**
  - [ ] `packages/artifacts/sql/sqlite/0001_artifacts.sql` (+ activation schema asset) — SQLite DDL mirroring migrations 0001-0005 + sql/0001_activation.sql semantics.
  - [ ] `packages/artifacts/src/adapters/sqlite.ts` — `createSqliteArtifactStore` implementing the same interfaces as `PostgresArtifactStore` over node:sqlite, BEGIN IMMEDIATE serialized writer, documented atomicity note.
  - [ ] Targeted run: `make test-artifacts SCOPE=tests/sqlite-conformance.test.ts ENV=test-artifacts-u1` GREEN; `make down ENV=test-artifacts-u1`.
- [ ] **Lot 3 — Commit coordinator + management unit**
  - [ ] `packages/artifacts/src/adapters/sqlite-commit.ts` — `createSqliteCommitExecutor` (CommitExecutor: ensureCoordinationRow, beginFinalization returning a FinalizeConnection with BEGIN IMMEDIATE, lockOperationKey as in-transaction serialization, receipts, commit/rollback/release).
  - [ ] `packages/artifacts/src/adapters/sqlite-management.ts` — `createSqliteManagementUnit` (ManagementUnit port).
  - [ ] Coordinator conformance vectors GREEN on both backends.
- [ ] **Lot 4 — Activation store**
  - [ ] `packages/artifacts/src/adapters/sqlite-activation.ts` — tickets/flows/consume/cleanup/invalidate with the same semantics (generation invalidation, single-use consume, bounded cleanup, ActivationCommitUnknownError on commit-ack loss).
  - [ ] Activation conformance vectors GREEN on both backends.
- [ ] **Lot 5 — Local blob store**
  - [ ] `packages/artifacts/src/adapters/local-blob.ts` — `createLocalBlobStore({ root })` implementing PublicationBlobStore on the filesystem with sha256 digest verification on put and get, same key validation, strict delete, sorted prefix listing, restart durability.
- [ ] **Lot 6 — Packaging**
  - [ ] package.json: `./sqlite` subpath export(s), files, version 0.3.0 (minor over published 0.2.6), peerDependenciesMeta unchanged (node:sqlite is builtin).
  - [ ] Root/portable entries stay free of node:sqlite: test asserting the root barrel module graph contains no `node:sqlite`/`better-sqlite3` and that `@sentropic/artifacts/sqlite` resolves (portable size/entry budget).
  - [ ] `ARTIFACTS_PROVIDER_VERSION` = '0.3.0' in mcp-core.ts; CHANGELOG entries (artifacts 0.3.0, cluster-mesh range widening).
  - [ ] cluster-mesh: ARTIFACTS_RANGE `>=0.2.0 <0.4.0` (catalog.ts + package.json peerDependencies), artifacts-tuple.spec.ts assertion, cluster-mesh version bump.
  - [ ] Lock refresh through make: root + api package-lock.json workspace version entries.
  - [ ] APP-P1 refresh through make: recompute APP_P1_MANIFEST_DIGEST, update api cluster-registry.ts + app-mcp-registry.test.ts + app-mcp-installed.test.ts.
- [ ] **Lot 7 — Full verification**
  - [ ] `make build-artifacts typecheck-artifacts lint-artifacts ENV=test-artifacts-u1` (flock per command).
  - [ ] `make test-artifacts ENV=test-artifacts-u1` GREEN (unit incl. sqlite conformance).
  - [ ] `make test-artifacts-integration SCOPE=tests/adapter-conformance.integration.test.ts ENV=test-artifacts-u1` GREEN on BOTH backends; then `make down ENV=test-artifacts-u1`.
  - [ ] `make pack-artifacts ENV=test-artifacts-u1` guarded pack GREEN.
  - [ ] api scoped tests for the APP-P1 refresh: app-mcp-registry + app-mcp-installed GREEN.
  - [ ] cluster-mesh artifacts-tuple source coherence GREEN.
- [ ] **Lot 8 — Ship**
  - [ ] Commits <=150 lines via make commit, `make scope-check` before each, push after each commit.
  - [ ] READY PR from BRANCH.md text; one CI run; report to .tmp/rv/artifacts-sqlite-u1.md. Do not merge.
