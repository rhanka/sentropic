# Feature: Cluster-mesh storage-port lot K3 (L3a v4.1 frozen)

## Objective
- [ ] Deliver the K3 neutral runtime (validation, tokens, binding, ordinary transactions, exact-head immutable chain boundaries) on the K1/K2 corpora.
- [ ] Designate the chain-boundary provider used by readChainPage (G3) for the engram adapter.

## Scope / Guardrails
- [ ] Scope limited to K3 runtime files and K3 specs plus the K3 report.
- [ ] Make-only workflow, no direct Docker commands.
- [ ] Root workspace ~/src/sentropic is reserved for user dev/UAT (ENV=dev) and must remain stable.
- [ ] Branch development happens in worktree tmp/worktrees/cluster-mesh-storage-k3.
- [ ] Automated test campaigns run on ENV=test-cm-k3, never on dev.
- [ ] In every make command, ENV=test-cm-k3 passed as last argument with API_PORT=9515 UI_PORT=5715 MAILDEV_UI_PORT=1615.
- [ ] One Docker build at a time.
- [ ] All new text in English.
- [ ] Zero Python.
- [ ] Kernel stays neutral: no pg, no drizzle, no engram imports; public types documented.
- [ ] Frozen M1 and merged engram L6a 70ebdfee untouched.
- [ ] No version bump.
- [ ] K2a/K2b corpora run against the K3 runtime where applicable (ordinary only; staged/journal/barrier/lifecycle stay K4/S/P).

## Branch Scope Boundaries (MANDATORY)
- [ ] **Allowed Paths (implementation scope)**:
  - [ ] `BRANCH.md`
  - [ ] `packages/cluster-mesh/src/storage/tokens.ts`
  - [ ] `packages/cluster-mesh/src/storage/backend.ts`
  - [ ] `packages/cluster-mesh/src/storage/record-runtime.ts`
  - [ ] `packages/cluster-mesh/src/storage/scope-runtime.ts`
  - [ ] `packages/cluster-mesh/src/storage/kernel.ts`
  - [ ] `packages/cluster-mesh/src/storage/index.ts`
  - [ ] `packages/cluster-mesh/tests/storage/kernel.spec.ts`
  - [ ] `packages/cluster-mesh/tests/storage/scope-runtime.spec.ts`
  - [ ] `.h2a/build/k3_report.md`
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
  - [ ] `packages/cluster-mesh/src/storage/contracts.ts`
  - [ ] `packages/cluster-mesh/src/storage/authority.ts`
  - [ ] `packages/cluster-mesh/src/storage/atomic.ts`
  - [ ] `packages/cluster-mesh/src/storage/profiles.ts`
  - [ ] `packages/cluster-mesh/src/storage/descriptor.ts`
  - [ ] `packages/cluster-mesh/src/storage/staged-units.ts`
  - [ ] `packages/cluster-mesh/src/storage/readers.ts`
  - [ ] `packages/cluster-mesh/src/storage/errors.ts`
  - [ ] `packages/cluster-mesh/tests/storage/atomic-corpus.ts`
  - [ ] `packages/cluster-mesh/tests/storage/authority-corpus.ts`
  - [ ] `packages/cluster-mesh/tests/storage/chain-corpus.ts`
  - [ ] `packages/cluster-mesh/tests/storage/read-corpus.ts`
  - [ ] `packages/cluster-mesh/tests/storage/staged-corpus.ts`
  - [ ] `packages/cluster-mesh/tests/storage/replay-corpus.ts`
  - [ ] `packages/cluster-mesh/tests/storage/barrier-corpus.ts`
  - [ ] `packages/cluster-mesh/tests/storage/lifecycle-corpus.ts`
  - [ ] `packages/cluster-mesh/tests/storage/reference-store.ts`
  - [ ] `packages/cluster-mesh/tests/storage/reference-state.ts`
  - [ ] `packages/cluster-mesh/tests/storage/reference-staged.ts`
  - [ ] `packages/cluster-mesh/tests/storage/reference.spec.ts`
  - [ ] `packages/cluster-mesh/tests/storage/mutations.spec.ts`
  - [ ] `packages/cluster-mesh/tests/storage/profile-mutations.spec.ts`
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
- [ ] `BR-K3-DISC1` — One-time BRANCH.md rewrite (K2b content to K3 content) exceeds 150 changed lines through deletions alone; single logical change, all following commits stay under 150 lines with BRANCH.md in-commit.
- [ ] `BR-K3-G3` — G3 designation: readChainPage uses the retained exact-head boundary provider (server-side registry, byte-identical cursors); decision recorded in kernel.ts plus the K3 report.
- [ ] `BR-K3-DISC2` — K3 runtime files land as one coherent file per commit when they exceed 150 lines (single review unit per §17.4 file; K1 `BR-K1R3-EX1` and K2b `BR-K2B-DISC2` precedent for reference-scale files); all other commits stay under 150 lines.

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
- [ ] Rationale: single stacked branch on feat/cluster-mesh-storage-k2b; one final test cycle.

