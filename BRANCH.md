# Feature: Live STT L0 baseline and dedicated capacity study

## Objective
- [x] Execute only L0 of approved live-speech r3; freeze evidence and scopes for subsequent lots.
- [x] Deliver baseline, entry gates, dependencies, placement/release matrix and capacity feasibility study.

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
- [x] PR753-P2-1 — Cost shared native-campaign CI displacement and custody serialization; present priced dedicated-seat candidate A/B/C without selecting or admitting capacity.
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
- [x] **L0e — Capacity feasibility**
  - [x] Write `.tmp/live-stt/l0/capacity-study.md`; entitlement, allocation source, costs, limits, daily shares/dates and reservation outcome.
  - [x] Quantify 774 displaced CI units over 129 days, conditional credit costs, 144/159/174-day custody calendars and Business seat pricing/feasibility; owner choice pending.
- [x] **L0f — Documentation validation and draft handoff**
  - [x] Check all gate IDs, local links, arithmetic, approved hashes and complete cumulative docs-only diff.
  - [x] Run `make scope-check` before each commit through the host harness recipe; check each staged diff under 150 lines.
  - [x] Record evidence and review limitations in `.tmp/live-stt/l0/validation.md`.
  - [x] Push and open draft PR #753 with this exact branch plan as body; CI metadata inspected without paid execution, final exact-head state reported at handoff.
  - [x] Run locked `make down ENV=test-live-stt-l0`; initial cleanup exits zero; recheck worktree/final head after handoff commit.

## Deferred to later live-speech lots
- [x] L1 onward, runtime qualification, account/capacity changes, package publication and deployment are outside this PR.
