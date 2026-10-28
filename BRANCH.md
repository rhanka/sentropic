# Feature: BR-79 — Run independent CI work together

## Objective
- [ ] Start each runtime consumer at artifact readiness while preserving every quality and security release requirement.
- [ ] Branch `perf/ci-parallel-dag`, step 4 of nine; train order BR-79 → BR-80; dependencies: BR-78 artifacts merged; BR-76 expected results and BR-77 preparation.

## Scope / Guardrails
- [ ] Follow `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md`; all timings below are **budget to measure**, not delivered results.
- [x] Work only in `tmp/worktrees/ci-parallel-dag`; base `origin/main` c8ec01237; merge main only, never rebase; owner packet supersedes the historical plan wording.
- [x] Make entry points only; `ENV=test-ci-br79` last (owner override); local Docker under the shared flock with `make down` after; no secrets in evidence.
- [ ] Slot 0 owner: branch author; API_PORT=9395, UI_PORT=5595, MAILDEV_UI_PORT=1495; verify availability before starting services and pass all three ports to service commands.
- [ ] No migrations; keep root dev stable; no timeout inflation, removed assertions, or attribution trailers; commits ≤150 changed lines through `make commit` with scope checks.

## Branch Scope Boundaries (MANDATORY)
- [ ] **Allowed Paths (implementation scope)**:
  - [ ] `BRANCH.md`; `plan/65-BRANCH_perf-ci-parallel-dag.md`; `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md`.
  - [ ] `scripts/ci/ci-dag.mjs`
  - [ ] `scripts/ci/ci-dag.test.mjs`
  - [ ] `scripts/ci/ci-expected-results.mjs`
  - [ ] `scripts/ci/ci-expected-results.test.mjs`
  - [ ] `scripts/security/security-parser-test.sh`
- [ ] **Forbidden Paths (must not change in this branch)**:
  - [ ] `docker-compose*.yml`; `.cursor/rules/**`; `api/drizzle/*.sql`.
  - [ ] `plan/NN-BRANCH_*.md` except this branch file; `PLAN.md`; `.track/**`; production deployment configuration.
- [ ] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [ ] `.github/workflows/ci.yml` under BR79-EX1; `Makefile` under BR79-EX2.

- [ ] **Exception process**: apply only the declared purpose; record reason, impact, and rollback before changing a conditional path; any additional path needs its own bounded exception.

## Feedback Loop
- [x] BR79-EX1 — Planned workflow exception: split `build-ui` children and scans, remove non-runtime prerequisites from `test-e2e`, `e2e-vscode`, `smoke-idp-screens`, and `test-smoke-restore`; keep the complete final join. Impact: selected CI/CD dispatch and required results. Rollback: revert this branch's workflow changes while preserving complete-result checks.
- [x] BR79-EX2 — Planned Makefile exception: expose independent extension, desktop, UI test/profile, scanner, and runtime startup targets; preserve build-input ordering. Impact: named CI entry points only. Rollback: restore the previous recipes and rerun their qualification.
- [x] Owner author identity: codex / gpt-6.1-sol / high; no Python, no AI trailers, commits <=150 changed lines. BR-78 Lots 3/5 and unmet 255s UI readiness remain open.

