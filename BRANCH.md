# Feature: Cluster-mesh storage-port lot K2b plus deferred K2a-2 (L3a v4.1 frozen)

## Objective
- [ ] Deliver the K2b shared corpus (staged-unit, journal, barrier, lifecycle) with M1 getter denial and inaccessible pages before/after disposal, plus discriminating mutations.
- [ ] Fix the deferred K2a-2 ticket from feat/cluster-mesh-storage-k1 (engram Sol R3 plus M11, Opus r3 MINEUR-1 through MINEUR-5).

## Scope / Guardrails
- [ ] Scope limited to K2b corpus files, the test-only staged reference, and the deferred K2a-2 hunks (BR-K2B-EX1).
- [ ] Make-only workflow, no direct Docker commands.
- [ ] Root workspace ~/src/sentropic is reserved for user dev/UAT (ENV=dev) and must remain stable.
- [ ] Branch development happens in worktree tmp/worktrees/cluster-mesh-storage-k2b.
- [ ] Automated test campaigns run on ENV=test-cm-k2b, never on dev.
- [ ] In every make command, ENV=test-cm-k2b passed as last argument with API_PORT=9505 UI_PORT=5705 MAILDEV_UI_PORT=1605.
- [ ] One Docker build at a time.
- [ ] All new text in English.
- [ ] Zero Python.
- [ ] Frozen comments M1 and merged engram L6a identity contract unchanged.
- [ ] No version bump (stays on the 0.15.0 candidate from PR #666).
- [ ] Corpus stays backend-agnostic: async, port-shaped, typed outcomes only, no reference internals, no message matching.

## Branch Scope Boundaries (MANDATORY)
- [ ] **Allowed Paths (implementation scope)**:
  - [ ] `BRANCH.md`
  - [ ] `packages/cluster-mesh/package.json`
  - [ ] `package-lock.json`
  - [ ] `packages/cluster-mesh/tests/storage/staged-corpus.ts`
  - [ ] `packages/cluster-mesh/tests/storage/replay-corpus.ts`
  - [ ] `packages/cluster-mesh/tests/storage/barrier-corpus.ts`
  - [ ] `packages/cluster-mesh/tests/storage/lifecycle-corpus.ts`
  - [ ] `packages/cluster-mesh/tests/storage/reference-staged.ts`
  - [ ] `packages/cluster-mesh/tests/storage/profile-mutations.spec.ts`
  - [ ] `.h2a/build/k2b_report.md`
  - [ ] `packages/cluster-mesh/tests/storage/reference-store.ts` (BR-K2B-EX1 deferred K2a-2 only)
  - [ ] `packages/cluster-mesh/tests/storage/read-corpus.ts` (BR-K2B-EX1 deferred K2a-2 only)
  - [ ] `packages/cluster-mesh/tests/storage/atomic-corpus.ts` (BR-K2B-EX1 deferred K2a-2 only)
  - [ ] `packages/cluster-mesh/tests/storage/reference.spec.ts` (BR-K2B-EX1 deferred K2a-2 only)
  - [ ] `packages/cluster-mesh/tests/storage/mutations.spec.ts` (BR-K2B-EX1 deferred K2a-2 only)
  - [ ] `packages/cluster-mesh/src/storage/readers.ts` (BR-K2B-EX1 deferred K2a-2 only)
- [ ] **Forbidden Paths (must not change in this branch)**:
  - [ ] `Makefile`
  - [ ] `docker-compose*.yml`
  - [ ] `.cursor/rules/**`
  - [ ] `plan/NN-BRANCH_*.md` (except this branch file)
  - [ ] `packages/comments/**`
  - [ ] `docs/comments-annotations/**`
  - [ ] `packages/cluster-mesh/src/live*/**`
  - [ ] `packages/cluster-mesh/src/comments/**`
  - [ ] `packages/cluster-mesh/src/modules/**`
  - [ ] `packages/cluster-mesh/src/runtime/**`
  - [ ] `.h2a/inputs/**`
  - [ ] `.h2a/reviews/**`
  - [ ] `.env`
- [ ] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [ ] `.github/workflows/**`
- [ ] Exception process:
  - [ ] Declare exception ID `BRxx-EXn` in Feedback Loop before touching any conditional/forbidden path.
  - [ ] Include reason, impact, and rollback strategy.
  - [ ] Mirror the same exception in this file under Feedback Loop.

## Feedback Loop
- [ ] `BR-K2B-DISC1` — One-time BRANCH.md rewrite (K1 content to K2b content) exceeds 150 changed lines through deletions alone; single logical change, all following commits stay under 150 lines with BRANCH.md in-commit.
- [ ] `BR-K2B-EX1` — Deferred K2a-2 ticket merged into K2b per the k2b brief: touch `packages/cluster-mesh/tests/storage/reference-store.ts`, `read-corpus.ts`, `atomic-corpus.ts`, `reference.spec.ts`, `mutations.spec.ts` and `packages/cluster-mesh/src/storage/readers.ts` (R3 effective-cursor fix, M6/M11 mutants, Opus r3 MINEUR-1..5). Reason: the k2b brief owns the K2a-2 follow-up; impact: K1/K2a hunks only, no M1/L6a contact; rollback: revert the EX1 hunks file by file, K2b corpus stays green on the reverted reference only for non-R3 areas.
- [x] `K2B-R3` — R3 fix: read pages measured with the effective returned cursor; 9 to 10 passage covered; skipped corpus test re-enabled and passing.
- [ ] `K2B-MUT` — Sol M11 replaced by the record-counting mutant killed at the envelope assertion; M6 leaks staged effects on guard failure and dies on the rollback assertion; regexes tightened.
- [ ] `K2B-MIN2` — Atomic corpus profile-parameterized: barrier/purge/predicate rejections apply only when the profile is absent; positive owners recorded (K3 predicates, K2b/S3/P2c barriers and purge).
- [ ] `K2B-MIN3` — `validateReadPage` byte limits apply to every record-carrying page; null-cursor and envelope-overflow validator tests added.
- [ ] `K2B-MIN4` — Read corpus cursor-integrity gaps deferred to K3 token semantics; header adjusted.
- [ ] `K2B-RED1` — RED staged corpus versus the unextended reference (hidden state, gaps, conflicts, atomic publication, recovery).
- [ ] `K2B-RED2` — RED replay corpus (ordering, watermark, checkpoint CAS, poison, resync, external interleave).
- [ ] `K2B-RED3` — RED barrier corpus (G1 denial before/after disposal, absence distinct, raw tombstone neutral, over-limit coverage, concurrent insertion).
- [ ] `K2B-RED4` — RED lifecycle corpus (unconfigured denial, conditional intent atomicity, holds, shared objects, crash-safe completion).
- [ ] `K2B-MUTB` — K2b discriminating mutations recorded and killed at their targeted assertions.

## AI Flaky tests
- [ ] Acceptance rule:
  - [ ] Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - [ ] Non-systematic means at least one success on the same commit and same command.
  - [ ] Never amend tests with additive timeouts.
  - [ ] If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - [ ] Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [ ] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] Multi-branch (only if sub-workstreams require independent CI or long-running validation)
