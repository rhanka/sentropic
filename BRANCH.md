# Feature: Cluster-mesh storage-port lot K4 (L3a v4.1 frozen)

## Objective
- [ ] Deliver the K4 shared visibility-root and staged-unit machinery (neutral, on the K3 backend) against the K2b staged/barrier/lifecycle corpora.
- [ ] Cover G5 where it touches staged units: a historical tombstone import writes its barrier in the same published unit.

## Scope / Guardrails
- [ ] Scope limited to K4 runtime files and K4 specs plus the K4 report.
- [ ] Make-only workflow, no direct Docker commands.
- [ ] Root workspace ~/src/sentropic is reserved for user dev/UAT (ENV=dev) and must remain stable.
- [ ] Branch development happens in worktree tmp/worktrees/cluster-mesh-storage-k4.
- [ ] Automated test campaigns run on ENV=test-cm-k4, never on dev.
- [ ] In every make command, ENV=test-cm-k4 passed as last argument with API_PORT=9520 UI_PORT=5720 MAILDEV_UI_PORT=1620.
- [ ] One Docker build at a time.
- [ ] All new text in English.
- [ ] Zero Python.
- [ ] Kernel stays neutral: no pg, no drizzle, no engram imports; public types documented.
- [ ] Frozen M1 and merged engram L6a 70ebdfee untouched.
- [ ] No version bump.
- [ ] K2b staged/barrier/lifecycle corpora run against the K4 runtime; K3 ordinary corpora stay green.

## Branch Scope Boundaries (MANDATORY)
- [ ] **Allowed Paths (implementation scope)**:
  - [ ] `BRANCH.md`
  - [ ] `packages/cluster-mesh/src/storage/visibility-root.ts`
  - [ ] `packages/cluster-mesh/src/storage/staged-runtime.ts`
  - [ ] `packages/cluster-mesh/src/storage/stage-validation.ts`
  - [ ] `packages/cluster-mesh/src/storage/projection-runtime.ts`
  - [ ] `packages/cluster-mesh/src/storage/manifest.ts`
  - [ ] `packages/cluster-mesh/tests/storage/staged-units.spec.ts`
  - [ ] `packages/cluster-mesh/tests/storage/visibility.spec.ts`
  - [ ] `packages/cluster-mesh/tests/storage/manifest.spec.ts`
  - [ ] `packages/cluster-mesh/package.json`
  - [ ] `package-lock.json`
  - [ ] `.h2a/build/k4_report.md`
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
  - [ ] `packages/cluster-mesh/src/storage/tokens.ts`
  - [ ] `packages/cluster-mesh/src/storage/backend.ts`
  - [ ] `packages/cluster-mesh/src/storage/record-runtime.ts`
  - [ ] `packages/cluster-mesh/src/storage/scope-runtime.ts`
  - [ ] `packages/cluster-mesh/src/storage/kernel.ts`
  - [ ] `packages/cluster-mesh/src/storage/index.ts`
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
  - [ ] `packages/cluster-mesh/tests/storage/kernel.spec.ts`
  - [ ] `packages/cluster-mesh/tests/storage/scope-runtime.spec.ts`
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
- [ ] `BR-K4-DISC1` — One-time BRANCH.md rewrite (K3 content to K4 content) exceeds 150 changed lines through deletions alone; single logical change, all following commits stay under 150 lines with BRANCH.md in-commit.
- [ ] `BR-K4-G5` — G5 where it touches staged units: a staged unit carrying a tombstoned record plus its barrier publishes both in one commit; the payload is never ordinarily readable between publication and barrier application; proof in staged-units.spec.ts plus the K4 report.
- [ ] `BR-K4-DISC2` — K4 K/T files land as one coherent file per commit when they exceed 150 lines (single review unit per §17.4 file; K3 `BR-K3-DISC2` and K2b `BR-K2B-DISC2/DISC3` precedent); all other commits stay under 150 lines with BRANCH.md in-commit.

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
- [ ] Rationale: single stacked branch on feat/cluster-mesh-storage-k3; one final test cycle.

