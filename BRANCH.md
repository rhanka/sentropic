# Fix: Engram E10a-2 lossless K7 capture carriage

## Objective
- Preserve every Engram K7 field, remove receipt reconstruction, pin canonical byte round trips and prove installed Engram hydration refuses divergent entry/control receipts.

## Scope / Guardrails
- Base `origin/feat/engram-e2-integration` at `d08d44b78`; branch `feat/cluster-mesh-engram-e10a2`; worktree `tmp/worktrees/mem-e10a2`; draft PR against `feat/engram-e2-integration`; merge only, never rebase, never force-push.
- Ports: API 8792, UI 5192, Maildev UI 1092; no service stack required; `ENV=test-mem-e10a2` last; never `ENV=dev`; never `make clean-all`; 0 Python.
- One Docker step at a time under `/home/antoinefa/.cache-tmp/sentropic-docker.lock`; `make down ENV=test-mem-e10a2` after each Docker step.
- Commits under 150 lines via `make commit`, specific `git add` only, no AI trailers.
- Additive export only on the frozen `./engram-memory` surface: rationale is that the installed export has no neutral-handle factory and the frozen Engram substrate speaks snake-case K7/K8 wire while the kernel validator expects the camel-case proof model; impact is new exported factory and pure adaptation helpers with no change to existing exported behavior, digests or descriptors; rollback is removal of the new modules, their exports and the pack-only version increment.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/src/engram-memory/**`
  - `packages/cluster-mesh/tests/engram-memory/**`
  - `packages/cluster-mesh/package.json`
  - `package-lock.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
  - `packages/cluster-mesh/tests/packaging/prepare-artifacts.spec.ts`
  - `packages/cluster-mesh/tests/fixtures/reserved-versions.ts`
  - `packages/cluster-mesh/tests/storage/pack-only-dev-gate.mjs`
  - `packages/cluster-mesh/tests/storage/pack-only-dev-gate.spec.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/engram/**`
  - `api/**`
  - `ui/**`
  - `.github/workflows/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `packages/cluster-mesh/src/storage/**` (not activated)
- **Exception process**:
  - No exception declared; the additive `./engram-memory` export is declared above with rationale, impact and rollback.

## Feedback Loop
- [x] Conductor split (2026-10-28): **temporary, fail-closed deviation from gr-conductor condition 2**. Leave the existing intentHash computation unchanged pending an Engram producer change; producer 0.22.0 supplies no intentHash carrier at `transaction.apply`. No claim of condition 2 compliance or E10 qualification; promotion remains blocked until producer-owned intent carriage is verified. [Contract blocker](/home/antoinefa/src/sentropic/.tmp/mem-e10a2-contract-blocker.md); [review gate](/home/antoinefa/src/sentropic/.tmp/packets/mem-E10a2-review-gate.md).
- [x] K7 layout: preserve all snake fields other than `record_digest` in `proof`, including `receipt_digest` and unknown extensions; preserve `record_digest` separately as `recordDigest` so only it can change on completion. Read the entry from that row alone. No new kernel digest or renaming of Engram digest values.
- [x] Initial K7 version rule: Engram 0.22.0 selects `record_digest !== undefined ? '2' : '1'` when no previous row exists; subsequent writes use previous version + 1 (frozen substrate line 5684). The adapter's semantic revision follows presence of `record_digest`; aggregate version remains the producer's supplied value. Kernel transition validation still requires creation before completion.
- [x] Opus r1 P1: reproduce nine malformed-proof failures; validate K7/K8 before translation and map canonical JSON errors to `invalid-schema`; exercise the installed Engram commit loop with no reconcile.
- [x] CI accepted baseline `05cecaa6f`; rerun CI on the revision head before handoff.
- [x] Opus r1 P2-D: enforce R-G3-1 second-holder refusal before side effects, including concurrent acquisitions; refresh ownership at checkFence per binding §§9.3–9.6 and test release/failure cleanup.
- [x] Opus r1 P1/P2-E: assert the adapted commit digest equals Engram's expectedIntentHash and round-trips through findIdempotency; typecheck the real PostgreSQL kernel/driver without casts and refuse binary memory reads.
- [x] Opus r1 P2-F: bound readChain buffering and stop paging at the requested post-allocation limit; refuse malformed/non-canonical cursors and invalid read bounds with typed schema refusals.
- [x] BRE10a-EX1: owner-authorized PR #808 CI repair in `tmp/worktrees/mem-e10a-ci`, `ENV=test-mem-e10a-ci`; rationale: a frozen prerelease pin breaks pack-only alignment after the dev bump; impact: pin the selected fixture and lock to `0.23.2`, the latest published release whose dependency and peer metadata equals the candidate's (0.23.3/0.23.4 peer ranges differ), align the mirrored contract and assert only that frozen registry request; rollback: revert this repair commit. Registry reconfirmed `0.23.4` on 2026-10-28.
- Frozen-surface gates from the pack-only tolerance and the Comments gate lines must still pass on this branch; any failure is blocking for this lot.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: single additive module lot with unit tests and one pack-only version increment.

## Plan / Todo (lot-based)
- [x] **Lot E10a-2.0 — Resume and split contract**
  - [x] Read project rules, blocker, Docker lock and review gate; mechanical harness branch check passed.
  - [x] Record condition 2 deviation and initial K7 version rule; do not change intentHash computation.
- [x] **Lot E10a-2.1 — Lossless row and byte regression**
  - [x] Preserve K7 fields in `src/engram-memory/wire-adaptation.ts`; delete cross-row receipt rejoin from transaction and neutral-handle reads.
  - [x] `tests/engram-memory/wire-adaptation.spec.ts`: 41 passed, including byte round trips in both directions for created/completed K7, K8, journal add/strip and no control read.
- [x] **Lot E10a-2.2 — Installed producer hydration**
  - [x] `tests/engram-memory/receipt-hydration.spec.ts` and its host fixture: matching entry/control receipts reopen; differing valid receipt digests refuse with `JOURNAL_CORRUPT`, for created and completed captures, through real installed Engram.
  - [x] Frozen Engram 0.22.0 archive SHA-256 `26a0edd50c338f30593d22ae1f06ac13d82f5557f18558750659bcfefec64c10`; 2 passed, no skips. [Installed-lane log](/home/antoinefa/src/sentropic/.tmp/mem-e10a2-evidence/installed-engram-022-hydration.log). The ordinary CI lane retains its installed 0.21.1 baseline and also executes these tests; the 0.22.0 archive is unpublished and is supplied only to the qualification command.
- [ ] **Lot E10a-2.3 — Pack and draft handoff**
  - [x] Bump pack-only package/workspace lock to `0.24.0-dev.5` (`dev.4` reserved for #803); no publication. npm latest verified `0.23.4` on 2026-10-28.
  - [ ] Scoped tests, cluster-mesh typecheck/lint/full tests and frozen-surface packaging gates; scope check before each commit; tear down after Docker steps.
  - [ ] Pack/copy tarball to `/home/antoinefa/src/sentropic/.tmp/engram-e2-host-tuple/e10-artifacts/`; report SHA-256.
  - [ ] Draft PR with this file as body; CI completed/success on exact head; relay handoff via conductor only.
- [x] **Inherited E10a history below — baseline evidence only**
- [x] **Lot E10a-0 — Baseline and constraints**
  - [x] Read `rules/MASTER.md`, `plan/BRANCH_TEMPLATE.md` and the E10a conductor packet.
  - [x] Create isolated worktree `tmp/worktrees/mem-e10a` on `feat/cluster-mesh-engram-e10a` from `origin/feat/engram-e2-integration` at `ef585a6b1164923929add4dfee2c8a64390da267`.
  - [x] Confirm ports API 8792, UI 5192, Maildev UI 1092 and `ENV=test-mem-e10a` last.
  - [x] Declare the additive `./engram-memory` export with rationale, impact and rollback in Scope / Guardrails.
- [x] **Lot E10a-1 — Wire adaptation**
  - [x] Add pure K7/K8 snake-case and camel-case adaptation both ways plus journal intent-hash carry and strip in `packages/cluster-mesh/src/engram-memory/`.
  - [x] Add unit tests for the adaptation both ways and for each refusal.
  - [x] Lot gate: scoped cluster-mesh tests for the new spec files.
- [x] **Lot E10a-2 — Neutral-handle factory**
  - [x] Add the fenced neutral-handle factory with fence acquire, check and release, transact, query, readCommitResult and host DDL/SQL through the injected driver.
  - [x] Export the factory and the adaptation through `./engram-memory` without changing existing exports, digests or descriptors.
  - [x] Add unit tests for fence, grant and driver refusals.
  - [x] Lot gate: scoped cluster-mesh tests plus typecheck and lint for cluster-mesh.
- [ ] **Lot E10a-3 — Pack-only version and handoff**
  - [x] Increment the pack-only version to `0.24.0-dev.3` in the package manifest and the workspace lock for the reviewed fixes.
  - [x] Repair the stable selected fixture/lock pin; shared-lock `ENV=test-mem-e10a-ci` runs: targeted packaging 17 passed; full cluster-mesh 1361 passed, 268 conditional skips, no type errors; `make down` after each step.
  - [x] Run `make scope-check` and the frozen-surface gates before every commit.
  - [x] Push and open the draft PR against `feat/engram-e2-integration` with `BRANCH.md` as the PR body.
  - [x] Require CI on the exact head before marking ready (baseline `05cecaa6f`; repeat for revisions).
