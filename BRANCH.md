# Feature: Land approved cluster-mesh specifications

## Objective
- [x] Execute the approved specs-landing packet from origin/main without changing specification bodies.

## Scope / Guardrails
- [x] Documentation only; no cluster, production, T3, application, workflow, or dependency changes.
- [x] Worktree: tmp/worktrees/specs-landing; branch: docs/specs-landing.
- [x] Test environment: test-cm-specs-land; API_PORT=9460, UI_PORT=5660, MAILDEV_UI_PORT=1560.
- [x] Preserve approved specification bytes; prepend only the requested supersession notice to the two retired builder specs.
- [x] One commit per large specification is explicitly permitted by the packet.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `spec/CM_FIRST_ARTIFACTS.md`
  - `spec/SPEC_EVOL_V8_ARTIFACT_DELIVERY.md`
  - `spec/SPEC_EVOL_APP_VUE_VAPOR_MIGRATION.md`
  - `spec/SPEC_EVOL_APP_CONTEXT_GENERIC.md`
  - `spec/SPEC_EVOL_ARTIFACT_BUILDER_SLO.md`
  - `spec/SPEC_EVOL_ARTIFACT_BUILDER_SERVERLESS.md`
  - `spec/SPEC_EVOL_CLUSTER_MESH_GAS.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `api/**`
  - `ui/**`
  - `packages/**`
  - `deploy/**`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `spec/SPEC_EVOL_CONNECTOR_ACCOUNT_WORKSPACE_EXPOSURE.md` (approval evidence required)

## Feedback Loop
- [x] Connector exposure: not landed: status unknown; source still says DRAFT / ARCHITECTURE DECISION, no approval found in .tmp/rv or git history.
- [x] GAS: FROZEN r3 confirmed by .tmp/rv/spec-n1-frozen.md and commit a06c561934c52924e7d72b359f18ac310c79a98c; r3 co-review resolves OQ13/OQ14.
- [x] Track source is this mergeable branch plan; shared .track remains owned by the conductor for its single-writer import.

## AI Flaky tests
- [x] Not applicable: documentation only.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; no delegated implementation or integration required.

## UAT Management (in orchestration context)
- [x] Not applicable: no runtime or UI behavior changes.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and approval evidence**
  - [x] Read repository rules, common rules, packet, and consolidated plan; create isolated worktree from origin/main and pass harness check branch.
  - [x] Verify V8 source SHA-256: ab53eb6a61a07fbff7c4092bcb64806b528825a8cf190e619008c680cccf2b9e.
- [ ] **Lot 1 — Approved specifications**
  - [x] Land CM_FIRST_ARTIFACTS unchanged.
  - [x] Land V8 delivery unchanged.
  - [x] Land Vue Vapor migration unchanged.
  - [x] Land generic app context unchanged.
  - [x] Land frozen GAS r3 unchanged.
- [ ] **Lot 2 — Superseded builder specifications**
  - [x] Land SLO with the requested supersession header and unchanged body.
  - [ ] Land serverless with the requested supersession header and unchanged body.
- [ ] **Lot 3 — Final validation and handoff**
  - [ ] Verify exact source/body equivalence and git diff --check; pass make scope-check before every commit.
  - [x] Inspect CI path classification; spec/** does not select application/package suites; do not modify ci.yml.
  - [ ] Push final reviewed head; create PR with this plan as body and an execution-plan comment.
  - [ ] Wait for successful CI on the exact PR head; do not merge.
  - [ ] Write French report and completion marker under .tmp/rv with conductor Track import handoff.
