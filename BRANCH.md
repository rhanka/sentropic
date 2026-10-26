# Feature: Live STT L1c cluster speech configuration

## Objective
- [x] Deliver approved r3 L1c: versioned stage bindings, mic policy and offline projection without fixed engines.
- [x] Preserve L0 PR #753 at `c0bd543689e31c6511150b2d26b71947bb85c455`; refresh its moving facts for L1c.

## Scope / Guardrails
- [x] Author: codex / gpt-6.1-sol / high; spec SHA-256 `5a666faa9e1856245ef94b19988cb08514e6e1aeac32918715c07f8ce4a24c61`.
- [x] Branch `feat/live-stt-l1c`, worktree `tmp/worktrees/live-stt-l1c`, origin/main `fbfe68f0e40d386e6b3429abc2ea8f868fcdd3f6`.
- [x] Make-only, ENV last: `ENV=test-live-stt-l1c`; shared Docker flock; existing Compose qualification service, no published ports.
- [x] No paid API, inference, microphone, model download, Python, publication or deployment.
- [x] Specific-file staging; make commit only; commits under 150 changed lines; no attribution trailers.
- [x] Preserve root and other worktrees; Sol serializes shared catalogue/barrel/manifest edits.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `.tmp/live-stt/l1c/**`
  - `.tmp/live-stt/l0/**`
  - `packages/cluster-mesh/src/speech/**`
  - `packages/cluster-mesh/src/config.ts`
  - `packages/cluster-mesh/src/index.ts`
  - `packages/cluster-mesh/README.md`
  - `packages/cluster-mesh/CHANGELOG.md`
  - `packages/cluster-mesh/tests/speech-*.spec.ts`
  - `packages/cluster-mesh/tests/speech-fixtures.ts`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
  - `package-lock.json`
  - `packages/cluster-mesh/package.json`
  - `packages/cluster-mesh/src/modules/catalog.ts`
  - `packages/cluster-mesh/src/modules/contracts.ts`
  - `packages/cluster-mesh/tests/packaging/tuple-skew.spec.ts`
  - `packages/cluster-mesh/tests/modules/registry.spec.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `.track/**`
  - `api/**`
  - `ui/**`
  - `plan/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `scripts/**` (none planned).
- **Exception process**:
  - [x] Declare BRLIVE-L1C-EXn with reason, impact and rollback before extending scope.

## Feedback Loop
- [x] BRLIVE-L1C-EX3: register speech with the existing guarded module catalogue and extend the packed skew probe. Scope adds only module IDs and tuple-skew assertions; rollback removes that entry and probe. Required by PR757-P2-1; broad text-peer compatibility is retained.
- [x] PR757-P1: tests first reproduced three refusals; chained profiles now allow STT-only or TTS-only, and native duplex permits independently selected companion stages. Empty profiles and requirements on absent stages remain refused.
- [x] Draft #757 targets feat/live-stt-l1 to isolate this lot. Existing CI triggers only for main PRs, so exact-head workflow query returns no runs. Owner/integrator must merge #754 then retarget #757 to main and obtain its CI result before merge; no workflow gate changed.
- [x] Cold source typecheck found TS2322 on the already validated cost field; explicitly type its normalized numeric output, retaining NaN/negative refusal tests. Quality adapter also compiles existing type fixtures.
- [x] Existing packaging gate requires a root declaration graph free of optional peers; make the profile schema self-contained and check structural compatibility at the L1 negotiation boundary. No provider/router implementation is copied.
- [x] Scoped green attempt: 44 pass, 2 fixture failures because native-duplex cases retained chained stt requirements. Replace those fixture requirements with an empty stage map; preserve strict pipeline validation.
- [x] BRLIVE-L1C-EX2: additive feature prepares cluster 0.23.0 above registry 0.22.1; extend only the self comments-leaf range to <0.24.0, retain next-minor refusal, and align frozen selected archive/lock. Impact: same comments API on additive speech release; rollback with the 0.23 bump. Full module/packaging checks required.
- [x] Scoped parser failure pinpoints a line break before the type assertion; keep the assertion with its expression and rerun the same suites.
- [x] origin/feat/live-stt-l1c absent; created from origin/main and merged approved L1 head `01d784be8` by fast-forward, no rebase.
- [x] BRLIVE-L1C-EX1: existing cold workspace/Compose targets only; external adapter avoids inherited raw Docker scope prerequisite; no tracked build/CI change.

## Plan / Todo (lot-based)
- [x] L1c baseline: Docker lock first, rules/spec/owner answers and L0 evidence read; mechanical branch check passes.
- [x] Replace inherited scope/plan with L1c file-level gates before source edits.
- [x] **L1c-a — Reconcile L0**
  - [x] Preserve L0 baseline and complete §11.2 gate register from source head `c0bd543689`.
  - [x] Preserve SDK/native provenance/toolchain/license inventory and all required placements; artifacts remain unadmitted.
  - [x] Preserve L0 release-owner/ledger scope and validation receipts; all eight historical deliverables retained byte-for-byte.
  - [x] Preserve eight L0 files under `.tmp/live-stt/l0/`; refresh heads, gate register, SDK/provenance/license/ledger/release and placement evidence in `.tmp/live-stt/l1c/baseline.md`.
  - [x] Carry dedicated capacity study and explicit zero allocation; no native inference or quota exception.
- [x] **L1c-b — Tests first**
  - [x] `packages/cluster-mesh/tests/speech-fixtures.ts`: five primary tuples, whisper.cpp and synthetic future/native-duplex/placement entries.
  - [x] `packages/cluster-mesh/tests/speech-config.spec.ts`: bindings/selectors, invalid shapes, all placements, both mic modes, empty/explicit fallback, unsupported capability refusal, no secrets.
  - [x] `packages/cluster-mesh/tests/speech-projection.spec.ts`: offline snapshot, tenant/policy/egress refusal, unavailable catalogue, safe rebind, immutable revision, consent and no fallback.
  - [x] Red at `ac7134bfd`: both suites fail on missing speech/config.js before source implementation.
  - [x] Red run before implementation; first scoped green 48 tests after config/projection and existing seam integration.
  - [x] Add reproducible Compose-only strict speech-test types, changed-source lint/build/content and existing packed-tuple adapter; root files unchanged.
- [x] **L1c-c — Implementation**
  - [x] Strict profile decoder, immutable snapshots and existing cluster config seam implemented; catalogue projection follows.
  - [x] Catalogue projection negotiates each exact stage tuple and intersects trusted tenant/policy/placement/egress evidence; no routing or credentials added.
  - [x] Explicit rebind barrier requires cancellation/reconciliation/drained playback and renewed revision-bound consent; speech subpath preserves optional provider loading.
  - [x] `packages/cluster-mesh/src/speech/{config,projection}.ts`: one revisioned schema and local projection consuming llm-mesh catalogue/negotiation.
  - [x] Extend existing `src/config.ts` and public barrel/subpath; keep mic activation and gateway account/resource admission with session authorities.
  - [x] Prepare semver above registry; align only directly affected version assertions and selected packed fixture; no publication.
- [x] **L1c-d — Documentation and validation**
  - [x] Quality gate: strict source/speech-test/existing-fixture types, changed-source lint, build and packed-content exports pass.
  - [x] Full default cluster suite passes 1,162 tests; 129 environment-gated skips recorded separately from packed qualification.
  - [x] README/CHANGELOG: configuration example, selectors, placements, fallback/rebind/consent boundaries and unavailable reasons.
  - [x] Scoped speech 48; full cluster 1,162 plus 129 gated skips; packed matrix 100/100; strict typecheck/lint/build/public exports pass.
  - [x] `make scope-check` before each commit; whitespace and under-150-line/trailer audit at handoff.
  - [x] Locked ENV cleanup between Docker steps; no services or published ports outside ENV.
- [x] **L1c-e — Draft handoff**
  - [x] Record independent-review eligibility/evidence; retain open G-REVIEW with no admitted complementary reviewer capacity.
  - [x] Push draft #757 using this plan as body; exact-head CI queried, no run because base is L1; final head and surface reported at handoff.

## AI Flaky tests
- [x] Deterministic fixtures only; no flaky waiver.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, sequential; no inferred reviewer/native capacity.
- [ ] Multi-branch not required for this single lot.

## UAT Management (in orchestration context)
- [x] Export/configuration review through draft PR; no microphone/UI activation or device acceptance.
- [x] Reproduce all fixture gates on the delivered source tuple; no native/UAT acceptance inferred.

## Deferred to later live-speech lots
- [x] Engines, controllers/fences, accounting, native/cloud/device qualification, release/adoption and deployment retain their §11.2 owner gates.