- [ ] Record failed acceptance with run/attempt/job IDs and a responsible branch owner; do not mark an unmet budget as done.
- [x] Source-level repro rejects the API-only publisher's implicit success guard after UI-job separation. Publishers now handle only legitimately unselected UI/IaC skips explicitly and require every selected quality/security/runtime result to succeed. The exhaustive main-selection fixture covers API-only/UI-only/global and each failed/cancelled/skipped selected parent; locked execution remains pending.
- [x] Extended local pass: 6 DAG / 24 expected-result / 134 publication tests, all report-parser negatives, capacity shape, version filters and the 56-spec E2E inventory pass. Capacity reports 64 PR / 63 main ready slots against a 17-slot observed lower bound; admission/timing acceptance remains unqualified.
- [ ] Main baseline job validate-comments 122989014482 fails packaging at 18:02:00Z with npm ECONNRESET after 102 tests pass. Its log and raw job/step receipts are retained; this run cannot supply a successful baseline verdict. Owner: CI train author; compare complete spans without treating this failure as a pass.
- [x] First local locked qualification: `make test-ci-dag test-ci-expected-results test-security-parser API_PORT=9395 UI_PORT=5595 MAILDEV_UI_PORT=1495 ENV=test-ci-br79` passes 6 DAG / 23 expected-result tests and all parser fixtures; repeat after final edits. Isolated cleanup requested under the same lock.
- [ ] Baseline main run 40736913130 attempt 1 at c8ec01237 is still incomplete; raw attempt/job/step receipts are in `.tmp/ci-br79/receipts/40736913130/`. Do not infer a completed verdict or duration.
- [ ] Chrome/VSCode fan-out needs the owner's pending BR79-EX3 decision for `ui/Dockerfile`; current builds still preserve both embedded extension assertions and separate profile endpoints.

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
- [ ] **Lot 1 — Explicit executable dependency graph**
  - [x] Extend native parser negatives across missing, empty and malformed SAST/SCA/container/IaC reports; retain clean and HIGH-finding fixtures.
  - [x] Wire DAG/parser fixtures into mandatory CI; reject incomplete selection contexts and neutral verdicts, including after browser success.
  - [x] Fan API/UI SAST and SCA into four independently blocking matrix members, retaining the original aggregate release barrier and mandatory reports.
  - [x] Replace serial container scans with a selection-aware complete join; failed/missing/skipped selected scans block image publication.
  - [x] Add UI/browser container scan lanes; retain all four images, existing severity/compliance checks and native reports (BR79-EX1).
  - [x] Add independently selected API/toolbox container scans at their producer barriers with mandatory native reports (BR79-EX1).
  - [x] Define artifact dependencies, scan lanes, complete-join checks and negative rollback fixtures; qualification follows workflow wiring.
  - [x] Add `ci-dag.mjs` and `ci-dag.test.mjs` (new): actual artifact dependencies, matrix membership, parallel API/UI/toolbox scan lanes, and a complete expected-result join.
  - [x] Update `ci-expected-results.mjs` and its test: static/SAST failures must still block promotion even if browser work has finished; absent scan reports and unexpected skips fail closed.
  - [ ] Lot gate: new `make test-ci-dag ENV=test-ci-br79` and `make test-ci-expected-results test-security-parser ENV=test-ci-br79`; negative fixtures prove result completeness without triggering a release.
- [ ] **Lot 2 — Independent UI and runtime lanes**
  - [x] Separate desktop, fresh UI tests, runtime image and static profile; both image publishers retain UI test/profile requirements (BR79-EX1/EX2).
  - [x] Remove static/SAST wait edges from browser, VSCode, IdP and restore; preserve static/SAST barriers explicitly at both image publishers (BR79-EX1).
  - [ ] Fan out Chrome extension, VSCode extension, desktop, and UI tests after their prepared inputs; UI image waits for the assets actually embedded in `ui/static`.
  - [ ] Reuse a Vite output only when every profile input matches; retain separate application/static-site builds when API base URLs differ.
  - [ ] Dispatch browser/VSCode/IdP/restore at artifact readiness; keep real IdP native form POST, redirects/codes, restore, and production runtime assertions.
  - [ ] Lot gate: real PR/main runs plus `make check-ci-version-filters check-e2e-inventory ENV=test-ci-br79`; run existing SAST/SCA/container scans and `test-smoke-restore` through their unchanged assertion sets.
  - [ ] Pre-UAT static gate: `make typecheck-api lint-api typecheck-ui lint-ui API_PORT=9395 UI_PORT=5595 MAILDEV_UI_PORT=1495 ENV=test-ci-br79`; independent scheduling must preserve both consumers' compiler/linter verdicts before Lot 3.
