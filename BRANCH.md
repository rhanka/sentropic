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
  - `packages/llm-mesh/tests/speech-openai-transcription.test.ts`
  - `packages/llm-mesh/tests/decision-public-surface.test.ts`
  - `packages/llm-mesh/tests/fixtures/openai-transcription-frames.ts`
  - `packages/llm-mesh/bench/l9-openai-stt.receipt.json`
  - `packages/llm-mesh/package.json`
  - `packages/llm-gateway/package.json`
  - `packages/cluster-mesh/package.json`
  - `packages/cluster-mesh/src/modules/catalog.ts`
  - `packages/cluster-mesh/tests/fixtures/train.ts`
  - `packages/cluster-mesh/tests/speech-peer.spec.ts`
  - `packages/cluster-mesh/tests/modules/topology-ranges.spec.ts`
  - `packages/cluster-mesh/tests/modules/registry.spec.ts`
  - `packages/cluster-mesh/tests/packaging/optional-install.spec.ts`
  - `packages/cluster-mesh/tests/packaging/skew-invariants.spec.ts`
  - `packages/cluster-mesh/tests/packaging/tuple-skew.spec.ts`
  - `packages/cluster-mesh/tests/packaging/skew-invariants.ts`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
  - `api/tests/unit/gateway-package-version.test.ts`
  - `scripts/ci/publishable-ci-wiring.test.mjs`
  - `package-lock.json`
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
- [x] Integration authorized by the existing Opus r3 APPROVE on bc5c72d18 (`.h2a/reviews/pr804_opus_r3.md`). Preserve the reviewed adapter and main's L8 functionality; use mesh 0.31.0 / gateway 0.22.1 / cluster 0.23.4, preserving the gateway speech floor 0.28 and extending its supported mesh range to 0.31. Regenerate verified archive locks while retaining the unrelated artifacts 0.1.4 baseline.
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
  - [x] Worktree `tmp/worktrees/stt-l9`, branch `feat/live-stt-l9`, base `feat/live-stt-l8` at b4b559c63, merged origin/main (merge 54c7dcbe4) per r1 P1-1.
  - [x] Lanes: `make typecheck-llm-mesh`, `make test-llm-mesh`, `make build-llm-mesh`, CI `validate-llm-mesh`, all under flock, ENV=test-stt-l9 last.
  - [x] Lot gate: base head verified b4b559c63, scope boundaries declared, no exception needed.
- [x] **Lot 1 — Adapter `speech/openai-transcription.ts`**
  - [x] Profile configs `gpt-live-transcribe` / `gpt-realtime-whisper`: model pin, delay, language, format pcm16/24k mono, placement cloud-relay; independent selection, no shared mutable state.
  - [x] `SpeechCapabilities` per profile: streamingStt + partialTranscript + clientVad + manualCommit supported; serverVad + nativeDuplex + tts unsupported; languages/regions selectors; usageUnits session-seconds + audio-seconds.
  - [x] `session.update` builder: `type transcription`, `turn_detection` null refused otherwise, unsupported VAD options rejected at open (fail-closed).
  - [x] Transport port (injectable WS): append base64 pcm16, commit per client-VAD turn, abort closes, no audio persisted, no key in logs/errors.
  - [x] Event mapping (r1 rework): `input.commit` pushes the client turn on a FIFO; provider `input_audio_buffer.committed` binds item_id to `{utteranceId, window}`; transcripts emit the client utteranceId and bound window; unbound completions create the item (revision 1); finalized/cleared tombstones drop late frames (second final errors); invalid frames to `session.error` without payload, stream continues.
  - [x] Metering (r1 rework): admission receipt required at open; injectable expiry timer at min(admission, request maxDurationMs) closes with ceiling-error + cancelled settle; usage records are cumulative under a stable eventId; settle carries no usage without a providerRevision; abort counts as cancelled.
  - [x] TTS exclusion: no synthesis model field, no speech-to-speech path, no implicit OpenAI voice.
  - [x] Lot gate: `make typecheck-llm-mesh` green on the lot head.
- [x] **Lot 2 — Fixtures + gate tests**
  - [x] `tests/fixtures/openai-transcription-frames.ts`: recorded delta/completed/invalid/out-of-order frame scripts per profile, no live call.
  - [x] `tests/speech-openai-transcription.test.ts`: per-model VAD/commit config, partial/final order + revisions, invalid format handling, abort/cancel, usage emission vs ceiling, independent profile config, TTS-absence, no-key-leakage, no-audio-persisted.
  - [x] Lot gate: `make test-llm-mesh` green (SCOPE=file 20/20, then full 77 files / 1401 tests) on the lot head.
- [x] **Lot 3 — Receipt + version**
  - [x] `bench/l9-openai-stt.receipt.json`: status blocked, exact missing G-CLOUD/§10 items, price revision unpinned, no live evidence claimed.
  - [x] Bump `packages/llm-mesh/package.json` to 0.31.0 (minor, strictly above published 0.30.0; 0.30.0 was already taken by main).
  - [x] Lot gate: receipt present and blocked, version bumped, `make build-llm-mesh` + `make pack-llm-mesh` green.
- [x] **Lot R1 — Opus r1 review fixes**
  - [x] P1-1: merged origin/main (54c7dcbe4), mesh 0.30.0 → 0.31.0 (above published), tuple ranges admit 0.31.x, root lockfile refreshed via `make lock-root`.
  - [x] P1-2: duration bound enforced (injectable scheduler + write/commit refusal + ceiling-error settle).
  - [x] P1-3: cumulative usage records under `${operationId}:audio`, monotonic revisions; settle without usage/providerRevision.
  - [x] P1-4: client-utterance binding via committed FIFO; per-turn windows; input.clear sends provider clear + tombstones.
  - [x] P2: settled guards + tombstones; bearer redaction proven; completed-only; Allowed Paths fixed; Lot 1 text updated; commits ≤150 with feat:/test:/docs: subjects (two pre-r1 violations stand, no rewrite).
  - [x] Lot gate: `make test-llm-mesh` green on the R1 head (SCOPE=file 26/26, full 87 files / 1527 tests), build + pack 0.31.0 green.
- [x] **Lot R2 — Opus r2 review fixes (N1/N2/N3 + lock fixture rebind)**
  - [x] N1: `audioInterval` is strictly per-turn (open-turn frame end at commit; no session-wide max in `onCommitted`/`onCompleted`); out-of-order test spaces u_b at 100 and pins per-turn windows ({10,30} / {100,120}).
  - [x] N2: clear after commit keeps a FIFO tombstone; the late provider bind is consumed and dropped instead of stealing the next turn (single final for u3 proven).
  - [x] N3: `PostCloseSocket` releases held frames from inside `close()`; no event surfaces after the settle.
  - [x] Lock fixture: `fixtures/selected/package-lock.json` rebound via `refresh-lazy-package-lock` with same-PR sibling receipts (registry URL + sibling-bytes integrity, no check weakening).
  - [x] Lot gate: `make test-llm-mesh` SCOPE=file green on the R2 head; commits ≤150 lines.
- [ ] **Lot N — Final validation**
  - [ ] `make scope-check` (harness) green.
  - [ ] Push, draft PR against `feat/live-stt-l8`, CI `validate-llm-mesh` + `ci-gate` green on the exact head.
  - [ ] Report PR number, head SHA, CI URL without merging.
  - [ ] `make down ENV=test-stt-l9`.

## Deferred to BR-XX
- None (P2-A/C/D belong to the L6a follow-up, tracked by the conductor).
