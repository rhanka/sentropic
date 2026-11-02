# Feature: cm-identity-a2-0b

## Objective
Implement the approved A2.0b additive amendment (Astra MAX author, Muse Wonder max APPROVE) for the identity core in packages/cluster-mesh: verification custody, lossless import, atomic person deletion.

## Scope / Guardrails
- Scope limited to packages/cluster-mesh identity custody, storage, import, deletion, tests, version manifest.
- One migration max in api/drizzle/*.sql (not used; CM schema assets only).
- Make-only workflow, no direct Docker commands.
- Branch development in isolated worktree tmp/worktrees/cm-identity-a2-0b.
- Automated test campaigns on dedicated environments (ENV=test-cm-a2-0b), never root dev.
- In every make command, ENV=<env> passed as the last argument.
- All new text in English.
- Pins: amendment A2.0b-r6 sha256 5bde078cd12a35fb752eadb48496f0373dc8940883c701b920878a31bb836165; review a2-0b_wonder_r6 APPROVE sha256 0734a46e930b8fc456a431005d392203a347c1e19262305ac3c2a7e109206433; lot-A4 sha256 3826e88cad5f6fd368ce12c392d72634f78b411946e0354776e14cd984d6f8ed; lot-A4-prerequisites.patch sha256 11476ebd89c6aec73dcf7b20984323926310a331bff9d421a73c1fa6ec475ff5; baseline origin/main 455813bf923e9a58f701b17d2adbef01b2df0e71.
- Version: 0.26.0-dev.4 (next free cluster-mesh dev version after main 0.26.0-dev.3).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/src/identity-contracts/**`
  - `packages/cluster-mesh/src/storage/identity/**`
  - `packages/cluster-mesh/src/identity-stores/**`
  - `packages/cluster-mesh/src/identity/**`
  - `packages/cluster-mesh/tests/identity/**`
  - `packages/cluster-mesh/tests/identity-*.spec.ts`
  - `packages/cluster-mesh/package.json`
  - `packages/cluster-mesh/CHANGELOG.md`
  - `packages/cluster-mesh/tests/storage/postgres.mk` (BR-A20B-EX1)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `api/**`
  - `ui/**`
  - `e2e/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
  - `packages/cluster-mesh/tests/storage/postgres.mk` (BR-A20B-EX1)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- [x] BR-A20B-EX1: repair PostgreSQL qualification readiness in `packages/cluster-mesh/tests/storage/postgres.mk`; the current Unix-socket probe can accept initdb's temporary server before `storage_test` exists. Impact: test startup only, unchanged retry budget. Rollback: revert the readiness hunk.
- [x] Resume baseline: `e2bba5cc9`; six final SQLite failures in `run-full11.log` are 5000ms expirations; PostgreSQL fails before Vitest. No timeout increases or assertion removals authorized.
- [x] Correct the truncated amendment SHA-256 against the approved r6 file.
- [x] Add SQLite schema atomicity regression tests before implementation.
- [x] Require a successful TCP query against the actual PostgreSQL test database; preserve the 30-attempt startup budget and print startup diagnostics on failure.
- [x] Replace autocommitted SQLite schema statements with one savepoint-protected batch and initialize the core bundle once per factory; runtime qualification pending.
- [x] Refuse missing PostgreSQL configuration in the dedicated profile instead of substituting the in-memory oracle.
- [ ] Resolve inherited r6 composition gaps before claiming amendment completion: the shipped UOW exposes `runRead/runWrite`, while r6 requires the combined bound composition consumed by A4.
- [ ] Verify schema regression red, implement transactional schema installation, and verify green.
- [ ] Run each final identity database campaign once under the shared Docker flock, then clean up.
- [ ] Push the final head, open a ready PR, wait for one CI, and write `.tmp/rv/lot-A2.0b.md`.

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
- Rationale: Single additive contract lot with one test cycle; no parallel sub-branches.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- No UI changes in this lot; no UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read COMMON-RULES, MASTER.md, amendment r6, review r6 APPROVE, lot-A4, patch.
  - [x] Create isolated worktree tmp/worktrees/cm-identity-a2-0b on feat/cm-identity-a2-0b from origin/main.
  - [x] Pin sha256 values in BRANCH.md.
  - [x] Set version 0.26.0-dev.4.
- [ ] **Lot 1 — Custody contracts (additive, 1.0 frozen)**
  - [ ] New V1 record/port/error/descriptor exports; IDENTITY_CUSTODY_CONTRACT_VERSION 1.1.0, IDENTITY_ATOMIC_DELETION_CONTRACT_VERSION 2.0.0.
  - [ ] IdentityCustodyErrorV1 with exact code union; fixed messages; buffer-ownership rules.
  - [ ] IDENTITY_A20B_DESCRIPTORS exact rows.
  - [ ] Lot gate: make typecheck-cluster-mesh ENV=test-cm-a2-0b
- [ ] **Lot 2 — Durable custody on both profiles**
  - [ ] New tables: account_profiles, webauthn_credentials, single_use_proofs, email_tickets, invitation_digests, login_token_bindings, social_links, subject_fences, deletion ops/attempts, revocation outbox, import receipts, schema versions.
  - [ ] Postgres + SQLite stores with CAS, uniqueness, expiry strictness.
  - [ ] Lot gate: custody storage tests on both profiles.
- [ ] **Lot 3 — Import contract (id-preserving, material-preserving)**
  - [ ] createIdentityCustodyImporterV1: validate/importBatch/importBatchInTransaction, exclusive-writer fence, identical-receipt replay, whole-batch rollback.
  - [ ] Field-preserving mapping incl. WebAuthn bytes/counter, unbound proofs, digest invitations, session hashes, social subjects.
  - [ ] Lot gate: custody-import tests on both profiles.
- [ ] **Lot 4 — Atomic person deletion (V2)**
  - [ ] createAtomicPersonDeletionV2 with business participants, orphan assertions, rolled_back receipts, operation journal.
  - [ ] P4/P5 probes green on both profiles; existing cascade suite unmodified.
  - [ ] Lot gate: atomic-person-deletion tests on both profiles.
- [ ] **Lot 5 — Security evidence**
  - [ ] Secret at rest, SHA-256 exact preimages, zeroization of owned buffers, log redaction canaries.
  - [ ] Lot gate: security tests on both profiles.
- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint
  - [ ] Retest cluster-mesh identity suites (both profiles, no skips)
  - [ ] Bumped packages/cluster-mesh/package.json version 0.26.0-dev.4
  - [ ] Final gate step 1: create a ready PR using BRANCH.md text as PR body after local qualification (owner continuation).
  - [ ] Final gate step 2: run/verify branch CI once and resolve remaining blockers.
  - [ ] Do NOT merge; report to .tmp/rv/lot-A2.0b.md and stop.
