# Feature: BR-77 — Prepare once and run native static checks

## Objective
- [ ] Remove repeated development-stack preparation while preserving complete compiler and lint coverage.
- [ ] Branch `perf/ci-native-checks`, step 2 of nine; train order BR-77 → BR-78; dependencies: BR-76 metrics and result-set contract merged.

## Scope / Guardrails
- [ ] Follow `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md`; all timings below are **budget to measure**, not delivered results.
- [ ] Work only in `tmp/worktrees/ci-native-checks`; rebase on main after predecessor merge; one implementation branch active on the shared workflow/Makefile.
- [ ] Make entry points only; `ENV` last; tests on `ENV=test-ci-native-checks` or `ENV=e2e-ci-native-checks`, never `dev`; no secrets in evidence.
- [ ] Slot 0 owner: branch author; API_PORT=9385, UI_PORT=5585, MAILDEV_UI_PORT=1485; verify availability before starting services and pass all three ports to service commands.
- [ ] No migrations; keep root dev stable; no timeout inflation, removed assertions, or attribution trailers; commits ≤150 changed lines through `make commit` with scope checks.

## Branch Scope Boundaries (MANDATORY)
- [ ] **Allowed Paths (implementation scope)**:
  - [ ] `BRANCH.md`; `plan/63-BRANCH_perf-ci-native-checks.md`; `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md`.
  - [ ] `scripts/ci/prepare-check-workspace.mjs`
  - [ ] `scripts/ci/prepare-check-workspace.test.mjs`
  - [ ] `scripts/ci/native-checks.mjs`
  - [ ] `scripts/ci/native-checks.test.mjs`
- [ ] **Forbidden Paths (must not change in this branch)**:
  - [ ] `docker-compose*.yml`; `.cursor/rules/**`; `api/drizzle/*.sql`.
  - [ ] `plan/NN-BRANCH_*.md` except this branch file; `PLAN.md`; `.track/**`; production deployment configuration.
- [ ] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [ ] `.github/workflows/ci.yml` under BR77-EX1; `Makefile` under BR77-EX2.

- [ ] **Exception process**: apply only the declared purpose; record reason, impact, and rollback before changing a conditional path; any additional path needs its own bounded exception.

## Feedback Loop
- [ ] BR77-EX1 — Planned workflow exception: replace preparation in `typecheck-lint-api`, `typecheck-lint-ui`, `validate-llm-gateway`, `validate-artifacts`, `validate-chat-ui`, and `validate-mcp-platform`. Impact: selected CI/CD dispatch and required results. Rollback: revert this branch's workflow changes while preserving complete-result checks.
- [ ] BR77-EX2 — Planned Makefile exception: add explicit CI-native preparation/check entry points; retain Make as the interface and production-image checks. This bounded CI executor is the planned Docker-first exception. Impact: named CI entry points only. Rollback: restore the previous recipes and rerun their qualification.

- [ ] Record failed acceptance with run/attempt/job IDs and a responsible branch owner; do not mark an unmet budget as done.

## AI Flaky tests
- [ ] Deterministic checks are blocking. Any retained live-provider exception needs non-systematic same-commit/same-command success, failure signature, impact analysis, and explicit owner sign-off; never increase timeouts.

## Orchestration Mode (AI-selected)
- [ ] **Multi-branch** — This is one independently reviewed/qualified branch of the serialized nine-branch train.
- [ ] Rationale: preserve branch-level rollback and serialize shared workflow/Makefile edits; internal CI lanes may run concurrently.

## UAT Management (in orchestration context)
- [ ] Run the lot UAT on the exact pushed qualification SHA; record immutable source/target SHAs for any integrated qualification workspace.
- [ ] Use isolated automated environments; web/Chrome/VSCode UAT below is limited to affected behavior; no root-dev automated testing.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline and constraints**
  - [ ] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`, relevant security/domain rules, `README.md`, `TODO.md`, the execution `PLAN.md`, the study, and `plan/BRANCH_TEMPLATE.md`.
  - [ ] Verify branch mechanically with harness; confirm prerequisite receipts and conductor registration/import before implementation; inventory the actual files and existing assertions at the new base.
  - [ ] Capture a real baseline with run/attempt/job IDs, source SHA, workflow SHA, cache state, runner class, spans, selected endpoints, and executed test identities.
  - [ ] Declare exceptions above; names marked new below are deliverables to create, not existing commands or evidence.
- [ ] **Lot 1 — Immutable prepared closures**
  - [ ] Create `prepare-check-workspace.mjs` (new): pin Node/npm/tool versions, resolve complete lock/source inputs, topologically build required siblings once, and issue immutable closure receipts.
  - [ ] Create `prepare-check-workspace.test.mjs` (new): cold cache, source/lock/toolchain invalidation, missing sibling, parallel consumers, and stale receipt rejection; isolate mutable output directories.
  - [ ] Lot gate: new `make test-ci-preparation ENV=test-ci-native-checks`; compare cold and warm preparation spans and complete dependency closures.
- [ ] **Lot 2 — Native check dispatch**
  - [ ] Create `native-checks.mjs` and `native-checks.test.mjs` (new): API/IdP/IdP-web typechecks and build, API lint, UI Svelte check/lint, and the four named package checks; do not split the TypeScript program into arbitrary file subsets.
  - [ ] Replace repeated `prepare-node-workspace` / `install-idp-web` calls in the named CI paths; independent check processes get distinct outputs, and shared artifacts remain read-only.
  - [ ] Lot gate: new `make test-ci-native-checks ci-static-api ci-static-ui ci-static-idp ENV=test-ci-native-checks`; compare file/program/lint-rule coverage and diagnostics against the existing targets.
  - [ ] Preserve the named package unit/DOM/integration/API-extract/pack checks; native preparation must not bypass them or change their membership.
- [ ] **Lot 3 — UAT and measured acceptance**
  - [ ] Review real cold/warm logs for hidden development-stack startup and compare compiler/linter coverage; no web/extension behavior changes.
  - [ ] Budget to measure on real runs, cold installation included: complete API static ≤120s, UI ≤90s, IdP/web ≤90s, versus source examples 425s/144s; count preparation, sibling builds, and transfer.
  - [ ] Preserve missing durations as **to measure**; publish all failures, cancellations, retries, queue time, runner-minutes, and threshold breaches alongside successes.
  - [ ] Rollback drill: restore the previous static recipes, remove the replaced native path, and rerun identical coverage checks while retaining BR-76 timing and result completeness.
- [ ] **Lot 4 — Docs consolidation**
  - [ ] Update this plan and the study with measured receipts and remaining gaps; consolidate any temporary EVOL notes before final checks; delete temporary spec scaffolding.
- [ ] **Lot 5 — Final validation**
  - [ ] Repeat the exact changed-file tests and lot commands above on the final SHA; compare expected/executed membership and retain the complete CI/security verdict.
  - [ ] Apply required package version bumps and lock refresh if package source changes; qualify exact candidate bytes; no source-change bump is waived.
  - [ ] Run `make scope-check ENV=test-ci-native-checks` before each commit; end isolated service lots with `make down ENV=test-ci-native-checks` and `make down ENV=e2e-ci-native-checks`.
  - [ ] Create/update the PR using `BRANCH.md`; obtain review and green CI/UAT on the same head; only then hand off to the authorized merge operator for branch-plan removal and merge.
