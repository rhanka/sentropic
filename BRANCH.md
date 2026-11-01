# Feature: cluster-mesh identity core lot A2.1 — accounts, proofs, invitations, login sessions on durable stores

## Objective
Implement the durable storage backends for the frozen identity contracts of lot A2.0: PostgreSQL (hosted control profile) and SQLite (local profile) port implementations for `UserAccountStore`, `IdentityProofStore`, `InvitationStore`, `DeviceCodeStore`, `LoginSessionStore`, wired to the frozen domain factories (`createUserAccounts`, `createIdentityProofs`, `createInvitations`, `createDeviceEnrolment`, `createLoginSessions`).

## Scope / Guardrails
- Scope limited to the A2.1 slice of `packages/cluster-mesh` (accounts, proofs, invitations, device enrolment, login sessions, their audit appends). Tenants, memberships, workspaces, resolution, tid, RBAC decisions and cascades belong to lots A2.2/A2.3 and are NOT touched.
- `packages/cluster-mesh/src/identity-contracts/**` is FROZEN: no semantic change; only type imports and factory calls. `packages/cluster-mesh/tests/identity-*.spec.ts` is FROZEN: the contract suite runs UNMODIFIED against the durable profiles through a campaign alias, never by editing the specs.
- No app change (`api/**`, `ui/**` untouched); the hosted drizzle control migration for the app cutover belongs to A4.1 per spec r2 §1/§5.
- No new dependency: PostgreSQL goes through the existing `InjectedPgDriver` protocol, SQLite through the existing `node:sqlite` engine in `src/storage/sqlite/`.
- Make-only workflow; Docker one build at a time under the packet flock; `ENV=test-cm-a2-1` always LAST; `make down ENV=test-cm-a2-1` after each campaign.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/cluster-mesh/src/storage/identity/**`
  - `packages/cluster-mesh/src/index.ts`
  - `packages/cluster-mesh/tests/storage/postgres-identity.spec.ts`
  - `packages/cluster-mesh/tests/storage/sqlite-identity.spec.ts`
  - `packages/cluster-mesh/tests/identity/**`
  - `packages/cluster-mesh/package.json`
  - `packages/cluster-mesh/tests/fixtures/reserved-versions.ts`
  - `packages/cluster-mesh/tests/storage/pack-only-dev-gate.mjs`
  - `packages/cluster-mesh/tests/storage/pack-only-dev-gate.spec.ts`
  - `packages/cluster-mesh/tests/packaging/prepare-artifacts.spec.ts`
  - `package-lock.json` (version-sync line only, BRA21-EX3)
  - `.gitignore` (root-anchored `identity/` ignore rule only, BRA21-EX4)
  - `BRANCH.md`
  - `e2e/tests/05-usecase-detail.spec.ts` (SSE regression diagnosis and readiness assertion only, BRA21-EX5)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `api/**`, `ui/**`
  - `packages/cluster-mesh/src/identity-contracts/**` (frozen public contracts)
  - `packages/cluster-mesh/tests/identity-*.spec.ts` (frozen contract suite, runs unmodified)
  - `packages/cluster-mesh/assets/**` (migration assets belong to the kernel migration chain, not this slice)
  - Any file owned by lots A2.2/A2.3 (tenancy, workspaces, resolution, decision stores)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
- [x] BRA21-EX5: owner=lane author; review_by=PR review; owner-requested investigation of run 41254113814 reproduced the unchanged constraints assertion locally; allow only the failing E2E scenario's diagnostic instrumentation and subscription readiness correction; impact limited to test ordering, no timeout increase; rollback by reverting the test hunk.
- [x] BRA21-SSE1: root cause=test sends PUT after the SSE request starts but before PostgreSQL LISTEN is ready; unchanged baseline failed, observational timing alternated to success, and a controlled gate reproduced the exact failure with PUT 200 before SSE 200/ping and no usecase_update; fix=observe the first ping for the matching workspace/request before PUT, retaining the existing 15000ms readiness budget and 30000ms content assertion; full spec=15 passed, 1 skipped; no identity/auth production change or flaky waiver.
- [x] BRA21-OBS2: PostgreSQL contract validation initially hit the unchanged 5000ms guards in the first two lifecycle cases (87 passed, 2 failed); the identical command and source then passed 89/89; both logs retained in `.tmp/a21-sse-pg-contracts{,-initial}.log`; no contract, timeout or store change and no waiver; timing cause not established.
- [x] BRLOCK-EX1 carried verbatim from `origin/main` for gate continuity (owner=CI maintainers; review_by=2026-11-30T00:00:00Z; this branch exercises the lock scope via the one-line root lockfile workspace version sync under BRA21-EX3; remove on PR closure; rollback by reverting this branch).
- [x] BRA21-EX1: owner=lane author; review_by=PR review; new-file commits above the 150-line advisory where a file must land whole (schema/codec/postgres/sqlite modules and profile harness, mirroring the A2.0 BRA2-EX1 whole-module precedent for compilable units); impact limited to branch history; rollback by reverting the branch.
- [x] BRA21-EX2: owner=lane author; review_by=PR review; carry `0.26.0-dev.2` after rebasing over #860/#861 (`main` at `0.26.0-dev.1`); preserve main's `RESERVED_NEXT=0.26.0` and published pin `0.25.0` in `tests/fixtures/reserved-versions.ts` and `tests/storage/pack-only-dev-gate.mjs`; union both sides' negative vectors in `pack-only-dev-gate.spec.ts` and `prepare-artifacts.spec.ts`; registry rechecked at `0.25.0`, dependency/peer metadata unchanged; impact limited to version-train test support, no gate logic or frozen range widened; rollback by reverting the branch.
- [x] BRA21-EX3: owner=lane author; review_by=PR review; single-line root `package-lock.json` version sync for `packages/cluster-mesh` (CI train lock-sync assertion; precedent `db534d4b9`); no other lockfile change; rollback by reverting the branch.
- [x] BRA21-EX4: owner=lane author; review_by=PR review; anchor the local agent-state ignore rule `identity/` to the repo root as `/identity/` so the tracked campaign harness `packages/cluster-mesh/tests/identity/**` is not swallowed; root-level h2a agent state stays ignored (verified: `identity/aliases.jsonl` and `.h2a/identity/` both remain ignored); impact limited to ignore resolution for nested `identity/` directories, none of which exist outside the new test harness; rollback by reverting the branch.
- [x] BRA21-OBS1: owner=lane author; status=local retry passed, no waiver; rebase validation first hit unchanged 5000ms guards in SQLite `identity-lifecycle.spec.ts:48` (5226ms) and `prepare-artifacts.spec.ts:137` (5050ms); identical commands and tree then passed (registration 2653ms; artifact fixture 1875ms); no spec, timeout or gate changed; initial and successful logs retained in worktree `.tmp/a21-*.log`.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.
- Record (BRA21-FLAKE1): `make test-cluster-mesh ENV=test-cm-a2-1` at head `7ef805dbf` failed 13 tests, every one with signature `Error: Test timed out in 5000ms` (`tests/engram-memory/sqlite-roundtrip.spec.ts`, `tests/storage/instance-ownership.spec.ts`, `tests/storage/sqlite-capabilities.spec.ts`, `tests/storage/sqlite-corpus.spec.ts`, `tests/storage/sqlite-lanes.spec.ts`, `tests/storage/sqlite-s0-identity.spec.ts`, `tests/storage/sqlite-s0.spec.ts`) while parallel lanes held the shared machine at load average ~25; unrelated to this branch (no kernel or frozen-spec change; the same command at the same head passed 1471/1471 once the machine quieted); no test amended, no timeout raised.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: one storage slice behind frozen ports; parallel lots A2.2/A2.3 run on their own branches and are not merged here.

## UAT Management (orchestration context)
- No UI change in this branch; no UAT required. Durable store qualification happens through the contract suite and the round-trip specs.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read COMMON-RULES packet, owner answers, gap document, A2-lots parallelism contract, r2 spec sections for F02-F05/F10-accounts.
  - [x] Create isolated worktree `tmp/worktrees/cm-identity-a2-1` on `feat/cm-identity-a2-1` from `origin/main`.
  - [x] Capture Makefile targets: `test-cluster-mesh`, `typecheck-cluster-mesh`, `lint-cluster-mesh`, `scope-check`, `commit`, `down`, `cluster-mesh-pg-test` (postgres.mk), `cluster-mesh-sqlite-test` (sqlite.mk).
  - [x] Environment mapping: `ENV=test-cm-a2-1`, always last.
- [x] **Lot 1 — Durable identity store slice (A2.1)**
  - [x] `src/storage/identity/schema.ts`: one logical schema, two dialects (PostgreSQL control schema, SQLite local profile) for the five record tables plus the identity audit events table.
  - [x] `src/storage/identity/records.ts`: row codecs shared by both backends.
  - [x] `src/storage/identity/postgres.ts`: schema apply + `createPostgresIdentityCoreStores` over `InjectedPgDriver` (SERIALIZABLE transactions, atomic conditional updates for single-use consumption, bounded serialization retry). Factory names carry the `IdentityCore` infix after the A2.2 merge exported identically named `createPostgresIdentityStores`/`applyPostgresIdentitySchema` from `src/identity-stores/`; the frozen contracts never reference the factory names.
  - [x] `src/storage/identity/sqlite.ts`: schema apply + `createSqliteIdentityCoreStores` over the existing `node:sqlite` storage engine (process-isolated owner, WAL); same `IdentityCore` infix for the same reason.
  - [x] `src/storage/identity/wiring.ts`: `wireIdentityDomains` binding the frozen factories to the durable slice + `createCryptoTokenPort` (token entropy from `node:crypto`).
  - [x] Export the slice from `src/index.ts`.
  - [x] Lot gate:
    - [x] `make typecheck-cluster-mesh ENV=test-cm-a2-1` + `make lint-cluster-mesh ENV=test-cm-a2-1`
- [x] **Lot 2 — Contract suite unmodified on both profiles**
  - [x] `tests/identity/profiles/postgres.ts` + `tests/identity/vitest.postgres.config.ts`: alias the frozen contract suite onto the PostgreSQL-backed slice (five A2.1 stores durable; unlanded slices keep the reference doubles).
  - [x] `tests/identity/profiles/sqlite.ts` + `tests/identity/vitest.sqlite.config.ts`: same for the SQLite profile.
  - [x] Campaign: `cluster-mesh-pg-test` with `SCOPE=--config=tests/identity/vitest.postgres.config.ts` (disposable PostgreSQL, CM_PG_URL inside the workspace container).
  - [x] Campaign: `test-cluster-mesh` with `SCOPE=--config=tests/identity/vitest.sqlite.config.ts`.
  - [x] The three `tests/identity-*.spec.ts` files remain byte-identical (verified with `git diff origin/main -- tests/identity-`).
- [x] **Lot 3 — Round-trip and concurrency specs**
  - [x] `tests/storage/postgres-identity.spec.ts`: registration → pending → approval → login on PostgreSQL; invitation consumed exactly once under concurrent consumers; revoke-all effective on the next call; driver-level restart persistence.
  - [x] `tests/storage/sqlite-identity.spec.ts`: same corpus on SQLite plus engine close/reopen persistence and the single-writer engine fence.
  - [x] Mechanical no-outside-writer check: `grep -rn "identity_" packages/cluster-mesh/src --include="*.ts" -l` lists only `src/storage/identity/**`.
- [x] **Lot 4 — Version train and lock sync**
  - [x] `package.json` → `0.26.0-dev.2` (next dev after main's `0.26.0-dev.1` from #861; published stable remains `0.25.0`).
  - [x] `RESERVED_NEXT` → `0.26.0` (published pin advanced to `0.25.0`); dev-gate vectors rolled one line forward (BRA21-EX2).
  - [x] `package-lock.json` single-line version sync (BRA21-EX3).
  - [x] Lot gate: packaging dev-gate specs pass.
- [x] **Lot 5 — Final validation**
  - [x] `make typecheck-cluster-mesh ENV=test-cm-a2-1`, `make lint-cluster-mesh ENV=test-cm-a2-1`
  - [x] Full default unit lane: `make test-cluster-mesh ENV=test-cm-a2-1`
  - [x] PostgreSQL lane: `make -f Makefile -f packages/cluster-mesh/tests/storage/postgres.mk cluster-mesh-pg-test SCOPE=tests/storage/postgres-identity.spec.ts ENV=test-cm-a2-1` then `cluster-mesh-pg-down`
  - [x] Contract-on-profiles campaigns (Lot 2) re-run on the final head.
  - [x] `make down ENV=test-cm-a2-1` after each campaign.
  - [x] Bumped `packages/cluster-mesh/package.json` version (enforced by CI `enforce-package-bump`).
  - [ ] Draft PR to main, push `--force-with-lease` on `feat/cm-identity-a2-1` only, ONE CI run on the final head, wait for completed/success.
  - [ ] Report to `.tmp/rv/lot-A2.1.md` (PR, head, CI run id + conclusion, acceptance item by item). Do not merge.
- [ ] **Lot 6 — Owner-requested rebase after #860 and #861**
  - [x] Rebase onto `origin/main` `329cc11d0`; retain this branch's plan and all three lots' exports, including #861's disambiguated enforcement factory names.
  - [x] Preserve main's reserved-next `0.26.0` / published pin `0.25.0` and union both sides' negative gate vectors without changing gate logic.
  - [x] Regenerate the `0.26.0-dev.2` root lock entry through `make chat-migration-lockfiles`; verify strict consumer-lock union (all 8 profiles preserved; result identical to main); discard only the unrelated UI lock regeneration hunk.
  - [x] Run scope C2 and type checks; unmodified identity campaigns: PostgreSQL 89/89, SQLite 82 passed + 7 PG-only skips; A2.1 round trips 6/6 each; A2.2/A2.3 specs included; pack-only and artifact gates 20/20 each; publication bump fixtures 30/30; lockfile gate 11/11; all under the flock, PostgreSQL teardown and `make down` after.
  - [ ] Commit through `make commit`, push this branch only with `--force-with-lease`, wait for one CI run on the final head, append head/run/conflict/version evidence to `.tmp/rv/lot-A2.1.md`; do not merge.
  - [ ] Track handoff: designated main writer imports this source artifact and final report for the rebase request, deliverables and owner-selected `0.26.0-dev.2`; this lane does not write the shared `.track` log.
- [ ] **Lot 7 — Owner-requested group-e SSE failure investigation**
  - [x] Reproduce run 41254113814 with `make test-e2e E2E_SPEC=tests/05-usecase-detail.spec.ts WORKERS=1 RETRIES=0 API_PORT=9365 UI_PORT=5565 MAILDEV_UI_PORT=1465 ENV=e2e-cm-a2-1`; identical constraints assertion failed at the unchanged 30000ms guard on head `ea81f128c`.
  - [x] Trace cookie/session validation, revoke-all and app wiring: app uses `session` and `userSessions`; A2.1 factories have no app callers; relevant auth/SSE files are byte-identical to base `329cc11d0`.
  - [x] Establish event ordering with browser evidence, correct the demonstrated defect and rerun the scoped E2E without increasing timeouts; logs and the discarded diagnostic patch are retained in `.tmp/a21-sse-*`.
  - [x] Run both identity contract profiles and relevant API tests sequentially under the shared flock: PostgreSQL 89/89, SQLite 82 passed + 7 PostgreSQL-only skips, round trips 6/6 on each engine; API 53/53 across `streams.test.ts`, `cluster-mesh-streams-cutover.test.ts`, `initiatives.test.ts`, `cluster-mesh-session.test.ts`, `auth/session.test.ts`, and `unit/auth/session-manager.test.ts`; PostgreSQL teardown, `down-api-ci` and `make down` completed.
  - [ ] Commit through `make commit`, force-with-lease this branch only, wait for one final-head CI, append evidence to `.tmp/rv/lot-A2.1.md`, and stop without merging.
  - [ ] Track handoff: designated main writer imports Lot 7 and the final report; this lane preserves the single-writer Track boundary.
