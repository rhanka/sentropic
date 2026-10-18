# Feature: CI timing knowledge for integration planning

## Objective
- [x] Turn the approved study into a repository study defining committed timing, CI/CD and architecture knowledge for conductor planning.
- [x] Preserve the binding owner request and French dossiers; record D1-C (2026-10-18), keeping D2 open and conditional.

## Scope / Guardrails
- [x] Documentation only: `spec/SPEC_STUDY_CI_TIMING_KNOWLEDGE.md` and this branch plan.
- [x] Branch: `spec/ci-timing-knowledge`; base: `origin/main` at `8c3a44c176ee06c9e2d1666158079c23a8b731ab`.
- [x] Worktree: `tmp/worktrees/ci-timing-knowledge`; root development workspace remains reserved for its owner.
- [x] Use Make for checks and commits, with `ENV=test-ci-timing-knowledge` last; no service or port allocation is needed.
- [x] Keep each commit below 150 changed lines, stage explicit paths and update this checklist in every commit.
- [x] English documentation except the verbatim owner request and the French owner decisions explicitly requested for this study.
- [x] Update draft PR #698, commit and push the owner decision, report the head SHA and stop; never merge or implement K0–K6 here.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - [x] `BRANCH.md`
  - [x] `spec/SPEC_STUDY_CI_TIMING_KNOWLEDGE.md`
- [x] **Forbidden Paths (must not change in this branch)**:
  - [x] `Makefile`
  - [x] `docker-compose*.yml`
  - [x] `.cursor/rules/**`
  - [x] `.github/workflows/**`
  - [x] `.track/**`
  - [x] `packages/**`
  - [x] `knowledge/**`
  - [x] `plan/**`
- [x] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**: none.
- [x] **Exception process**: declare a scoped exception with rationale, impact and rollback before any expansion; none needed.

## Feedback Loop
- [x] R2-P3 — Owner: study author; status: resolved. Active contract consolidated, obsolete votes retired and source identities/citations refreshed in study §10.
- [x] D1 — Owner: repository owner; status: closed, C selected on 2026-10-18. [Decision](spec/SPEC_STUDY_CI_TIMING_KNOWLEDGE.md#d1): Engram primary timing service with committed typed exports; preserve the options table.
- [x] D2 — Owner: repository owner; status: open and conditional. Preserve the [resource-priority dossier](spec/SPEC_STUDY_CI_TIMING_KNOWLEDGE.md#d2); reversible drafting has no new approval prerequisite.
- [x] D1-C contract — Co-owned with gr-conductor; spec author Muse Wonder, review Astra. Align with ontology guardianship; preserve D3/D10 and closed DTOs; specification/qualification remain K0/K5 work.
- [x] Track — Existing WP9 study item `01M57FSNB4ZYA7N55GEWAN2016`, parent `01KYNH2CTQXQSGHD731H19T3XX`; leave import/realization to the designated repository writer.

## AI Flaky tests
- [x] Not applicable: documentation-only work, no product test changes or runtime qualification claims.

## Orchestration Mode (AI-selected)
- [x] Mono-branch: one documentation author in the isolated worktree; the supplied approval governs editorial consolidation.
- [x] Proposed cross-owner implementation lots belong in the study and do not create implementation branches here.

## UAT Management (in orchestration context)
- [x] Web, Chrome and VSCode UAT: not applicable; no user-facing runtime changes.
- [x] Document review checks the owner quote, active decisions, authority boundaries, source pins and internal links.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read repository rules, template, neighbouring studies and approved source/reconciliation/review.
  - [x] Fetch, create the requested worktree from `origin/main`, and pass `harness check branch`.
  - [x] Define exact scope, source pins, documentation checks and the draft-only delivery boundary.
- [x] **Lot 1 — Evidence and timing contract**
  - [x] Add the binding request, pinned evidence, record types, regime applicability and refresh rules to the study.
  - [x] Gate: verify quoted populations and measured/modelled/unknown distinctions against the approved inputs.
- [x] **Lot 2 — Typed knowledge and authority boundaries**
  - [x] Add one DS profile, explicit lossless adapters, package layout and the technical-package/memory boundary.
  - [x] Gate: preserve relation conservation, provenance, separate views and exclusion of memory metadata from committed facts.
- [x] **Lot 3 — Conductor and capitalisation contracts**
  - [x] Add deterministic scheduling, phase-matched steering, source-skill adoption, Track joins and the qualified Engram seam.
  - [x] Gate: retain coverage, zero unqualified reuse credit, historical/incomplete fallbacks and host prerequisites.
- [x] **Lot 4 — Delivery, decisions and documentation consolidation**
  - [x] Align K0–K6, observable exits and dependencies with D1-C; keep D2 conditional and distinguish selected scope from unqualified implementation.
  - [x] Link the parallel ontology-guardian decision, record the additional Engram contract/circuit and preserve memory authority and closed-DTO constraints.
  - [x] Record R2-P3 resolution and refreshed source hashes; make the study self-contained without scratch-file prerequisites.
- [x] **Lot 5 — Final validation**
  - [x] Pass `make scope-check ENV=test-ci-timing-knowledge` and `git diff --check`; inspect every changed path and commit size.
  - [x] Check relative links and French decision anchors, exact owner quote, source digests and supersession consistency.
  - [x] API/UI/E2E tests and package bumps: not applicable to these two Markdown files.
  - [x] Prepare the draft PR from this exact branch plan and retain `BRANCH.md` for review.