## UAT Management (in orchestration context)
- [ ] **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- [ ] Multi-branch: no UAT on sub-branches; UAT happens only after integration on the main branch.
- [ ] UAT checkpoints must be listed as checkboxes inside each relevant lot (no separate UAT section).
- [ ] Execution flow (mandatory):
  - [ ] Develop and run tests in `tmp/worktrees/cluster-mesh-storage-k4`.
  - [ ] Push branch before UAT.
  - [ ] Run user UAT from root workspace (`~/src/sentropic`, `ENV=dev`).
  - [ ] Switch back to `tmp/worktrees/cluster-mesh-storage-k4` after UAT.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [ ] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `README.md`.
  - [ ] Confirm worktree `tmp/worktrees/cluster-mesh-storage-k4` on branch `feat/cluster-mesh-storage-k4` stacked at `e6b64efc7`.
  - [ ] Merge `origin/feat/cluster-mesh-storage-k2b` (K2b fixes `09b008890`) and `origin/feat/cluster-mesh-storage-k3` latest.
  - [ ] Read frozen spec `L3a-spec-v4.1-frozen.md` §17 row K4 plus file table (K/T) and G5 (same-unit tombstone/barrier).
  - [ ] Rewrite `BRANCH.md` from `plan/BRANCH_TEMPLATE.md` (this file).
  - [ ] Confirm command style: `make ... API_PORT=9520 UI_PORT=5720 MAILDEV_UI_PORT=1620 ENV=test-cm-k4` with `ENV` last.
  - [ ] Confirm scope boundaries and `BR-K4-DISC1`.
  - [ ] Baseline: `make test-cluster-mesh SCOPE=tests/storage/reference.spec.ts API_PORT=9520 UI_PORT=5720 MAILDEV_UI_PORT=1620 ENV=test-cm-k4` green.
  - [ ] Lot gate:
    - [ ] `make typecheck-cluster-mesh API_PORT=9520 UI_PORT=5720 MAILDEV_UI_PORT=1620 ENV=test-cm-k4`
    - [ ] `make lint-cluster-mesh API_PORT=9520 UI_PORT=5720 MAILDEV_UI_PORT=1620 ENV=test-cm-k4`
- [ ] **Lot 1 — Test-first K4 specs (failing)**
  - [x] Write `packages/cluster-mesh/tests/storage/staged-units.spec.ts`: staged/replay/barrier/lifecycle corpora against the K4 runtime plus G5 same-unit tombstone/barrier proof.
  - [x] Write `packages/cluster-mesh/tests/storage/visibility.spec.ts`: root versions, base conflicts, rebase, denial without cursor leaks.
  - [x] Write `packages/cluster-mesh/tests/storage/manifest.spec.ts`: canonical manifest round-trip, unknown/tampered digest refusal, terminal completeness.
  - [ ] Scoped runs while evolving tests: `make test-cluster-mesh SCOPE=tests/storage/staged-units.spec.ts API_PORT=9520 UI_PORT=5720 MAILDEV_UI_PORT=1620 ENV=test-cm-k4`
  - [ ] Scoped runs while evolving tests: `make test-cluster-mesh SCOPE=tests/storage/visibility.spec.ts API_PORT=9520 UI_PORT=5720 MAILDEV_UI_PORT=1620 ENV=test-cm-k4`
  - [ ] Scoped runs while evolving tests: `make test-cluster-mesh SCOPE=tests/storage/manifest.spec.ts API_PORT=9520 UI_PORT=5720 MAILDEV_UI_PORT=1620 ENV=test-cm-k4`
  - [ ] Lot gate: specs fail on missing runtime (RED), no other files touched.
