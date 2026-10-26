# Feature: Live STT L3 local registry adapter

## Objective
Deliver approved r3 L3: `live-speech/src/node/local-stt.ts` plus an isolated worker using the owned TS package, rolling windows/VAD, independently pinned tiny/base profiles with no fixed model in the loop.

## Scope / Guardrails
- Scope limited to L3 local STT: adapter, isolated worker, tiny/base profiles, `local-stt` + `window-reconciliation` tests, local bench receipt, §8.1 evidence.
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
- [ ] CI run for PR: pending.

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
  - [x] `src/node/profiles.ts`: independently pinned tiny/base profiles, runtime selection, no fixed model.
  - [x] `src/node/engine-port.ts`: engine port interface (no faster-whisper import).
  - [x] `src/node/worker-port.ts`: `NodeWorkerClient` transport + `SessionClosedError`.
  - [x] `src/node/stt-worker.mjs`: isolated worker entry (plain JS), engine path injected, no audio in logs.
  - [x] `src/node/local-stt.ts` + `utterance-buffer.ts` + `reconciler.ts`: rolling windows, VAD-gated endpointing, overlap dedupe, one final, teardown.
  - [x] `Makefile`: `test-live-speech` target (BR03-EX1).
  - [x] Lot gate: `make test-live-speech ENV=test-stt-l3` green (17/17, tsc clean).
- [x] **Lot 2 — Tests + bench receipts**
  - [x] `tests/local-stt.test.ts` + `profiles.test.ts`: model selection, one final, teardown/no starvation.
  - [x] `tests/window-reconciliation.test.ts` + `ordering.test.ts` + `worker-protocol.test.ts`: overlap dedupe, stable prefix, out-of-order finals, real-thread round-trip.
  - [x] `bench/run-local-bench.mjs` + `bench/local-stt-bench.receipt.json` (pending with recorded blocker: no native bridge/onnx GPU wheel).
  - [x] `bench/l3-g-native.receipt.json` (§8.1 evidence).
  - [x] Lot gate: `make test-live-speech ENV=test-stt-l3` green (17/17, tsc clean).
- [ ] **Lot N — Final validation**
  - [x] Typecheck (via `test-live-speech` tsc --noEmit) & Lint (n/a: no lint lane for this package)
  - [x] Retest package: 17/17 green on head
  - [ ] Bumped affected `packages/<pkg>/package.json` version (semver) for every package whose `src/**` changed in this branch — enforced by CI `enforce-package-bump`. See `rules/workflow.md → Package Publication`. (New private package: CI skips bump check.)
  - [ ] Bumped affected `packages/<pkg>/package.json` version (semver) for every package whose `src/**` changed in this branch — enforced by CI `enforce-package-bump`. See `rules/workflow.md → Package Publication`. (New private package: CI skips bump check.)
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` text as PR body (source of truth).
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge.
