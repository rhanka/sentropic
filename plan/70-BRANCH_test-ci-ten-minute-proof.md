# Feature: BR-84 — Prove ten-minute delivery and publish the evidence

## Objective
- [ ] Qualify the complete nine-step train on real executions and present source-linked outcomes in the validated single-diagram format.
- [ ] Branch `test/ci-ten-minute-proof`, step 9 of nine; train order BR-84 → train completion; dependencies: BR-76 through BR-83 merged and their acceptance receipts available.

## Scope / Guardrails
- [ ] Follow `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md`; all timings below are **budget to measure**, not delivered results.
- [ ] Work only in `tmp/worktrees/ci-ten-minute-proof`; rebase on main after predecessor merge; one implementation branch active on the shared workflow/Makefile.
- [ ] Make entry points only; `ENV` last; tests on `ENV=test-ci-ten-minute-proof` or `ENV=e2e-ci-ten-minute-proof`, never `dev`; no secrets in evidence.
- [ ] Slot 0 owner: branch author; API_PORT=9420, UI_PORT=5620, MAILDEV_UI_PORT=1520; verify availability before starting services and pass all three ports to service commands.
- [ ] No migrations; keep root dev stable; no timeout inflation, removed assertions, or attribution trailers; commits ≤150 changed lines through `make commit` with scope checks.

## Branch Scope Boundaries (MANDATORY)
- [ ] **Allowed Paths (implementation scope)**:
  - [ ] `BRANCH.md`; `plan/70-BRANCH_test-ci-ten-minute-proof.md`; `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md`.
  - [ ] `scripts/ci/ci-run-metrics.mjs`
  - [ ] `scripts/ci/ci-run-metrics.test.mjs`
  - [ ] `scripts/ci/ci-performance-report.mjs`
  - [ ] `scripts/ci/ci-performance-report.test.mjs`
  - [ ] `spec/ci-cd-ten-minutes/runs.json`
  - [ ] `spec/ci-cd-ten-minutes/acceptance.md`
  - [ ] `spec/ci-cd-ten-minutes/dossier/package.json`
  - [ ] `spec/ci-cd-ten-minutes/dossier/package-lock.json`
  - [ ] `spec/ci-cd-ten-minutes/dossier/vite.config.ts`
  - [ ] `spec/ci-cd-ten-minutes/dossier/index.html`
  - [ ] `spec/ci-cd-ten-minutes/dossier/src/main.ts`
  - [ ] `spec/ci-cd-ten-minutes/dossier/src/App.svelte`
  - [ ] `spec/ci-cd-ten-minutes/dossier/src/ArchitectureCanvas.svelte`
  - [ ] `spec/ci-cd-ten-minutes/dossier/src/ContractDossier.svelte`
  - [ ] `spec/ci-cd-ten-minutes/dossier/src/style.css`
  - [ ] `spec/ci-cd-ten-minutes/dossier/scripts/contract-evidence.mjs`
  - [ ] `spec/ci-cd-ten-minutes/dossier/scripts/contract-diagrams.mjs`
  - [ ] `spec/ci-cd-ten-minutes/dossier/scripts/contract-narrative.mjs`
  - [ ] `spec/ci-cd-ten-minutes/dossier/scripts/contract-v2.mjs`
  - [ ] `spec/ci-cd-ten-minutes/dossier/scripts/build-portable.mjs`
  - [ ] `spec/ci-cd-ten-minutes/dossier/tests/controls.spec.ts`
  - [ ] `spec/ci-cd-ten-minutes/dossier/tests/path-calculation.test.mjs`
- [ ] **Forbidden Paths (must not change in this branch)**:
  - [ ] `docker-compose*.yml`; `.cursor/rules/**`; `api/drizzle/*.sql`.
  - [ ] `plan/NN-BRANCH_*.md` except this branch file; `PLAN.md`; `.track/**`; production deployment configuration.
- [ ] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [ ] `.github/workflows/ci.yml` under BR84-EX1; `Makefile` under BR84-EX2.

- [ ] **Exception process**: apply only the declared purpose; record reason, impact, and rollback before changing a conditional path; any additional path needs its own bounded exception.

