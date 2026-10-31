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
- [x] BRA21-EX1: owner=lane author; review_by=PR review; new-file commits above the 150-line advisory where a file must land whole (schema/codec/postgres/sqlite modules and profile harness, mirroring the A2.0 BRA2-EX1 whole-module precedent for compilable units); impact limited to branch history; rollback by reverting the branch.
- [x] BRA21-EX2: owner=lane author; review_by=PR review; reserved-next dev-train roll one step forward per BRA2-EX2 precedent: carry `0.26.0-dev.1` in `package.json`, advance `RESERVED_NEXT` to `0.26.0` in `tests/fixtures/reserved-versions.ts` + mirror in `tests/storage/pack-only-dev-gate.mjs`, roll the dev-gate vectors in `pack-only-dev-gate.spec.ts` + `prepare-artifacts.spec.ts` one line forward; published pin advanced to `0.25.0` (latest published release whose dependency/peer metadata equals the candidate's; registry probed after the `0.25.0` release landed, metadata identical — required by `prepare-artifacts.spec.ts`, whose selected fixture already pins `sentropic-cluster-mesh-0.25.0.tgz` on main); impact limited to version-train test support, no frozen range widened; rollback by reverting the branch.
- [x] BRA21-EX3: owner=lane author; review_by=PR review; single-line root `package-lock.json` version sync for `packages/cluster-mesh` (CI train lock-sync assertion; precedent `db534d4b9`); no other lockfile change; rollback by reverting the branch.
- [x] BRA21-EX4: owner=lane author; review_by=PR review; anchor the local agent-state ignore rule `identity/` to the repo root as `/identity/` so the tracked campaign harness `packages/cluster-mesh/tests/identity/**` is not swallowed; root-level h2a agent state stays ignored (verified: `identity/aliases.jsonl` and `.h2a/identity/` both remain ignored); impact limited to ignore resolution for nested `identity/` directories, none of which exist outside the new test harness; rollback by reverting the branch.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

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
  - [x] `src/storage/identity/postgres.ts`: schema apply + `createPostgresIdentityStores` over `InjectedPgDriver` (SERIALIZABLE transactions, atomic conditional updates for single-use consumption, bounded serialization retry).
  - [x] `src/storage/identity/sqlite.ts`: schema apply + `createSqliteIdentityStores` over the existing `node:sqlite` storage engine (process-isolated owner, WAL).
  - [x] `src/storage/identity/wiring.ts`: `wireIdentityDomains` binding the frozen factories to the durable slice + `createCryptoTokenPort` (token entropy from `node:crypto`).
  - [x] Export the slice from `src/index.ts`.
  - [x] Lot gate:
    - [x] `make typecheck-cluster-mesh ENV=test-cm-a2-1` + `make lint-cluster-mesh ENV=test-cm-a2-1`
- [ ] **Lot 2 — Contract suite unmodified on both profiles**
  - [x] `tests/identity/profiles/postgres.ts` + `tests/identity/vitest.postgres.config.ts`: alias the frozen contract suite onto the PostgreSQL-backed slice (five A2.1 stores durable; unlanded slices keep the reference doubles).
  - [x] `tests/identity/profiles/sqlite.ts` + `tests/identity/vitest.sqlite.config.ts`: same for the SQLite profile.
  - [ ] Campaign: `cluster-mesh-pg-test` with `SCOPE=--config=tests/identity/vitest.postgres.config.ts` (disposable PostgreSQL, CM_PG_URL inside the workspace container).
  - [x] Campaign: `test-cluster-mesh` with `SCOPE=--config=tests/identity/vitest.sqlite.config.ts`.
  - [x] The three `tests/identity-*.spec.ts` files remain byte-identical (verified with `git diff origin/main -- tests/identity-`).
- [ ] **Lot 3 — Round-trip and concurrency specs**
  - [ ] `tests/storage/postgres-identity.spec.ts`: registration → pending → approval → login on PostgreSQL; invitation consumed exactly once under concurrent consumers; revoke-all effective on the next call; driver-level restart persistence.
  - [ ] `tests/storage/sqlite-identity.spec.ts`: same corpus on SQLite plus engine close/reopen persistence and the single-writer engine fence.
  - [x] Mechanical no-outside-writer check: `grep -rn "identity_" packages/cluster-mesh/src --include="*.ts" -l` lists only `src/storage/identity/**`.
- [ ] **Lot 4 — Version train and lock sync**
  - [x] `package.json` → `0.26.0-dev.1` (next free dev on the next train; `0.25.0` is already the released stable on main).
  - [x] `RESERVED_NEXT` → `0.26.0` (published pin advanced to `0.25.0`); dev-gate vectors rolled one line forward (BRA21-EX2).
  - [x] `package-lock.json` single-line version sync (BRA21-EX3).
  - [ ] Lot gate: packaging dev-gate specs pass.
- [ ] **Lot 5 — Final validation**
  - [ ] `make typecheck-cluster-mesh ENV=test-cm-a2-1`, `make lint-cluster-mesh ENV=test-cm-a2-1`
  - [ ] Full default unit lane: `make test-cluster-mesh ENV=test-cm-a2-1`
  - [ ] PostgreSQL lane: `make -f Makefile -f packages/cluster-mesh/tests/storage/postgres.mk cluster-mesh-pg-test SCOPE=tests/storage/postgres-identity.spec.ts ENV=test-cm-a2-1` then `cluster-mesh-pg-down`
  - [ ] Contract-on-profiles campaigns (Lot 2) re-run on the final head.
  - [ ] `make down ENV=test-cm-a2-1` after each campaign.
  - [ ] Bumped `packages/cluster-mesh/package.json` version (enforced by CI `enforce-package-bump`).
  - [ ] Draft PR to main, push `--force-with-lease` on `feat/cm-identity-a2-1` only, ONE CI run on the final head, wait for completed/success.
  - [ ] Report to `.tmp/rv/lot-A2.1.md` (PR, head, CI run id + conclusion, acceptance item by item). Do not merge.
