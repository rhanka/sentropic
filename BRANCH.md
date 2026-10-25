# Feature: Live STT L0 baseline and dedicated capacity study

## Objective
- [x] Execute only L0 of approved live-speech r3; freeze evidence and scopes for subsequent lots.
- [ ] Deliver baseline, entry gates, dependencies, placement/release matrix and capacity feasibility study.

## Scope / Guardrails
- [x] Author: codex / gpt-6.1-sol / high; owner request authorizes this documentation PR only.
- [x] Branch `feat/live-stt-l0`; worktree `tmp/worktrees/live-stt-l0`; base `origin/main` at `fbfe68f0e40d386e6b3429abc2ea8f868fcdd3f6`.
- [x] Read Docker lock first, MASTER, workflow, README/TODO/PLAN, template, approved spec and owner answers.
- [x] Make-only; ENV last: `ENV=test-live-stt-l0`; no application ports or services required.
- [x] No paid API calls, microphone capture, inference, model download, provisioning, publication or deployment.
- [x] Zero Python execution; engine repositories and other worktrees remain read-only.
- [x] Under 150 changed lines per commit; specific-file staging and `make commit MSG="..."` only.
- [x] L0 documents live under `.tmp/live-stt/l0/`, beside the approved study; r3 names no L0 filenames.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `.tmp/live-stt/l0/**`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `.track/**`
  - `packages/**`
  - `api/**`
  - `ui/**`
  - `plan/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `scripts/**` (none planned).
- **Exception process**:
  - [x] Declare `BRLIVE-L0-EXn` with reason, impact and rollback before extending scope; none authorized.

## Feedback Loop
- [x] Preserve concurrent root/h2a changes; no shared Track writer is assigned, so do not import or append `.track`.
- [x] Existing `scope-check` builds/runs raw Docker containers incompatible with the lock's compose-only rule; use its host harness checker through an external Make recipe and skip `build-harness`.
- [x] Record open entry gates with accountable owner, evidence and bounded closure criteria.

## AI Flaky tests
- [x] Documentation/evidence only; no AI tests, flaky waiver or live qualification claim.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch**: sequential documentation authoring; no integration from other branches.
- [ ] **Multi-branch**: not required for the single L0 concern.

## UAT Management (in orchestration context)
- [x] Review documents through the draft PR; no web/Chrome/VSCode interaction changes.
- [x] Native microphone, provider, runtime and device acceptance remain downstream gates.

## Plan / Todo (lot-based)
- [x] **L0a — Baseline and constraints**
  - [x] Create isolated worktree from fetched origin/main; mechanical harness branch check passes.
  - [x] Verify approved input hashes and inspect current source/registry/PR evidence without inference.
- [x] **L0b — Heads and entry gates**
  - [x] Write `.tmp/live-stt/l0/baseline.md` and `gates.md`; distinguish merge, publish, integration and deployment.
- [x] **L0c — Dependencies and provenance**
  - [x] Write `.tmp/live-stt/l0/dependencies.md`; inventory SDKs, installers, binary hashes, licenses and blocked qualification.
- [x] **L0d — Placement and release scope**
  - [x] Write `.tmp/live-stt/l0/placements.md` and `scope-release.md`; retain every owner-selected configuration.
- [ ] **L0e — Capacity feasibility**
  - [ ] Write `.tmp/live-stt/l0/capacity-study.md`; entitlement, allocation source, costs, limits, daily shares/dates and reservation outcome.
- [ ] **L0f — Documentation validation and draft handoff**
  - [ ] Check all gate IDs, local links, arithmetic, approved hashes and complete cumulative docs-only diff.
  - [ ] Run `make scope-check` before each commit through the host harness recipe; check each staged diff under 150 lines.
  - [ ] Record evidence and review limitations in `.tmp/live-stt/l0/validation.md`.
  - [ ] Push and open draft PR with this exact branch plan as body; inspect CI metadata without paid execution.
  - [ ] Run locked `make down ENV=test-live-stt-l0`; verify clean worktree and final head.

## Deferred to later live-speech lots
- [x] L1 onward, runtime qualification, account/capacity changes, package publication and deployment are outside this PR.
