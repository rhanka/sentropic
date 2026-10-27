# Feature: Live STT L3 local registry adapter

## Objective
Deliver approved r3 L3: `live-speech/src/node/local-stt.ts` plus an isolated worker using the owned TS package, rolling windows/VAD, independently pinned tiny/base profiles with no fixed model in the loop.

## Scope / Guardrails
- Scope limited to L3 local STT: adapter, isolated worker, tiny/base profiles, session/pins/reconciliation/ordering/protocol/backpressure tests, session-level bench + receipts, §8.1 evidence.
- No L2 core files (`live-speech/src/core/**` belongs to the parallel L2 lane).
- No llm-mesh/cluster-mesh source edits; L1 contract types consumed as `import type` only.
- Make-only workflow, no direct Docker commands.
- Branch development in isolated worktree `tmp/worktrees/stt-l3` (even for one active branch).
- Automated test campaigns on dedicated env `ENV=test-stt-l3`, never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off).
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- No paid API call; no microphone in tests; no audio payload in logs; model use only through pinned, hashed artifacts.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/live-speech/**`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile`
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- [x] BR03-EX1: touch conditional `Makefile` (`test-live-speech` target only). Reason: L3 needs a runnable vitest lane mirroring `test-oauth-verify` (SCOPE support, pinned vitest/typescript). Impact: one additive target; no existing target changed. Rollback: delete the target block.
- [x] BR04-EX1: touch conditional `.github/workflows/ci.yml` (live_speech filter + output + `validate-live-speech` job + 2 needs entries), conditional `Makefile` (`bench-live-speech` target), root `package.json` (onnxruntime-node override pin), root `package-lock.json` (workspace refresh via `make lock-root`). Reason: P1-5/P2-1 demand the CI lane, the bench lane, exact onnx pinning and lockfile refresh. Impact: additive CI job gated on live-speech paths; additive bench target; one override line; lock gains only live-speech entries. Rollback: revert the job/filter/target/override lines.
- [x] BR05-EX1: touch conditional `.github/workflows/ci.yml` (one-line `pull_request.branches` exception adding `feat/live-stt-l1c`). Reason: PR #781 targets the unmerged L1c base, so the `main`-only PR filter suppresses every automatic run; the exception restores `pull_request` CI on the exact L3 head without changing any job. Impact: one branch string; no job/filter logic changed. Rollback: remove the branch string.
- [ ] CI run for PR #781: after BR05-EX1, expect an automatic `pull_request` run on the exact head; keep `workflow_dispatch` only as a fallback if the queue stalls.

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
- Rationale: Single-package lot with one test cycle; no UI.

## UAT Management (in orchestration context)
- [x] No UI change; no UAT required (no microphone path in this lot; bench is local-only).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read packet, `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `DOCKER-LOCK.md`, spec-plan r3 (L3 row l.420, §8.1).
  - [x] Create worktree `tmp/worktrees/stt-l3` on `origin/feat/live-stt-l1c` as `feat/live-stt-l3`.
  - [x] Confirm scope and declare `BR03-EX1` before touching `Makefile`.
- [x] **Lot 1 — Local STT adapter**
  - [x] `packages/live-speech/package.json` (private), `tsconfig.json`.
  - [x] `src/node/profiles.ts`: independently pinned tiny/base profiles with origin/revision/license, per-file digests, max-utterance bound.
  - [x] `src/node/engine-port.ts`: engine port interface (no faster-whisper import).
  - [x] `src/node/worker-port.ts`: profile-driven `NodeWorkerClient`, engineId capture, terminate on init failure.
  - [x] `src/node/model-pins.ts`: hash-verified profile-to-artifact binding, fail closed.
  - [x] `src/node/engines/faster-whisper.mjs`: real engine behind the worker (lazy, injectable loader).
  - [x] `src/node/stt-worker.mjs`: isolated worker entry (plain JS), engine path injected, no audio in logs.
  - [x] `src/node/local-stt.ts` + `utterance-buffer.ts` + `reconciler.ts`: anchored windows, one in-flight decode, forced endpoint, one final, teardown.
  - [x] `Makefile`: `test-live-speech` target (BR03-EX1), `bench-live-speech` target (BR04-EX1).
  - [x] Lot gate: `make test-live-speech ENV=test-stt-l3` green (27/27 over 7 files, tsc clean).
- [x] **Lot 2 — Tests + bench receipts**
  - [x] `tests/local-stt.test.ts` + `profiles.test.ts` + `model-pins.test.ts`: model selection, one final, commit offsets, pin verification, teardown.
  - [x] `tests/window-reconciliation.test.ts` + `ordering.test.ts`: anchored stitching over 2x window, endpoint priority, per-utterance finals.
  - [x] `tests/worker-protocol.test.ts` + `backpressure.test.ts`: profile-driven load, init-failure terminate, real-thread backpressure (final < 1500 ms vs ~2000 ms uncoalesced floor).
  - [x] `bench/run-local-bench.mjs` + `bench/profile-run.mjs` + `bench/local-stt-bench.receipt.json`: measured through worker + session on multi-window paced fixtures (tiny 5.6 s/1 partial/1 final/87 chars, base 7.6 s/2 partials/1 final/26 chars, silence 0 finals, 0 errors, 4/4 children exit clean).
  - [x] `bench/l3-g-native.receipt.json` (§8.1 evidence: corrected integrity, pending items explicit).
  - [x] Lot gate: `make test-live-speech ENV=test-stt-l3` green (27/27 over 7 files, tsc clean).
- [x] **Lot N-1 — Docs consolidation**
  - [x] `packages/live-speech/README.md`: layout, profiles/pins, tests and bench lanes.
  - [x] No `spec/BRANCH_SPEC_EVOL.md` in this branch; nothing to integrate or delete.
- [ ] **Lot N — Final validation**
  - [x] Typecheck (via `test-live-speech` tsc --noEmit) & Lint (n/a: no lint lane for this package)
  - [x] Retest package: 30/30 green on head (word-anchored dedupe, maxInflight bound, preload-before-ready)
  - [ ] Bumped affected `packages/<pkg>/package.json` version (semver) for every package whose `src/**` changed in this branch — enforced by CI `enforce-package-bump`. See `rules/workflow.md → Package Publication`. (New private package: CI skips bump check.)
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` text as PR body (source of truth).
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge.
