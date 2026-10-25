# Feature: Live STT L1 provider-neutral speech contract

## Objective
- [ ] Deliver approved r3 L1: speech identities, media/transcript contract, capability negotiation and public exports.
- [x] Read L0 PR #753 at `008d66b5fd6ff04d1c44f69cf52892c4c3587980`; its docs/evidence remain the prerequisite inventory.

## Scope / Guardrails
- [x] Author: codex / gpt-6.1-sol / high; spec SHA-256 `5a666faa9e1856245ef94b19988cb08514e6e1aeac32918715c07f8ce4a24c61`.
- [x] Branch `feat/live-stt-l1`, worktree `tmp/worktrees/live-stt-l1`, origin/main `fbfe68f0e40d386e6b3429abc2ea8f868fcdd3f6`.
- [x] Make-only, ENV last: `ENV=test-live-stt-l1`; shared Docker flock; existing Compose qualification service, no published ports.
- [x] No paid API, inference, microphone, model download, Python, publication or deployment.
- [x] Specific-file staging; make commit only; commits under 150 changed lines; no attribution trailers.
- [x] Preserve root and other worktrees; Sol serializes shared catalogue/barrel/manifest edits.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/llm-mesh/src/speech/**`
  - `packages/llm-mesh/src/capabilities.ts`
  - `packages/llm-mesh/src/catalog.ts`
  - `packages/llm-mesh/src/index.ts`
  - `packages/llm-mesh/tests/speech-contract.test.ts`
  - `packages/llm-mesh/package.json`
  - `packages/llm-mesh/README.md`
  - `package-lock.json`
  - `.tmp/live-stt/l1/**`
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
  - [x] Declare BRLIVE-L1-EXn with reason, impact and rollback before extending scope; none planned.

## Feedback Loop
- [x] L0 is an open draft; retain exact evidence commit and open G-REVIEW.
- [x] External Make adapter rebinds existing mesh targets to existing Compose qualification service; tracked build files unchanged.
- [x] External gates remain with L0 owners; deterministic contract work can proceed per §11.2.
- [x] BRLIVE-L1-EX1: root npm ci dry-run fails after mesh 0.28 bump; lock refresh proves ERESOLVE on cluster's `<0.28.0` optional peer. Align manifest/lock and matching module guard to `<0.29.0`; update only version-bound fixtures and bump cluster patch. Impact: admit additive mesh 0.28; no speech config/projection. Rollback: restore range/lock/fixtures if mesh bump is reverted. Verify root dry-run plus cluster module/integration tests; publication remains external.

## AI Flaky tests
- [x] Deterministic tests only; no flaky waiver or live qualification claim.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, sequential implementation; no delegated inference capacity admitted.
- [ ] Multi-branch not required for L1.

## UAT Management (in orchestration context)
- [x] Review exported types/fixtures in draft PR; no web/Chrome/VSCode interaction changes.
- [x] Device, native runtime and provider qualification remain downstream.

## Plan / Todo (lot-based)
- [x] **L1a — Baseline and constraints**
  - [x] Read lock/rules/template/spec/owner answers and all eight L0 deliverables; mechanical branch check passes.
  - [x] Write `.tmp/live-stt/l1/baseline.md`: pinned L0 gates, dedicated capacity, releases and placements.
- [ ] **L1b — Tests first**
  - [x] Add `packages/llm-mesh/tests/speech-contract.test.ts`; red: missing speech/contracts.js before implementation.
  - [x] Targeted green: 23 tests for negotiation, binary metadata, refusal, partial revisions and existing text compatibility.
- [ ] **L1c — Implementation**
  - [x] Define exact engine/configuration/target identities and binary media headers with frame-local validation.
  - [x] Add per-tuple four-state capabilities and fail-closed ordered media negotiation.
  - [x] Define revisioned transcripts, admitted session receipt and independent duplex adapter port.
  - [x] Add `speech/{contracts,capabilities,index}.ts`, catalogue lookup and exports.
  - [x] Registry latest 0.27.1 checked before bump; prepare 0.28.0 and update root workspace lock version.
- [ ] **L1d — Docs consolidation**
  - [x] Document all public exports and provider/coordinator ownership boundaries in package README.
  - [ ] Document public surface and evidence in README and `.tmp/live-stt/l1/validation.md`.
- [ ] **L1e — Final validation and draft handoff**
  - [x] Mesh regression: 47 files / 847 tests pass; source and speech-test typecheck and changed-source lint pass.
  - [ ] Scoped red/green, full mesh tests, typecheck, lint, build and packed-export checks.
  - [ ] Scope check before every commit, whitespace/line-count/trailer checks and ENV cleanup.
  - [ ] Record independent review availability without claiming consensus.
  - [ ] Push draft PR with plan as body; inspect exact-head CI metadata.

## Deferred to later live-speech lots
- [x] Configuration projection, coordinator/fences/reconciliation, adapters, accounting, capacity reservations, publication and deployment.
