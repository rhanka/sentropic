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
- [x] No conditional path touched (no Makefile/CI changes: `test-live-speech` already covers `tests/**`, `validate-live-speech` already gates on `packages/live-speech/**`; verified with host `harness check scope`, PASS C2).
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
  - [x] `src/node/tts-registry.ts`: `TtsEnginePort`, espeak-ng entry (stdin/stdout pipe, digest-verify with empty built-in pins + `ESPEAK_DIGESTS` allowlist, injected runner for tests, abort kills the child), `TtsRegistry` config-only selection, fail-closed unknown engines.
  - [x] `tests/tts-registry.test.ts`: selection/switch, capability differences, unpinned refusal, unknown refusal, pipe argv/stdin, abort propagation, real-child synth abort with reap.
  - [x] Lot gate: lane `validate-live-speech` green on 07330b113 (CI run 40522166118; lane `make` runs post-21:00 UTC).
- [x] **Lot 2 — Playback driver**
  - [x] `src/node/playback.ts` + `tests/fixtures/fake-aplay.mjs` (mode 0755): aplay backend on stdin (digest pin = vetted alsa-utils bytes, no audio files), sticky pre-spawn cancel, SIGTERM then 100 ms SIGKILL + reap.
  - [x] `tests/playback.test.ts`: piped natural end with exact-bytes proof, fence cancel ≤150 ms with pid reaped, SIGKILL escalation path, pre-spawn cancel with positive control, nonzero exit, digest refusal.
  - [x] Lot gate: lane `validate-live-speech` green on 07330b113 (CI run 40522166118; lane `make` runs post-21:00 UTC).
- [x] **Lot 3 — Voice loop**
  - [x] `src/node/voice-loop.ts`: chunked narration (120-char clause flush, truncated flag), VAD/key/stop barge-in with mic-mode gating, epoch floor (L2 fence seam), default sensitive guard, speak/played/cancelled/error outcomes, hygiene (no retained audio, no files).
  - [x] `tests/voice-loop.test.ts`: chunk preview, one submission, immediate clear, sensitive refusal, truncation, epoch fence (late-speak refused, next accepted), key wiring, real synth/playback phases, stop/close mapping, leakage, receipt blocked.
  - [x] Lot gate: lane `validate-live-speech` green on 07330b113 (CI run 40522166118; lane `make` runs post-21:00 UTC).
- [x] **Lot R1 — Opus r1 review fixes (pipe + sticky cancel + chunks)**
  - [x] P1-1: fixture mode 0755, `withMode` awaits, runner seam bypasses verify, refusal paths via fixture binary/missing binary.
  - [x] P1-2: sticky generation counter, barge in every phase (synth/prespawn/playing) with real playback + pid proofs, latency bound, SIGKILL 100 ms, epoch carried.
  - [x] P1-3: `--stdin`/`--stdout` pipe with text on stdin, aplay stdin autodetect (man-page grounded), zero audio files, trust boundary in receipt.
  - [x] P1-4: chunked flush (120 chars), preview events, one submission, immediate clear, sensitive guard, truncated flag and events, explicit stages.
  - [x] P2: close-during-playback maps to cancelled, key-toggle barge wired, engineId `espeak-ng/unpinned`, TOCTOU recorded.
- [x] **Lot R2 — Opus r2 review fixes (epoch fence + gate bounds)**
  - [x] P1-A: duplicate `complete()` removed (TS2393 red), fixture 0755 verified via `git ls-files -s`, pre-spawn positive control.
  - [x] P1-B: cancel latency asserted ≤150 ms (SIGTERM path), SIGKILL escalation path tested on a real ignoring child (bound 500 ms in receipt), real-child synth abort tested with reap.
  - [x] P1-C: epoch floor — `barge(source, {turnEpoch})` raises it, `turnEpoch <= floor` refused, untagged refused once epochs are in use; late-speak(N) refused, speak(N+1) accepted.
  - [x] P2: Lot gates per lot, stale hygiene wording replaced, feedback box ticked, commits split per file, default sensitive set (de-globalled), title reworded, pidfiles cleaned.
- [x] **Lot R3 — Opus r3 review fix (pre-spawn barge fence)**
  - [x] P1-R3: abort checked before spawn in both `synthesize()` (post-verify fence) and `runEspeak()` (pre-spawn, settle without spawning); `isAborted()` call-boundary read (readonly narrowing).
  - [x] P1-R3 test: barge during `verifiedBinary()` asserts reject + no pidfile (ENOENT) with a positive control (same setup spawns, barge reaps, ESRCH). Superseded by Lot R4: the pidfile-only absence proof missed stdin-held orphans; the spawn log now covers it.
  - [x] P2-B: fixture writes the pidfile only after the SIGTERM handler is installed, so a booted pid proves the escalation path is armed.
  - [x] Lot gate: lane `validate-live-speech` green on the R3 head 46f5be6a (CI run 40565062747, lane-only; the run as a whole failed on e2e group-d). Fully green run 40568868245 on 0771178bd (BRANCH-only delta). Host replica: tsc clean + 120/120.
- [x] **Lot R4 — Opus r4 review fix (spawn marker, mutation-sensitive absence)**
  - [x] P1-R4: fixture appends `$FAKE_APLAY_SPAWNLOG` at process start, before any stdin read; the three pre-spawn absence proofs (tts-registry, playback pre-spawn, voice-loop prespawn) assert ENOENT on the log, then a positive control and `readSpawnLog() === [controlPid]` plus ESRCH. Mutation-checked on the exact r3 shape and on spawn-then-check-without-kill: the log shows the orphan line and the test fails.
  - [ ] Lot gate: lane `validate-live-speech` green on the R4 head (lane `make` runs post-21:00 UTC). Host replica: tsc clean + 120/120 (14 files).
- [ ] **Lot 4 — Receipts + wiring**
  - [x] `bench/l6a-g-native.receipt.json` (status blocked, exact missing §8.1 items), README section, `src/node/index.ts` exports.
  - [ ] Retest green, push, draft PR against `feat/live-stt-l4`, CI green, report without merging.
  - [x] Lot gate: lane `validate-live-speech` green on 07330b113 (CI run 40522166118; lane `make` runs post-21:00 UTC). Host replica: tsc clean + 88/88 on the L6a-adjacent files.
- [ ] **Lot N-1 — Docs**
  - [x] README L6a section (registry/playback/loop, refusal semantics).
  - [x] `bench/l6a-g-native.receipt.json` (status blocked, trust boundary recorded, no native claim).
- [ ] **Lot N — Final validation**
  - [ ] Bumped affected `packages/<pkg>/package.json` version (semver) for every package whose `src/**` changed in this branch — enforced by CI `enforce-package-bump`. (New private package: CI skips bump check.)
  - [ ] Final gate step 1: draft PR #799 to `feat/live-stt-l4` using `BRANCH.md` text as PR body (source of truth). Draft PR open, no merge.
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge.
