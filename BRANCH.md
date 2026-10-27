# Feature: STT L9 — OpenAI streaming STT profiles

## Objective
Mesh `speech/openai-transcription.ts` with two independently configured OpenAI streaming-STT profiles (live-transcribe, realtime-whisper) behind the speech contract, admitted and metered by L8 caps; TTS stays separately selected.

## Scope / Guardrails
- Scope limited to `packages/llm-mesh/src/speech/`, `packages/llm-mesh/tests/`, bench receipt, `BRANCH.md`, version bump.
- Make-only workflow, flock-wrapped lanes, no ad-hoc docker.
- Branch development in `tmp/worktrees/stt-l9`, ENV=test-stt-l9 last, never ENV=dev.
- 0 Python. No live provider call in CI (recorded fixtures only). No key leakage, no audio payload persisted.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/llm-mesh/src/speech/openai-transcription.ts`
  - `packages/llm-mesh/src/speech/index.ts`
  - `packages/llm-mesh/src/speech/catalog.ts`
  - `packages/llm-mesh/tests/speech-openai-transcription.test.ts`
  - `packages/llm-mesh/tests/fixtures/openai-transcription-frames.ts`
  - `packages/llm-mesh/bench/l9-openai-stt.receipt.json`
  - `packages/llm-mesh/package.json`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `packages/llm-gateway/**`
  - `packages/live-speech/**`
  - `packages/llm-mesh/src/**` (except `src/speech/openai-transcription.ts`, `src/speech/index.ts`, `src/speech/catalog.ts`)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- `acknowledge`: P2-A/C/D from L6a r5 go to a follow-up before Lp1/L6b, not this lot (conductor 2026-10-27).

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
- Rationale: single mesh adapter, one test file, one lane.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- No UI change in this lot: no UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read spec-plan L9 row, §2.1-2.2 OpenAI wire, §7-8.1, §9-10, L8 gateway caps.
  - [x] Fetch live wire [O7]: `wss://api.openai.com/v1/realtime?intent=transcription`, session.update transcription, append/commit, delta/completed by item_id, no server VAD, delay levels, no timestamps/confidence for live-transcribe.
  - [x] Seam: mesh stays dependency-free; admission as data + injected usage sink; real gateway wiring at composition (L16/API).
  - [x] Worktree `tmp/worktrees/stt-l9`, branch `feat/live-stt-l9`, base `feat/live-stt-l8` at b4b559c63.
  - [x] Lanes: `make typecheck-llm-mesh`, `make test-llm-mesh`, `make build-llm-mesh`, CI `validate-llm-mesh`, all under flock, ENV=test-stt-l9 last.
  - [x] Lot gate: base head verified b4b559c63, scope boundaries declared, no exception needed.
- [ ] **Lot 1 — Adapter `speech/openai-transcription.ts`**
  - [ ] Profile configs `gpt-live-transcribe` / `gpt-realtime-whisper`: model pin, delay, language, format pcm16/24k mono, placement cloud-relay; independent selection, no shared mutable state.
  - [ ] `SpeechCapabilities` per profile: streamingStt + partialTranscript + clientVad + manualCommit supported; serverVad + nativeDuplex + tts unsupported; languages/regions selectors; usageUnits session-seconds + audio-seconds.
  - [ ] `session.update` builder: `type transcription`, `turn_detection null` refused otherwise, unsupported VAD options rejected at open (fail-closed).
  - [ ] Transport port (injectable WS): append base64 pcm16, commit per client-VAD turn, abort closes, no audio persisted, no key in logs/errors.
  - [ ] Event mapping: delta keyed by item_id to `transcript.partial` (monotonic revision, replaces-append), completed to `transcript.final` (full text, audioInterval, language); out-of-order finals kept per utterance; invalid frames to `session.error` without payload, stream continues.
  - [ ] Metering: admission receipt required at open (operationId, ceiling, hold ref; refuse without); usage sink gets estimate/final `SpeechUsageUpdate` (connectedSeconds, admittedAudioSeconds) + settlement outcome completed/cancelled/failed; abort counts as cancelled.
  - [ ] TTS exclusion: no synthesis model field, no speech-to-speech path, no implicit OpenAI voice.
  - [ ] Lot gate: `make typecheck-llm-mesh` green on the lot head.
- [x] **Lot 1 — Adapter `speech/openai-transcription.ts`**
  - [x] Profile configs `gpt-live-transcribe` / `gpt-realtime-whisper`: model pin, delay, language, format pcm16/24k mono, placement cloud-relay; independent selection, no shared mutable state.
  - [x] `SpeechCapabilities` per profile: streamingStt + partialTranscript + clientVad + manualCommit supported; serverVad + nativeDuplex + tts unsupported; languages/regions selectors; usageUnits session-seconds + audio-seconds.
  - [x] `session.update` builder: `type transcription`, `turn_detection` null refused otherwise, unsupported VAD options rejected at open (fail-closed).
  - [x] Transport port (injectable WS): append base64 pcm16, commit per client-VAD turn, abort closes, no audio persisted, no key in logs/errors.
  - [x] Event mapping: delta keyed by item_id to `transcript.partial` (monotonic revision, replaces-append), completed to `transcript.final` (full text, audioInterval, language); out-of-order finals kept per utterance; invalid frames to `session.error` without payload, stream continues.
  - [x] Metering: admission receipt required at open (operationId, ceiling, hold ref; refuse without), usage sink gets estimate/final `SpeechUsageUpdate` (connectedSeconds, admittedAudioSeconds) + settlement outcome completed/cancelled/failed; abort counts as cancelled.
  - [x] TTS exclusion: no synthesis model field, no speech-to-speech path, no implicit OpenAI voice.
  - [x] Lot gate: `make typecheck-llm-mesh` green on the lot head.
- [x] **Lot 2 — Fixtures + gate tests**
  - [x] `tests/fixtures/openai-transcription-frames.ts`: recorded delta/completed/invalid/out-of-order frame scripts per profile, no live call.
  - [x] `tests/speech-openai-transcription.test.ts`: per-model VAD/commit config, partial/final order + revisions, invalid format handling, abort/cancel, usage emission vs ceiling, independent profile config, TTS-absence, no-key-leakage, no-audio-persisted.
  - [x] Lot gate: `make test-llm-mesh` green (SCOPE=file 20/20, then full 77 files / 1401 tests) on the lot head.
- [x] **Lot 3 — Receipt + version**
  - [x] `bench/l9-openai-stt.receipt.json`: status blocked, exact missing G-CLOUD/§10 items, price revision unpinned, no live evidence claimed.
  - [x] Bump `packages/llm-mesh/package.json` to 0.30.0 (minor, strictly above published 0.29.0).
  - [x] Lot gate: receipt present and blocked, version bumped, `make build-llm-mesh` + `make pack-llm-mesh` green.
- [ ] **Lot N — Final validation**
  - [ ] `make scope-check` (harness) green.
  - [ ] Push, draft PR against `feat/live-stt-l8`, CI `validate-llm-mesh` + `ci-gate` green on the exact head.
  - [ ] Report PR number, head SHA, CI URL without merging.
  - [ ] `make down ENV=test-stt-l9`.

## Deferred to BR-XX
- None (P2-A/C/D belong to the L6a follow-up, tracked by the conductor).
