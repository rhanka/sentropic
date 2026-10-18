# Feature: Document the ten-minute CI/CD study and nine-branch implementation train

## Objective
- [x] Preserve the validated CI/CD study in English and turn its nine steps into executable branch plans, with E2E and CD included in the measured acceptance endpoints.

## Scope / Guardrails
- [x] Documentation only: `spec/**`, `plan/**`, and `BRANCH.md`; no workflow, runtime, deployment, or Track-state changes.
- [x] Worktree: `tmp/worktrees/ci-cd-plan`; branch: `docs/ci-cd-plan`; fetched base: `9ed96eb83cd77da710f1adeb83a19e425d6c4910`.
- [x] Make-only commands; `ENV` last when supplied; no services or automated tests on `ENV=dev`.
- [x] No services required here; documentation checks use `ENV=test-ci-cd-plan`; no ports allocated.
- [x] English documentation; owner quotations remain verbatim in French; no secrets or attribution trailers.
- [x] Preserve measured / computed / budget-to-measure distinctions; no new performance result is claimed.
- [x] Atomic commits of at most 150 changed lines through `make commit`; selective staging and `make scope-check` before each commit.
- [x] Publish a non-draft PR, report its number and head SHA, then stop; the author must not merge.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - [x] `spec/**`
  - [x] `plan/**`
  - [x] `BRANCH.md`
- [x] **Forbidden Paths (must not change in this branch)**:
  - [x] `Makefile`
  - [x] `docker-compose*.yml`
  - [x] `.cursor/rules/**`
  - [x] `.github/workflows/**`
  - [x] `api/**`
  - [x] `ui/**`
  - [x] `packages/**`
  - [x] `scripts/**`
  - [x] `deploy/**`
  - [x] `.track/**`
  - [x] `PLAN.md`
- [x] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [x] None; implementation exceptions belong in the future branch plans.
- [x] **Exception process**: record reason, impact, and rollback under `Feedback Loop` before any scope change; none required for this documentation branch.

## Feedback Loop
- [x] `acknowledge` — PR #701 F1: remove explicit forbidden entries that shadow the nine Makefile exceptions and the deterministic-provider Compose overlay; retain bounded conditional paths and profile defaults.
- [x] PR #701 F2: distinguish file sequence 62–70 from canonical BR-76–84; propagate titles, train order, dependencies, exception IDs, and canonical-ID port slots while retaining unique slug-based environments.
  - [x] Allocate canonical BR-76–84 in the study; preserve existing allocations through BR-75 and the requested file sequence.
- [x] PR #701 F3: require API typecheck/lint before BR-81 UAT; enumerate applicable static/build/API/UI/E2E final gates in all nine plans, explicit unchanged surfaces, isolated ports, exact artifacts, and separate daily live results.
- [x] `acknowledge` — Owner, 2026-10-18: « écoute je suis en phase avec le plan proposé pour le CI/CD, je le veux commité / fusionné et planifié en branches stp ».
- [x] `clarification` — Merge GO applies after green CI and review; this author's explicit handoff ends at the opened PR, without merging or deleting this branch plan.
- [x] `clarification` — The superseded acceleration branch is not an implementation dependency; the nine-step plan is the retained source.
- [x] `clarification` — Future native CI execution is a scoped implementation change; the documentation work does not change Docker-first execution rules.

## AI Flaky tests
- [x] Not applicable to documentation checks; future deterministic qualification must block on failure.
- [x] No timeout increases or implied acceptance of flaky tests; any future live-provider exception requires the documented same-commit evidence and owner sign-off.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch** — One documentation author; no integration between implementation worktrees in this PR.
- [ ] **Multi-branch** — Nine future implementation branches, serialized in the study's train index.
- [x] Rationale: record the implementation train now; its execution and Track imports belong to the conductor after this PR.

## UAT Management (in orchestration context)
- [x] Documentation UAT: compare retained decisions, source evidence, scope, dependencies, and rollback against the validated dossier.
- [x] No web, Chrome, or VSCode application behavior changes; no runtime UAT or root environment required.
- [x] Qualification and review must identify the exact PR head; source validation is not review of this documentation diff.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read project rules, template, neighbouring studies, and validated source material.
  - [x] Verify branch with harness, fetch `origin/main`, and confirm the clean branch starts at that base.
  - [x] Verify source plan SHA-256 `426bb0663d9a9ca4df2ee9030603f00a93a362a003da80e34c729143a55bc820` and availability of plan files 62 through 70.
- [x] **Lot 1 — Study consolidation**
  - [x] Record evidence, owner constraints, retained architecture, and budget calculations in `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md`.
  - [x] Add the train index, acceptance protocol, rollback policy, and source provenance.
- [x] **Lot 2 — Executable branch plans**
  - [x] BR-76: measure and reserve capacity.
  - [x] BR-77: prepare once and run native static checks.
  - [x] BR-78: build and transfer less.
  - [x] BR-79: execute independent work together.
  - [x] BR-80: one package candidate and independent qualification.
  - [x] BR-81: deterministic journeys and daily live providers.
  - [x] BR-82: complete CD on tested bytes.
  - [x] BR-83: remove unnecessary consumer work with proof.
  - [x] BR-84: prove the maximum and present the results.
- [ ] **Lot 3 — Final validation and handoff**
  - [x] Check template structure, links, branch order, exact paths, exceptions, and metric provenance.
  - [x] Inspect the entire diff and every commit size; run documentation checks and scope checks.
  - [ ] Push, create a non-draft PR using this file as its body, and inspect the initial CI state.
  - [ ] Report PR number, exact head SHA, and the nine-branch list; stop before merge.