- [ ] **Lot 2 — Visibility root and stage validation**
  - [x] Write `packages/cluster-mesh/src/storage/visibility-root.ts`: scope visibility root/version, base capture and comparison, single publication point.
  - [x] Write `packages/cluster-mesh/src/storage/stage-validation.ts`: bounded seal validation steps with validating/sealed states and resume.
  - [ ] Lot gate:
    - [ ] `make typecheck-cluster-mesh API_PORT=9520 UI_PORT=5720 MAILDEV_UI_PORT=1620 ENV=test-cm-k4`
    - [ ] `make lint-cluster-mesh API_PORT=9520 UI_PORT=5720 MAILDEV_UI_PORT=1620 ENV=test-cm-k4`
- [ ] **Lot 3 — Staged runtime with journal, barriers and lifecycle**
  - [x] Write `packages/cluster-mesh/src/storage/staged-runtime.ts`: staged units over the K3 backend, journal segments, coverage/barrier denial, purge jobs, G5 same-unit publication.
  - [ ] Lot gate:
    - [ ] `make typecheck-cluster-mesh API_PORT=9520 UI_PORT=5720 MAILDEV_UI_PORT=1620 ENV=test-cm-k4`
    - [ ] `make lint-cluster-mesh API_PORT=9520 UI_PORT=5720 MAILDEV_UI_PORT=1620 ENV=test-cm-k4`
    - [ ] **API tests**
      - [ ] Evolve `packages/cluster-mesh/tests/storage/staged-units.spec.ts` (new K4 staged-unit proof)
      - [ ] Evolve `packages/cluster-mesh/tests/storage/visibility.spec.ts` (new K4 visibility proof)
      - [ ] Scoped runs while evolving tests: `make test-cluster-mesh SCOPE=tests/storage/staged-units.spec.ts API_PORT=9520 UI_PORT=5720 MAILDEV_UI_PORT=1620 ENV=test-cm-k4`
      - [ ] Scoped runs while evolving tests: `make test-cluster-mesh SCOPE=tests/storage/visibility.spec.ts API_PORT=9520 UI_PORT=5720 MAILDEV_UI_PORT=1620 ENV=test-cm-k4`
      - [ ] Sub-lot gate: `make test-cluster-mesh SCOPE=tests/storage/ API_PORT=9520 UI_PORT=5720 MAILDEV_UI_PORT=1620 ENV=test-cm-k4`
- [ ] **Lot 4 — Projection runtime and manifest**
  - [x] Write `packages/cluster-mesh/src/storage/projection-runtime.ts`: relationship index, registered queries with page limits, cause-tagged projection deltas.
  - [x] Write `packages/cluster-mesh/src/storage/manifest.ts`: canonical export manifest, retained registry, digest verification, terminal completeness.
  - [x] Evolve `packages/cluster-mesh/tests/storage/manifest.spec.ts` (new K4 manifest proof)
  - [ ] Lot gate:
    - [ ] `make typecheck-cluster-mesh API_PORT=9520 UI_PORT=5720 MAILDEV_UI_PORT=1620 ENV=test-cm-k4`
    - [ ] `make lint-cluster-mesh API_PORT=9520 UI_PORT=5720 MAILDEV_UI_PORT=1620 ENV=test-cm-k4`
- [ ] **Lot 5 — Final validation, report, draft PR**
  - [x] Typecheck and lint full package.
  - [x] Retest storage: `make test-cluster-mesh SCOPE=tests/storage/ API_PORT=9520 UI_PORT=5720 MAILDEV_UI_PORT=1620 ENV=test-cm-k4`.
  - [x] Retest package: `make test-cluster-mesh API_PORT=9520 UI_PORT=5720 MAILDEV_UI_PORT=1620 ENV=test-cm-k4`.
  - [x] Verify neutrality: no pg, no drizzle, no engram imports in `packages/cluster-mesh/src/storage/`.
  - [x] Verify frozen M1 and engram L6a untouched.
  - [x] Write `.h2a/build/k4_report.md` with exit SHA, corpus evidence, G5 proof, neutrality proof.
  - [x] Push only this branch, open a DRAFT PR noting "stacked on #670", never merge.