## UAT Management (in orchestration context)
- [ ] **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- [ ] Multi-branch: no UAT on sub-branches; UAT happens only after integration on the main branch.
- [ ] UAT checkpoints must be listed as checkboxes inside each relevant lot (no separate UAT section).
- [ ] Execution flow (mandatory):
  - [ ] Develop and run tests in `tmp/worktrees/cluster-mesh-storage-k3`.
  - [ ] Push branch before UAT.
  - [ ] Run user UAT from root workspace (`~/src/sentropic`, `ENV=dev`).
  - [ ] Switch back to `tmp/worktrees/cluster-mesh-storage-k3` after UAT.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [ ] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `README.md`.
  - [ ] Confirm worktree `tmp/worktrees/cluster-mesh-storage-k3` on branch `feat/cluster-mesh-storage-k3` stacked at `4da5b52ca`.
  - [ ] Read frozen spec `L3a-spec-v4.1-frozen.md` §17 row K3 plus file table (K/T).
  - [ ] Rewrite `BRANCH.md` from `plan/BRANCH_TEMPLATE.md` (this file).
  - [ ] Confirm command style: `make ... API_PORT=9515 UI_PORT=5715 MAILDEV_UI_PORT=1615 ENV=test-cm-k3` with `ENV` last.
  - [ ] Confirm scope boundaries and `BR-K3-DISC1`.
  - [ ] Baseline: `make test-cluster-mesh SCOPE=tests/storage/reference.spec.ts API_PORT=9515 UI_PORT=5715 MAILDEV_UI_PORT=1615 ENV=test-cm-k3` green.
  - [ ] Lot gate:
    - [ ] `make typecheck-cluster-mesh API_PORT=9515 UI_PORT=5715 MAILDEV_UI_PORT=1615 ENV=test-cm-k3`
    - [ ] `make lint-cluster-mesh API_PORT=9515 UI_PORT=5715 MAILDEV_UI_PORT=1615 ENV=test-cm-k3`
- [ ] **Lot 1 — Test-first K3 specs (failing)**
  - [x] Write `packages/cluster-mesh/tests/storage/kernel.spec.ts`: atomic + chain + read + cursor-budget corpora against the K3 runtime; predicate-positive acceptance; transact overlay/rollback/isolation/closed-context/nested-join; token tamper and cross-chain refusal; forged cursor refusal.
  - [x] Write `packages/cluster-mesh/tests/storage/scope-runtime.spec.ts`: authority corpus against the K3 runtime; frozen-grant mutation check; revalidation on expiry and revocation; capability advertisement.
  - [ ] Scoped runs while evolving tests: `make test-cluster-mesh SCOPE=tests/storage/kernel.spec.ts API_PORT=9515 UI_PORT=5715 MAILDEV_UI_PORT=1615 ENV=test-cm-k3`
  - [ ] Scoped runs while evolving tests: `make test-cluster-mesh SCOPE=tests/storage/scope-runtime.spec.ts API_PORT=9515 UI_PORT=5715 MAILDEV_UI_PORT=1615 ENV=test-cm-k3`
  - [ ] Lot gate: specs fail on missing runtime (RED), no other files touched.