- [ ] **Lot 3 — UAT and measured acceptance**
  - [x] Rollback fixture restores serial UI grouping and static/security runtime waits without changing selected membership; an injected failed API scan still blocks the verdict. IaC native report upload is mandatory.
  - [x] Add an identified complete-run readiness receipt; preserve absent spans and expose admission delay and runner-minutes separately from execution.
  - [ ] Inspect served login/consent and web/Chrome/VSCode/desktop packaging on the qualification SHA; verify the embedded files and profile-specific endpoints match the intended consumer.
  - [ ] Budget to measure: security scan branch ≤90s versus the PR example of 199s; IdP ≤150s; start runtime jobs as soon as their artifact inputs are ready, and preserve BR-76 cumulative scheduling ≤60s. Publish readiness and actual start times.
  - [ ] Preserve missing durations as **to measure**; publish all failures, cancellations, retries, queue time, runner-minutes, and threshold breaches alongside successes.
  - [ ] Rollback drill: restore previous dependency edges and build grouping while retaining exact result membership; prove a negative scan still prevents promotion.
- [ ] **Lot 4 — Docs consolidation**
  - [x] Record current architecture, local checks and identified incomplete/failed runs in plan/65 and study section 12; final measurements remain pending.
  - [ ] Update this plan and the study with measured receipts and remaining gaps; consolidate any temporary EVOL notes before final checks; delete temporary spec scaffolding.
- [ ] **Lot 5 — Final validation**
  - [ ] Repeat the exact changed-file tests and lot commands above on the final SHA; compare expected/executed membership and retain the complete CI/security verdict.
  - [ ] Static: `make typecheck-api lint-api typecheck-ui lint-ui API_PORT=9395 UI_PORT=5595 MAILDEV_UI_PORT=1495 ENV=test-ci-br79`; `make test-ci-dag test-ci-expected-results test-security-parser ENV=test-ci-br79` must still reject failed or missing static/security results.
  - [ ] Build: `make build-api build-ui-image API_PORT=9395 UI_PORT=5595 MAILDEV_UI_PORT=1495 ENV=test-ci-br79`; verify separate Chrome/VSCode/desktop outputs and that UI image assembly waits for every embedded prerequisite.
  - [ ] API regression: `make test-api API_PORT=9395 UI_PORT=5595 MAILDEV_UI_PORT=1495 ENV=test-ci-br79`; preserve production runtime/limits and restore membership when dispatch edges change.
  - [ ] UI regression: `make test-ui API_PORT=9395 UI_PORT=5595 MAILDEV_UI_PORT=1495 ENV=test-ci-br79`; retain independent unit/DOM and profile-build results in the required verdict.
  - [ ] E2E regression: `make clean test-e2e API_PORT=9395 UI_PORT=5595 MAILDEV_UI_PORT=1495 ENV=test-ci-br79` and `make test-e2e-vscode E2E_SPEC=tests/vscode/01-vscode-chat-streaming.spec.ts API_PORT=9395 UI_PORT=5595 MAILDEV_UI_PORT=1495 ENV=test-ci-br79`; reconcile exact browser/VSCode/IdP/restore membership and image receipts, then repeat the negative scan that blocks promotion.
  - [ ] Run local service gates sequentially on slot 0, stopping the prior environment before reusing its ports; concurrent CI lanes need separately registered environments and port tuples.
  - [ ] Apply required package version bumps and lock refresh if package source changes; qualify exact candidate bytes; no source-change bump is waived.
  - [ ] Run `make scope-check ENV=test-ci-br79` before each commit; end isolated service lots with `make down ENV=test-ci-br79` and `make down ENV=test-ci-br79`.
  - [ ] Create/update the PR using `BRANCH.md`; obtain review and green CI/UAT on the same head; only then hand off to the authorized merge operator for branch-plan removal and merge.
