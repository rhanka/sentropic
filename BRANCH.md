# Feature: Live STT L1c cluster speech configuration

## Objective
- [ ] Deliver approved r3 L1c: versioned stage bindings, mic policy and offline projection without fixed engines.
- [x] Read L0 PR #753 at `008d66b5fd6ff04d1c44f69cf52892c4c3587980`; its docs/evidence remain the prerequisite inventory.

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
  - `packages/cluster-mesh/tests/packaging/tuple-skew.spec.ts`
  - `packages/cluster-mesh/tests/packaging/prepare-artifacts.spec.ts`
  - `packages/cluster-mesh/tests/packaging/optional-install.spec.ts`
  - `packages/cluster-mesh/tests/packaging/skew-invariants.ts`
  - `packages/cluster-mesh/tests/packaging/skew-invariants.spec.ts`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
  - `package-lock.json`
  - `packages/cluster-mesh/package.json`
  - `packages/cluster-mesh/src/modules/catalog.ts`
  - `packages/cluster-mesh/tests/modules/registry.spec.ts`
  - `packages/cluster-mesh/tests/modules/topology-ranges.spec.ts`
  - `packages/cluster-mesh/tests/integrations/llm-surface.spec.ts`
  - `packages/cluster-mesh/tests/integrations/gateway-surface.spec.ts`
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
- [x] origin/feat/live-stt-l1c absent; created from origin/main and merged approved L1 head `01d784be8` by fast-forward, no rebase.
- [x] BRLIVE-L1C-EX1: existing cold workspace/Compose targets only; external adapter avoids inherited raw Docker scope prerequisite; no tracked build/CI change.

## Plan / Todo (lot-based)
- [x] L1c baseline: Docker lock first, rules/spec/owner answers and L0 evidence read; mechanical branch check passes.
- [x] Replace inherited scope/plan with L1c file-level gates before source edits.
- [ ] **L1c-a — Reconcile L0**
  - [ ] Preserve eight L0 files under `.tmp/live-stt/l0/`; refresh heads, gate register, SDK/provenance/license/ledger/release and placement evidence in `.tmp/live-stt/l1c/baseline.md`.
  - [ ] Carry dedicated capacity study and explicit zero allocation; no native inference or quota exception.
- [ ] **L1c-b — Tests first**
  - [x] `packages/cluster-mesh/tests/speech-fixtures.ts`: five primary tuples, whisper.cpp and synthetic future/native-duplex/placement entries.
  - [x] `packages/cluster-mesh/tests/speech-config.spec.ts`: bindings/selectors, invalid shapes, all placements, both mic modes, empty/explicit fallback, unsupported capability refusal, no secrets.
  - [ ] `packages/cluster-mesh/tests/speech-projection.spec.ts`: offline snapshot, tenant/policy/egress refusal, unavailable catalogue, safe rebind, immutable revision, consent and no fallback.
  - [ ] Red run before implementation; green after config/projection and existing seam integration.
- [ ] **L1c-c — Implementation**
  - [ ] `packages/cluster-mesh/src/speech/{config,projection}.ts`: one revisioned schema and local projection consuming llm-mesh catalogue/negotiation.
  - [ ] Extend existing `src/config.ts` and public barrel/subpath; keep mic activation and gateway account/resource admission with session authorities.
  - [ ] Prepare semver above registry; align only directly affected version assertions and selected packed fixture; no publication.
- [ ] **L1c-d — Documentation and validation**
  - [ ] README/CHANGELOG: configuration example, selectors, placements, fallback/rebind/consent boundaries and unavailable reasons.
  - [ ] Scoped speech tests; full cluster tests; cold typecheck; changed-source lint; build/public export checks.
  - [ ] `make scope-check` before each commit; staged whitespace and under-150-line checks; no attribution trailers.
  - [ ] Locked ENV cleanup between Docker steps; no services or published ports outside ENV.
- [ ] **L1c-e — Draft handoff**
  - [ ] Record independent-review eligibility/evidence; retain open G-REVIEW if no admitted reviewer capacity.
  - [ ] Push draft PR using this plan as body; inspect exact-head CI; report PR/head and surface.

## AI Flaky tests
- [x] Deterministic fixtures only; no flaky waiver.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, sequential; no inferred reviewer/native capacity.
- [ ] Multi-branch not required for this single lot.

## UAT Management (in orchestration context)
- [x] Export/configuration review through draft PR; no microphone/UI activation or device acceptance.
- [ ] Reproduce all fixture gates on the delivered source tuple.

## Deferred to later live-speech lots
- [x] Engines, controllers/fences, accounting, native/cloud/device qualification, release/adoption and deployment retain their §11.2 owner gates.