- [ ] **Lot 2 — Tokens, backend, record runtime**
  - [x] Write `packages/cluster-mesh/src/storage/tokens.ts`: retained exact-head boundary registry (G3 provider), opaque id minting, documented public types.
  - [x] Write `packages/cluster-mesh/src/storage/backend.ts`: neutral in-memory backend state per scope (chains, genesis, index, records, aggregates, commits, cursors).
  - [x] Write `packages/cluster-mesh/src/storage/record-runtime.ts`: ordinary commit staging with CAS-first appends, allocation, disposal guards, idempotent genesis/index, aggregate versions, predicate-positive acceptance, barrier/purge/relationship refusal, full rollback, R3 effective-cursor paging.
  - [ ] Write `packages/cluster-mesh/src/storage/record-runtime.ts`: ordinary commit staging with CAS-first appends, allocation, disposal guards, idempotent genesis/index, aggregate versions, predicate-positive acceptance, barrier/purge/relationship refusal, full rollback, R3 effective-cursor paging.
  - [ ] Lot gate:
    - [ ] `make typecheck-cluster-mesh API_PORT=9515 UI_PORT=5715 MAILDEV_UI_PORT=1615 ENV=test-cm-k3`
    - [ ] `make lint-cluster-mesh API_PORT=9515 UI_PORT=5715 MAILDEV_UI_PORT=1615 ENV=test-cm-k3`
- [ ] **Lot 3 — Scope binding, kernel, index**
  - [x] Write `packages/cluster-mesh/src/storage/scope-runtime.ts`: grant bind with frozen copy, issued-token registry, revocation, per-operation revalidation, scope isolation, profiles advertisement.
  - [x] Write `packages/cluster-mesh/src/storage/kernel.ts`: kernel factory with incarnation and clock, ordinary transact machinery (overlay, immediate plus commit-time CAS, rollback-only nesting, closed-context refusal), G3 provider wiring, documented public types.
  - [ ] Write `packages/cluster-mesh/src/storage/kernel.ts`: kernel factory with incarnation and clock, ordinary transact machinery (overlay, immediate plus commit-time CAS, rollback-only nesting, closed-context refusal), G3 provider wiring, documented public types.
  - [ ] Write `packages/cluster-mesh/src/storage/index.ts`: public re-exports for the engram adapter.
  - [ ] Lot gate:
    - [ ] `make typecheck-cluster-mesh API_PORT=9515 UI_PORT=5715 MAILDEV_UI_PORT=1615 ENV=test-cm-k3`
    - [ ] `make lint-cluster-mesh API_PORT=9515 UI_PORT=5715 MAILDEV_UI_PORT=1615 ENV=test-cm-k3`
    - [ ] **API tests**
      - [ ] Evolve `packages/cluster-mesh/tests/storage/kernel.spec.ts` (new K3 ordinary runtime proof)
      - [ ] Evolve `packages/cluster-mesh/tests/storage/scope-runtime.spec.ts` (new K3 binding proof)
      - [ ] Scoped runs while evolving tests: `make test-cluster-mesh SCOPE=tests/storage/kernel.spec.ts API_PORT=9515 UI_PORT=5715 MAILDEV_UI_PORT=1615 ENV=test-cm-k3`
      - [ ] Scoped runs while evolving tests: `make test-cluster-mesh SCOPE=tests/storage/scope-runtime.spec.ts API_PORT=9515 UI_PORT=5715 MAILDEV_UI_PORT=1615 ENV=test-cm-k3`
      - [ ] Sub-lot gate: `make test-cluster-mesh SCOPE=tests/storage/ API_PORT=9515 UI_PORT=5715 MAILDEV_UI_PORT=1615 ENV=test-cm-k3`
- [ ] **Lot 4 — Final validation, report, draft PR**
  - [ ] Typecheck and lint full package.
  - [ ] Retest storage: `make test-cluster-mesh SCOPE=tests/storage/ API_PORT=9515 UI_PORT=5715 MAILDEV_UI_PORT=1615 ENV=test-cm-k3`.
  - [ ] Retest package: `make test-cluster-mesh API_PORT=9515 UI_PORT=5715 MAILDEV_UI_PORT=1615 ENV=test-cm-k3`.
  - [ ] Verify neutrality: no pg, no drizzle, no engram imports in `packages/cluster-mesh/src/storage/`.
  - [ ] Verify frozen M1 and engram L6a untouched.
  - [ ] Write `.h2a/build/k3_report.md` with exit SHA, corpus evidence, G3 designation, neutrality proof.
  - [ ] Push only this branch, open a DRAFT PR noting "stacked on #669", never merge.
