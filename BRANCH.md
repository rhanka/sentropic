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
- [x] Integration qualification: full mesh 1529/1529, cluster-mesh 1223 passed with 138 qualification-specific tests skipped by the unit lane, manifest guards 201/201; both BLOCK archives pass and the official selected-lock refresh succeeds with artifacts 0.1.4 retained. Gateway archive SHA-256 `9baacd3f80ea65c5929f6139565cb8fc40c413749cbe2c96d42732b8d3800c4f`; mesh archive `19a028e45925fc5f88a7c57f0dfe7d09741f9999bf678d11cf466213f38fb266`.
- [x] Integration fixture: the gateway's retained L8 minimum is 0.28.0; align the existing dependency-floor CLI assertion with that range while preserving all version-selection checks.
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
