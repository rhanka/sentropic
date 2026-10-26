# Feature: Live STT L1 provider-neutral speech contract

## Objective
- [x] Deliver approved r3 L1: speech identities, media/transcript contract, capability negotiation and public exports.
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
  - `packages/llm-mesh/CHANGELOG.md`
  - `packages/cluster-mesh/tests/packaging/tuple-skew.spec.ts`
  - `api/tests/unit/gateway-package-version.test.ts`
  - `package-lock.json`
  - `.tmp/live-stt/l1/**`
  - `packages/cluster-mesh/package.json`
  - `packages/cluster-mesh/src/modules/catalog.ts`
  - `packages/cluster-mesh/tests/modules/registry.spec.ts`
  - `packages/cluster-mesh/tests/modules/topology-ranges.spec.ts`
  - `packages/cluster-mesh/tests/integrations/llm-surface.spec.ts`
  - `packages/cluster-mesh/tests/integrations/gateway-surface.spec.ts`
  - `packages/llm-gateway/package.json`
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
- [x] BRLIVE-L1-EX2: finish the 0.28 additive tuple qualification in cluster packaging tests and update only the API gateway release assertion to 0.21.1. Impact: no API runtime change; new speech subpath and separate evidence catalogue do not alter text routing. Rollback: restore assertions if the release tuple is reverted.
- [x] BRLIVE-L1-EX3: add the missing mesh 0.28.0 changelog/migration entry. Impact: document public speech and audio-output types. Rollback: remove the entry if 0.28.0 is withdrawn.
- [ ] R1: reproduce and fix all P1/P2 findings; run full mesh and tuple regressions, then exact-head CI.
- [x] R1 P1-2/P1-3/P2-2: open speech engine identity and independent multi-tuple catalogue; session selector membership and gateway-owned account/resource admission; remove provider speech inheritance.
- [x] L0 is an open draft; retain exact evidence commit and open G-REVIEW.
- [x] External Make adapter rebinds existing mesh targets to existing Compose qualification service; tracked build files unchanged.
- [x] External gates remain with L0 owners; deterministic contract work can proceed per §11.2.
- [x] BRLIVE-L1-EX1: root npm ci fails after mesh 0.28 bump; refresh proves cluster's `<0.28.0` peer conflict, then gateway's `^0.27.0` installs a second mesh. Align cluster peer/module range to `<0.29.0`, let gateway consume `^0.27.0 || ^0.28.0`, update version fixtures and patch bumps/lock. Impact: admit additive 0.28 with one workspace mesh; no speech config/projection/accounting. Rollback: restore ranges/lock/fixtures if mesh bump is reverted. Verify root dry-run and cluster module/integration tests; publication remains external.

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
- [x] **L1b — Tests first**
  - [x] Add `packages/llm-mesh/tests/speech-contract.test.ts`; red: missing speech/contracts.js before implementation.
  - [x] Targeted green: 23 tests for negotiation, binary metadata, refusal, partial revisions and existing text compatibility.
- [x] **L1c — Implementation**
  - [x] Define exact engine/configuration/target identities and binary media headers with frame-local validation.
  - [x] Add per-tuple four-state capabilities and fail-closed ordered media negotiation.
  - [x] Define revisioned transcripts, admitted session receipt and independent duplex adapter port.
  - [x] Add `speech/{contracts,capabilities,index}.ts`, catalogue lookup and exports.
  - [x] Registry latest 0.27.1 checked before bump; prepare 0.28.0 and update root workspace lock version.
- [x] **L1d — Docs consolidation**
  - [x] Document all public exports and provider/coordinator ownership boundaries in package README.
  - [x] Document public surface and evidence in README and `.tmp/live-stt/l1/validation.md`.
- [x] **L1e — Final validation and draft handoff**
  - [x] Cluster compatibility green: 73 module tests + 54 integration tests; packed imports/types and workspace npm ci dry-run pass.
  - [x] BRLIVE-L1-EX1 red: topology rejects 0.28.0; add its admission regression before range alignment.
  - [x] Align peer/module range and installed-version fixtures; prepare cluster 0.22.2 above refreshed published 0.22.1.
  - [x] Mesh regression: 47 files / 847 tests pass; source and speech-test typecheck and changed-source lint pass.
  - [x] Scoped red/green, full mesh tests, typecheck, lint, build and packed-export checks.
  - [x] Scope check before every commit, whitespace/line-count/trailer checks and ENV cleanup.
  - [x] Review selection failed: no entitled/current-day complementary reviewer allocation; `.tmp/live-stt/l1/review.md`, G-REVIEW open.
  - [x] Push draft PR #754 with plan as body; CI run 40246816381 observed in progress at initial head 0e4a0d33e. Final exact-head state reported at handoff.

## Deferred to later live-speech lots
- [x] Configuration projection, coordinator/fences/reconciliation, adapters, accounting, capacity reservations, publication and deployment.