## Feedback Loop
- [ ] BR84-EX1 — Planned workflow exception: finalize `changes`, `ci-gate`, and `deploy-preprod` evidence publication and performance acceptance without substituting timeout for success. Impact: selected CI/CD dispatch and required results. Rollback: revert this branch's workflow changes while preserving complete-result checks.
- [ ] BR84-EX2 — Planned Makefile exception: add `test-ci-performance-report`, `ci-performance-report`, `build-ci-dossier`, and `test-ci-dossier`; build/test the portable presentation in pinned isolated tooling. Impact: named CI entry points only. Rollback: restore the previous recipes and rerun their qualification.

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
- [ ] **Lot 1 — Complete real-run acceptance campaign**
  - [ ] Add `ci-performance-report.mjs` and its test; extend the named metrics test for percentiles, maxima, incomplete endpoints, reruns, missing data, finite capacity, and mixed application/package publication dependencies.
  - [ ] Populate `runs.json` and `acceptance.md` (new) with sanitized run/attempt/job URLs, SHAs, workflow versions, exact artifacts/tuples, case/cache/traffic profiles, expected/executed tests, retries, phase spans, costs, and every breach.
  - [ ] Collect at least 30 complete full-product runs across warm/source-miss/lock-miss/full-cold/concurrent-traffic profiles; report per-profile counts. Include API-only, UI-only, mixed, shared asset, tooling/lock, and fresh selected releases; library-only cases supplement this set.
  - [ ] Lot gate: `make test-ci-performance-report ci-performance-report ENV=test-ci-ten-minute-proof`; compare four endpoints directly to GitHub/registry/preproduction evidence; record daily provider results separately.
- [ ] **Lot 2 — One graph driven by the measured model**
  - [ ] Create the named versioned dossier files from the validated portable-dossier design, preserving the existing generator and design-system theme; keep measured data and build inputs versioned, portable HTML as a build artifact.
  - [ ] Use one model for path calculation and rendering; controls for before/after, case, event, and groups stay inside the canvas. Every plan step highlights changed nodes while case/event selection remains usable.
  - [ ] Preserve expandable matrix/job/step detail, internal package train order, selected cache effects, semantic duration heatmap, source links, and explicit budget-to-measure / to-measure labels; each sampled element >60s has an optimization and acceptance link.
  - [ ] Add `controls.spec.ts` and `path-calculation.test.mjs` (new): all case/event/step combinations, keyboard interaction, preserved viewport, incomplete data, shared assets, package-only cold paths, verdict-before-publication, and non-additive isolated gains.
  - [ ] Lot gate: `make build-ci-dossier test-ci-dossier ENV=test-ci-ten-minute-proof`; inspect the exported portable artifact at wide/narrow widths and verify controls are within the graph.
- [ ] **Lot 3 — UAT and measured acceptance**
  - [ ] Open the exported dossier and switch every case/event/before-after combination, expand matrices, select all nine steps, and follow measured sources; product qualification receipts stay tied to their exact SHAs.
  - [ ] Budget to measure: API/CD 555s warm and 585s cold including 60s cumulative scheduling; complete selected endpoints ≤600s for every claimed case. Publish n, median, p90, p95, maximum, runner-minutes, provider cost, and all failures/breaches; mixed fresh trains and new validation lanes must be counted.
  - [ ] Preserve missing durations as **to measure**; publish all failures, cancellations, retries, queue time, runner-minutes, and threshold breaches alongside successes.
  - [ ] Rollback drill: withdraw any unsupported latency claim and restore the last validated presentation/data model; retain all run evidence, classify unmet budgets as open work, and route implementation regressions to the owning branch rollback without hiding failures.
- [ ] **Lot 4 — Docs consolidation**
  - [ ] Update this plan and the study with measured receipts and remaining gaps; consolidate any temporary EVOL notes before final checks; delete temporary spec scaffolding.
- [ ] **Lot 5 — Final validation**
  - [ ] Repeat the exact changed-file tests and lot commands above on the final SHA; compare expected/executed membership and retain the complete CI/security verdict.
  - [ ] Apply required package version bumps and lock refresh if package source changes; qualify exact candidate bytes; no source-change bump is waived.
  - [ ] Run `make scope-check ENV=test-ci-ten-minute-proof` before each commit; end isolated service lots with `make down ENV=test-ci-ten-minute-proof` and `make down ENV=e2e-ci-ten-minute-proof`.
  - [ ] Create/update the PR using `BRANCH.md`; obtain review and green CI/UAT on the same head; only then hand off to the authorized merge operator for branch-plan removal and merge.