- [ ] Rationale: single stacked branch on feat/cluster-mesh-storage-k1; one final test cycle.

## UAT Management (in orchestration context)
- [ ] **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- [ ] No UI changes in this branch: no UAT checkpoints.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and deferred ticket intake**
  - [x] Verify branch feat/cluster-mesh-storage-k2b at base 471628c19424812584fd2496474ef82ee3072d4a, stacked on feat/cluster-mesh-storage-k1 (PR #666).
  - [x] Read L3a-spec-v4.1-frozen §17 row K2b, G1 confirmation, K1 BRANCH K2a-2 ticket, engram Sol R3, Opus r3 minors.
  - [x] Create this BRANCH.md from plan/BRANCH_TEMPLATE.md.
- [ ] **Lot 1 — Deferred R3 and mutation fixes (BR-K2B-EX1)**
  - [x] R3: effective-cursor measurement in `reference-store.ts` plus 9 to 10 coverage in `read-corpus.ts`; un-skip the cursor-budget test in `reference.spec.ts`.
  - [ ] M6 dies on the guard-rollback assertion; M11 replaced by the record-counting mutant dying on the envelope assertion (`mutations.spec.ts`, `atomic-corpus.ts` message).
  - [ ] MIN2 profile parameterization (`atomic-corpus.ts`); MIN3 validator limits plus tests (`readers.ts`, `reference.spec.ts`); MIN4 header plus K3 deferral (`read-corpus.ts`).
  - [ ] Lot gate: typecheck, scoped cluster-mesh tests, lint, scope-check.
- [ ] **Lot 2 — Staged reference plus staged and replay corpora**
  - [ ] `reference-staged.ts`: staged units, journal, coverage/barrier groundwork.
  - [ ] `staged-corpus.ts` plus gate; `replay-corpus.ts` plus gate (gates in `profile-mutations.spec.ts`).
  - [ ] One discriminating mutation per staged and replay behavior.
  - [ ] Lot gate: typecheck, scoped cluster-mesh tests, lint, scope-check.
- [ ] **Lot 3 — Barrier and lifecycle corpora with G1**
  - [ ] `barrier-corpus.ts` with G1 denial before/after disposal plus gate.
  - [ ] `lifecycle-corpus.ts` (purge policy, holds, shared objects, completion) plus gate.
  - [ ] One discriminating mutation per barrier and lifecycle behavior.
  - [ ] Lot gate: typecheck, scoped cluster-mesh tests, lint, scope-check.
- [ ] **Lot N — Final validation**
  - [ ] Typecheck and Lint
  - [ ] Retest cluster-mesh: `make test-cluster-mesh API_PORT=9505 UI_PORT=5705 MAILDEV_UI_PORT=1605 ENV=test-cm-k2b`
  - [ ] `make scope-check API_PORT=9505 UI_PORT=5705 MAILDEV_UI_PORT=1605 ENV=test-cm-k2b`
  - [ ] No version bump: stays on the 0.15.0 candidate.
  - [ ] Final gate step 1: push only this branch and open a DRAFT PR to main noting "stacked on #666" (never merge).
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Write .h2a/build/k2b_report.md with finding/behavior to commit to test to mutation plus the exit SHA.
