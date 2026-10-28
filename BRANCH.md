# Fix: Engram E10a-2 lossless K7 capture carriage

## Objective
- Preserve every Engram K7 field, remove receipt reconstruction, pin canonical byte round trips and prove installed Engram hydration refuses divergent entry/control receipts.

## Scope / Guardrails
- Base `origin/feat/engram-e2-integration` at `d08d44b78`; branch `feat/cluster-mesh-engram-e10a2`; worktree `tmp/worktrees/mem-e10a2`; draft PR against `feat/engram-e2-integration`; merge only, never rebase, never force-push.
- Ports: API 8792, UI 5192, Maildev UI 1092; no service stack required; `ENV=test-mem-e10a2` last; never `ENV=dev`; never `make clean-all`; 0 Python.
- One Docker step at a time under `/home/antoinefa/.cache-tmp/sentropic-docker.lock`; `make down ENV=test-mem-e10a2` after each Docker step.
- Commits under 150 lines via `make commit`, specific `git add` only, no AI trailers.
- Existing `./engram-memory` boundary only: preserve K7 producer values through the kernel proof model, with no contract/descriptor digest change. Rollback: revert this branch's K7 translation and test changes together with its pack-only version increment.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/src/engram-memory/**`
  - `packages/cluster-mesh/tests/engram-memory/**`
  - `packages/cluster-mesh/package.json`
  - `package-lock.json`
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
  - No exception required for this lot.

## Feedback Loop
- [x] Conductor split (2026-10-28): **temporary, fail-closed deviation from gr-conductor condition 2**. Leave the existing intentHash computation unchanged pending an Engram producer change; producer 0.22.0 supplies no intentHash carrier at `transaction.apply`. No claim of condition 2 compliance or E10 qualification; promotion remains blocked until producer-owned intent carriage is verified. [Contract blocker](/home/antoinefa/src/sentropic/.tmp/mem-e10a2-contract-blocker.md); [review gate](/home/antoinefa/src/sentropic/.tmp/packets/mem-E10a2-review-gate.md).
- [x] K7 layout: preserve all snake fields other than `record_digest` in `proof`, including `receipt_digest` and unknown extensions; preserve `record_digest` separately as `recordDigest` so only it can change on completion. Read the entry from that row alone. No new kernel digest or renaming of Engram digest values.
- [x] Initial K7 version rule: Engram 0.22.0 selects `record_digest !== undefined ? '2' : '1'` when no previous row exists; subsequent writes use previous version + 1 (frozen substrate line 5684). The adapter's semantic revision follows presence of `record_digest`; aggregate version remains the producer's supplied value. Kernel transition validation still requires creation before completion.
- Frozen-surface gates from the pack-only tolerance and the Comments gate lines must still pass on this branch; any failure is blocking for this lot.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch** (merge only)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: one bounded correction; the conductor relays review and owns integration. No other sessions contacted.

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
  - [x] `make typecheck-cluster-mesh`, `make lint-cluster-mesh`, `make test-cluster-mesh`: 1401 passed, 268 conditional skips, no type errors; includes frozen-surface, pack-only and Comments gates. Scope checks pass; Docker steps use the shared lock and `make down` cleanup.
  - [x] Guarded pack `0.24.0-dev.5` copied to `/home/antoinefa/src/sentropic/.tmp/engram-e2-host-tuple/e10-artifacts/sentropic-cluster-mesh-0.24.0-dev.5.tgz`; SHA-256 `11a8fe858d1abecde50e003c191a8600db4880f4382c8ce3ffa2bb44c09df8e4`.
  - [ ] Draft PR with this file as body; CI completed/success on exact head; relay handoff via conductor only.
