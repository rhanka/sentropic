# Feature: Live STT L6a shared TTS and voice loop

## Objective
Deliver L6a: `live-speech/src/node/{tts-registry,voice-loop,playback}.ts`, a local eSpeak NG TTS entry (pinned, digest-verified like arecord), configurable stages, bounded narration and barge-in on both mic modes, wired to the L4 capture/control contracts.

## Scope / Guardrails
- Scope limited to L6a voice loop: TTS registry (local espeak-ng entry, config-only selection, no silent fallback), playback driver (aplay backend, cancellable within the fence), voice loop (bounded narration, VAD/key/stop barge-in, both mic modes), §8.1 receipt blocked-never-claimed.
- No L2 core files (`live-speech/src/core/**` belongs to the parallel L2 lane, still unmerged PR #776; the loop consumes only L3/L4 contracts and leaves the journal seam open).
- L3b is PARKED (no usable whisper artifacts under repo constraints): single L3 engine, engine seam kept open (ports injected, never a fixed engine in the loop).
- No llm-mesh/cluster-mesh source edits (L1c `SpeechMicMode` consumed as a type only, like L4).
- No new npm dependencies: pure Node (node:child_process spawn with argv, no shell), no Python, no node-gyp.
- No microphone and no TTS binary in tests (fake ports + node fixtures only); no audio payload in logs (counts/ids/text only).
- Make-only workflow, no direct Docker commands.
- Branch development in isolated worktree `tmp/worktrees/stt-l6a`.
- Automated test campaigns on dedicated env `ENV=test-stt-l6a`, never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off).
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Docker is yielded to radar until 21:00 UTC 2026-10-27: no make target that starts containers before then; author + push, GitHub CI runs. `make scope-check` is replaced meanwhile by host `harness check scope` (container-free); the lane scope-check reruns after 21:00 UTC with `make test-live-speech ENV=test-stt-l6a`.

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
- [ ] No conditional path touched (no Makefile/CI changes: `test-live-speech` already covers `tests/**`, `validate-live-speech` already gates on `packages/live-speech/**`).
- [ ] Docker-yield note: `make scope-check` / `make test-live-speech` start lane containers, so they wait for post-21:00 UTC; meanwhile `harness check scope` runs on the host and GitHub CI is the test gate.

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
- [x] No UI change; no UAT required (no microphone path exercised by a human in this lot; narration proven with fake ports + qualified host aplay binary).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read packet, spec-plan r3 (L6a l.425, voice §l.239-245, retention table l.339, §9 gates l.364), §8.1 receipts, L2 (#776, unmerged — journal seam left open) and L4 contracts.
  - [x] Create worktree `tmp/worktrees/stt-l6a` on `feat/live-stt-l4` as `feat/live-stt-l6a`.
  - [x] Qualify host audio helpers: aplay 1.2.15.2 (byte-identical to vetted arecord, same sha256), espeak-ng BINARY ABSENT (lib 1.1.51 + data 1.52.0 GPL-3 present, no CLI) → entry unwired, receipt blocked.
  - [x] Confirm scope: no Makefile/CI changes, no exceptions; Docker yielded to radar until 21:00 UTC (host `harness check scope` + GitHub CI meanwhile).
  - [x] Lot gate: host `harness check scope` PASS C2; lane `make scope-check` reruns post-21:00 UTC.
- [x] **Lot 1 — TTS registry**
  - [x] `src/node/tts-registry.ts`: `TtsEnginePort`, espeak-ng entry (argv-pinned spawn, digest-verify with empty built-in pins + `ESPEAK_DIGESTS` allowlist, injected runner for tests), `TtsRegistry` config-only selection, fail-closed unknown engines.
  - [x] `tests/tts-registry.test.ts`: selection/switch, capability differences, unpinned refusal, unknown refusal, argv exactness, temp-file hygiene.
- [x] **Lot 2 — Playback driver**
  - [x] `src/node/playback.ts` + `tests/fixtures/fake-aplay.mjs`: aplay backend (digest pin = vetted alsa-utils bytes, cancellable SIGTERM/SIGKILL + reap, temp-file hygiene).
  - [x] `tests/playback.test.ts`: natural end, cancel reap (pid proven dead), nonzero exit, digest refusal.
- [x] **Lot 3 — Voice loop**
  - [x] `src/node/voice-loop.ts`: bounded narration (clause cut), VAD/key/stop barge-in with mic-mode gating, speak/played/cancelled/error outcomes, hygiene (no retained audio).
  - [x] `tests/voice-loop.test.ts`: fence-cancel, both mic modes, muted, stop, busy, leakage, real capture-VAD wiring, receipt blocked.
- [ ] **Lot 4 — Receipts + wiring**
  - [x] `bench/l6a-g-native.receipt.json` (status blocked, exact missing §8.1 items), README section, `src/node/index.ts` exports.
  - [ ] Retest green, push, draft PR against `feat/live-stt-l4`, CI green, report without merging.
  - [ ] Lot gate: `make test-live-speech ENV=test-stt-l6a` green (post-21:00 UTC lane run) + `validate-live-speech` green on the exact head.
- [ ] **Lot N-1 — Docs**
  - [x] README L6a section (registry/playback/loop, refusal semantics).
  - [x] `bench/l6a-g-native.receipt.json` (status blocked, trust boundary recorded, no native claim).
- [ ] **Lot N — Final validation**
  - [ ] Bumped affected `packages/<pkg>/package.json` version (semver) for every package whose `src/**` changed in this branch — enforced by CI `enforce-package-bump`. (New private package: CI skips bump check.)
  - [ ] Final gate step 1: draft PR #799 to `feat/live-stt-l4` using `BRANCH.md` text as PR body (source of truth). Draft PR open, no merge.
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge.
