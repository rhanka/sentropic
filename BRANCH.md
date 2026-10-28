# Feature: STT L13 — Mistral streaming STT + TTS binding

## Objective
Mesh `speech/mistral-transcription.ts` with the Voxtral realtime STT adapter (3.0 preview model, recorded fixtures only) plus the Mistral TTS binding/registry entry, admitted and metered by the L8 caps with the L9 guarantees (duration bound, no double count, client utterance ids, late frames suppressed, no Bearer leak).

## Scope / Guardrails
- Scope limited to `packages/llm-mesh/src/speech/`, `packages/llm-mesh/tests/`, bench receipt, `BRANCH.md`, tuple version cascade from the mesh bump.
- Make-only workflow, flock-wrapped lanes, no ad-hoc docker, no raw `docker run`.
- Branch development in `tmp/worktrees/stt-l13`, ENV=test-stt-l13 last, never ENV=dev.
- 0 Python. No live provider call (recorded fixtures only, receipt blocked). No key leakage, no audio payload persisted.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/llm-mesh/src/speech/mistral-transcription.ts`
  - `packages/llm-mesh/src/speech/index.ts`
  - `packages/llm-mesh/tests/speech-mistral.test.ts`
  - `packages/llm-mesh/tests/speech-contract.test.ts`
  - `packages/llm-mesh/tests/decision-public-surface.test.ts`
  - `packages/llm-mesh/tests/fixtures/mistral-frames.ts`
  - `packages/llm-mesh/bench/l13-mistral.receipt.json`
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
  - `packages/cluster-mesh/tests/packaging/skew-invariants.ts`
  - `packages/cluster-mesh/tests/packaging/tuple-skew.spec.ts`
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
  - `packages/llm-mesh/src/**` (except `src/speech/mistral-transcription.ts`, `src/speech/index.ts`, `src/speech/catalog.ts`)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- `acknowledge`: mesh 0.30.0 → 0.31.0 collides numerically with L9's 0.31.0 (different content, unmerged draft #804). Train rhythm kept; conductor sequences the merges (merge-time bump resolves).
- `acknowledge`: Mistral wire grounded in docs 2026-10-28: realtime `wss://api.mistral.ai/v1/audio/transcriptions/realtime?model=voxtral-mini-transcribe-realtime-3`, TTS `POST /v1/audio/speech` model `voxtral-mini-tts-3-0`. 2602 models deprecated, kept separate. No live call made; receipt stays blocked.

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
- Rationale: single mesh adapter + TTS binding, one test file, one lane.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- No UI change in this lot: no UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read spec-plan L13 row, §7-8.1, §9-10, L8 gateway caps.
  - [x] Fetch live Mistral wire [O8]: realtime endpoint/model, session.update fields, append/end, delta/done, turn events, TTS endpoint/voices.
  - [x] Seam: mesh dependency-free; admission as data + injected usage sink; TTS = selection/binding only (no synthesis transport in mesh).
  - [x] Worktree `tmp/worktrees/stt-l13`, branch `feat/live-stt-l13`, base `origin/feat/live-stt-l8` at 82b24e2b3.
  - [x] Harness plan event recorded; `harness check branch` PASS C1.
  - [x] Lot gate: base head verified, scope boundaries declared, no exception needed.
- [ ] **Lot 1 — STT adapter `speech/mistral-transcription.ts`**
  - [ ] Profile config `mistral-voxtral-realtime-3`: model pin `voxtral-mini-transcribe-realtime-3`, delay `target_streaming_delay_ms`, language fr/en, format pcm16/24k mono, placement cloud-relay; server turn_detection pinned off (client commits drive turns).
  - [ ] `session.update` builder: `session` object with audio_format/language/delay; refuse unsupported fields at open (fail-closed).
  - [ ] Transport port (injectable WS): append base64 pcm16, no audio persisted, no key in logs/errors.
  - [ ] Turn mapping: one provider stream per client turn; `input.commit` sends `input_audio.end` and emits the final from `transcription.done` (record); lazy reopen on next write; `input.clear` abandons the stream (close + drop, no final); uncommitted trailing audio emits no final at close.
  - [ ] Event mapping: `transcription.text.delta` append-only partials under the client utteranceId; per-turn audioInterval from the open-turn capture window; `transcription.done` final; `error{code,message}` to session error; unknown events tolerated.
  - [ ] Metering: admission receipt required; injectable expiry timer (min(admission, request maxDurationMs)); cumulative usage records under a stable eventId; settle without providerRevision.
  - [ ] TTS exclusion from the STT adapter: no synthesis field, no implicit voice.
  - [ ] Lot gate: `make typecheck-llm-mesh` green on the lot head.
- [ ] **Lot 2 — TTS binding/registry**
  - [ ] Mistral TTS binding: provider mistral, model `voxtral-mini-tts-3-0`, preset voices (Voxtral 3 list incl. fr Marie/Manon/Lea/Camille, en US/UK), response_format; no implicit voice (explicit voice_id required).
  - [ ] Capabilities entry: tts supported, stt refused on the TTS binding and vice versa; usageUnits characters (price separation from audio-seconds); regions unset (explicit region refused fail-closed, no documented API region).
  - [ ] Request-shape fixture pins `POST /v1/audio/speech` fields from docs (no live call).
  - [ ] Lot gate: negotiation tests green (accept documented voice+language, refuse unknown voice/region/format).
- [ ] **Lot 3 — Fixtures + gate tests**
  - [ ] `tests/fixtures/mistral-frames.ts`: recorded session.created/updated, delta scripts, done records, turn events, invalid/error frames; no live call.
  - [ ] `tests/speech-mistral.test.ts`: endpoint/final mapping, cancel/flush, no double count, late-frame suppression (incl. post-close), Bearer redaction, per-turn windows, completed-only done, orphan/empty-turn behavior.
  - [ ] Lot gate: `make test-llm-mesh` green (SCOPE=file then full) on the lot head.
- [ ] **Lot 4 — Receipt + version**
  - [ ] `bench/l13-mistral.receipt.json`: status blocked, exact missing G-CLOUD/§10 items, price revision unpinned, no live evidence claimed.
  - [ ] Bump `packages/llm-mesh/package.json` to 0.31.0 (train rhythm; collision with L9 noted above); cascade tuple ranges/fixtures/lock integrity via sanctioned refresh only.
  - [ ] Lot gate: receipt present and blocked, version bumped, `make build-llm-mesh` + `make pack-llm-mesh` green.
- [ ] **Lot N — Final validation**
  - [ ] `make scope-check` (harness) green.
  - [ ] Push, draft PR against `feat/live-stt-l8`, CI green on the exact head.
  - [ ] Report PR number, head SHA, CI URL without merging.
  - [ ] `make down ENV=test-stt-l13`.

## Deferred to BR-XX
- None.
