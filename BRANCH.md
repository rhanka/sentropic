# feat(identity): add durable verification custody and atomic deletion

## Objective
Add durable verification custody, material-preserving import and atomic person deletion to packages/cluster-mesh. Imported credential bytes, digests, session hashes and social subjects survive storage; required deletion failures roll back identity and business rows together. The approved A2.0b r6 amendment defines the intended contract; the remaining composition and proof gaps below block full acceptance.

## Validation evidence and remaining acceptance gaps
- Full SQLite profile: 185/185 tests pass in 20 files; zero skipped or todo cases.
- Full PostgreSQL profile: 185/185 tests pass in 20 files; zero skipped or todo cases.
- Both campaigns ran once under the shared Docker flock with `ENV=test-cm-a2-0b`. P1–P5, custody security cases and the unchanged frozen identity suite executed.
- New schema regression: three expected rollback assertion failures before the fix; all six cases pass afterward. No timeout was increased and no existing assertion was weakened.
- Source/test TypeScript checks and package ESLint pass. The only post-campaign source edit removes a redundant literal type annotation; runtime behavior is unchanged.
- PostgreSQL initialization exceeded the original 30-attempt startup bound under local disk pressure. Its logs then confirmed initialization complete; the TCP database probe passed before the first test campaign.
- Full acceptance remains blocked: the inherited UOW uses `runRead/runWrite` instead of the r6 combined bound composition consumed by A4; the P1 fixture does not verify a real WebAuthn assertion, and PostgreSQL reopening reuses handles.
- Review is incomplete: Argon's qualification-wiring finding is fixed; Mistral failed before producing a review. Final-head consensus is not claimed.
- CI budget: first run 41389276220 failed train lock-sync; the owner authorized one second ready-PR-triggered run for the scoped dev.4 lock repair. Do not merge.
- Rebased onto `c8e9fa652` to resolve the sole `BRANCH.md` conflict blocking PR #882 CI. Identity source, test and runner files are byte-identical to the qualified tree. Post-rebase registry gate: `0.26.0-dev.4` is greater than published `0.25.0` and is still free.

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
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json` (required by `scripts/ci/ci-lockfile-installs.test.mjs`).

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
  - `package-lock.json` (BR-A20B-EX3)
  - `api/package-lock.json` (BR-A20B-EX3)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json` (BR-A20B-EX3)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json` (BR-A20B-EX3)
  - `packages/cluster-mesh/tests/storage/postgres.mk` (BR-A20B-EX1)
  - `packages/cluster-mesh/tests/storage/cold-workspace.sh` (BR-A20B-EX2)
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
- [x] Fix review r1 finding 6: compose core, tenancy, enforcement, custody and operation ports over one guarded executor and the A2.3 audit sink.
- [x] Fix review r1 finding 6: add registration/email lifecycle and active/deadline/read-only SQL guards for combined transaction handles.
- [x] Fix review r1 finding 6: bind journal, outbox, cleanup and subject/workspace/email locks to the active host SQL executor.
- [x] Fix review r1 finding 6: bound core/enforcement variants bypass constructor DDL and nested transactions; standalone frozen behavior remains available to its existing callers.
- [x] Fix review r1 finding 6: migrate remote-delivery.spec.ts to combined run/options without weakening assertions (runtime qualification pending).
- [x] Fix review r1 finding 6: migrate connector-custody.spec.ts to combined run/options without weakening assertions (runtime qualification pending).
- [x] Fix review r1 finding 6: migrate atomic-person-deletion.spec.ts to combined run/options without weakening assertions (runtime qualification pending).
- [x] Fix review r1 finding 6: migrate custody-storage.spec.ts to combined run/options without weakening assertions (runtime qualification pending).
- [x] Fix review r1 finding 6: migrate custody-security.spec.ts to combined run/options without weakening assertions (runtime qualification pending).
- [x] Fix review r1 finding 6: migrate custody-import.spec.ts to combined run/options without weakening assertions (runtime qualification pending).
- [x] Fix review r1 finding 6: migrate custody-concurrency.spec.ts to combined run/options without weakening assertions (runtime qualification pending).
- [x] Fix review r1 finding 6: migrate auth-binding.spec.ts to combined run/options without weakening assertions (runtime qualification pending).
- [x] Fix review r1 finding 6: migrate a20b-prerequisites.spec.ts to combined run/options without weakening assertions (runtime qualification pending).
- [x] Fix review r1 finding 6: migrate a20b-helpers.ts to combined run/options without weakening assertions (runtime qualification pending).
- [ ] Fix review r1 findings 1/8: tests preceded fixes for counter regression and exact refusal precedence on both profiles; durable execution pending the shared Docker lock.
- [ ] Fix review r1 findings 2–7/9/10: tests first, amendment-exact fixes, both durable profiles, final PR CI and per-finding report; do not merge.
- [ ] Fix review r1 findings 3/9: source HS256 claims and missing HMAC key code corrected after regression tests; execution pending.
- [ ] Fix review r1 finding 4: purge retains bound completed magic links and live ticket parents, deleting expired tickets first; regression execution pending.
- [ ] Fix review r1 finding 2: delivered replay is a no-op; pending custody is checked and the delivered row re-read before erasure; regression execution pending.
- [ ] Fix review r1 findings 5/10: mandatory RESTRICT/SET NULL foreign keys and native PostgreSQL booleans implemented after real-engine schema regressions; parent fixture/cleanup qualification pending.
- [ ] Fix review r1 finding 5 follow-through: fixtures create real parents, deletion removes tickets before proofs and detaches invitations before workspaces; qualification pending.
- [ ] Fix review r1 finding 6: tests pin eleven descriptors and the combined run/mode/purpose/attempt-budget transaction surface, rollback, read-only and handle lifetime before implementation.
- [ ] Fix review r1 findings 6/7: add the exact lifecycle, cleanup, journal, delivery and plane contracts; bind the implementations in subsequent atomic commits.
- [ ] Fix review r1 finding 6: replace split UOW calls with the combined public interface; add the exact import inventory and required nullable custody dependency.
- [x] BR-A20B-EX3 (owner-authorized Fix CI 1): synchronize only cluster-mesh dev.4 in root/API workspace locks and selected packaging fixture pins; preserve unrelated dependency selections and integrity records. Impact: version metadata only. Rollback: revert these four files together with the version bump.
- [x] BR-A20B-EX1: repair PostgreSQL qualification readiness in `packages/cluster-mesh/tests/storage/postgres.mk`; the current Unix-socket probe can accept initdb's temporary server before `storage_test` exists. Impact: test startup only, unchanged retry budget. Rollback: revert the readiness hunk.
- [x] BR-A20B-EX2: wire the existing identity profile configs into the package runner and PostgreSQL CI lane; otherwise frozen tests use the default in-memory factory. Impact: required identity qualification only, unchanged assertions and timeouts. Rollback: revert the runner/target additions.
- [x] Resume baseline: `e2bba5cc9`; six final SQLite failures in `run-full11.log` are 5000ms expirations; PostgreSQL fails before Vitest. No timeout increases or assertion removals authorized.
- [x] Correct the truncated amendment SHA-256 against the approved r6 file.
- [x] Add SQLite schema atomicity regression tests before implementation.
- [x] Require a successful TCP query against the actual PostgreSQL test database; preserve the 30-attempt startup budget and print startup diagnostics on failure.
- [x] Replace autocommitted SQLite schema statements with one savepoint-protected batch and initialize the core bundle once per factory; both runtime profiles pass.
- [x] Refuse missing PostgreSQL configuration in the dedicated profile instead of substituting the in-memory oracle.
- [ ] Resolve inherited r6 composition gaps before claiming amendment completion: the shipped UOW exposes `runRead/runWrite`, while r6 requires the combined bound composition consumed by A4.
- [x] Verify schema regression red, implement transactional schema installation, and verify green.
- [x] Run each final identity database campaign once under the shared Docker flock, then clean up; both receipts contain 185 passes and zero skips, owned containers removed, `make down` completed.
- [x] Push the final head, open a ready PR, wait for one CI, and write `.tmp/rv/lot-A2.0b.md`; run 41389276220 failed deterministic train lock-sync.
- [x] Fix CI 1: scoped `make lock-root` and API/selected fixture pins agree on dev.4; train lock-sync, 48 packaging/dev-gate tests, 16 lock-install/publish-decision tests and registry train integrity pass. Unrelated lock bytes are unchanged. All Docker work and `make down ENV=test-cm-a2-0b` completed under the shared lock using the existing Node image; no image build or deletion.
- [ ] Fix CI 1: commit through Make, push once, wait for the authorized second PR CI, append its head/run/result to the report, and stop without merging.

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
  - [x] Typecheck & Lint
  - [x] Retest cluster-mesh identity suites (both profiles, no skips)
  - [x] Bumped packages/cluster-mesh/package.json version 0.26.0-dev.4
  - [x] Final gate step 1: create a ready PR using BRANCH.md text as PR body after local qualification (owner continuation): https://github.com/rhanka/sentropic/pull/882.
  - [ ] Final gate step 2: run/verify branch CI once and resolve remaining blockers.
  - [ ] Do NOT merge; report to .tmp/rv/lot-A2.0b.md and stop.
