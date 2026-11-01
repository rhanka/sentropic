# Feature: BR-81 — Deterministic journeys and daily live providers

## Objective
- [ ] Keep complete application journeys blocking on PR/merge without live provider variability, and preserve live qualification once daily.
- [ ] Branch `test/ci-deterministic-journeys`, step 6 of nine; train order BR-81 → BR-82; dependencies: BR-80 merged for train order; BR-78 image identity and BR-79 scheduling.

## Scope / Guardrails
- [ ] Follow `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md`; all timings below are **budget to measure**, not delivered results.
- [x] Owner packet override: worktree `tmp/worktrees/ci-br81`, branch `test/ci-deterministic-journeys` from `origin/main`; rebase only when updating the base.
- [x] Owner packet override: `ENV=test-ci-br81` last for every Make invocation; Docker only after #869 merges or 18:00 Europe/Paris, under the shared flock, followed by `make down`.
- [ ] Slot 0 owner: branch author; API_PORT=9405, UI_PORT=5605, MAILDEV_UI_PORT=1505; verify availability before starting services and pass all three ports to service commands.
- [ ] No migrations; keep root dev stable; no timeout inflation, removed assertions, or attribution trailers; commits ≤150 changed lines through `make commit` with scope checks.

## Branch Scope Boundaries (MANDATORY)
- [ ] **Allowed Paths (implementation scope)**:
  - [ ] `BRANCH.md`; `plan/67-BRANCH_test-ci-deterministic-journeys.md`; `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md`.
  - [ ] `api/src/services/provider-runtime.ts`
  - [ ] `api/src/services/llm-account-transports.ts`
  - [ ] `api/tests/ai/initiative-generation-async.test.ts`
  - [ ] `api/tests/ai/initiative-generation-sync.test.ts`
  - [ ] `api/tests/ai/executive-summary-sync.test.ts`
  - [ ] `api/tests/ai/executive-summary-auto.test.ts`
  - [ ] `api/tests/ai/company-enrichment-sync.test.ts`
  - [ ] `api/tests/ai/chat-tools.test.ts`
  - [ ] `api/tests/ai/chat-sync.test.ts`
  - [ ] `api/tests/ai/documents-tool.test.ts`
  - [ ] `api/tests/ai/comment-assistant.test.ts`
  - [ ] `api/tests/ai/gw-native-qualification.test.ts`
  - [ ] `e2e/global.setup.ts`
  - [ ] `e2e/playwright.config.ts`
  - [ ] `e2e/tests/05-usecase-detail.spec.ts`
  - [ ] `e2e/tests/07-matrix.spec.ts`
  - [ ] `e2e/tests/06-settings-codex-provider.spec.ts`
  - [ ] `e2e/tests/vscode/01-vscode-chat-streaming.spec.ts`
  - [ ] `e2e/scripts/check-spec-lanes.sh`
  - [ ] `e2e/fixtures/provider-server.mjs`
  - [ ] `e2e/fixtures/provider-server.test.mjs`
  - [ ] `scripts/ci/browser-shards.mjs`
  - [ ] `scripts/ci/browser-shards.test.mjs`
  - [ ] `scripts/ci/live-provider-receipt.mjs`
  - [ ] `scripts/ci/live-provider-receipt.test.mjs`
- [ ] **Forbidden Paths (must not change in this branch)**:
  - [ ] `.cursor/rules/**`; `api/drizzle/*.sql`.
  - [ ] `plan/NN-BRANCH_*.md` except this branch file; `PLAN.md`; `.track/**`; production deployment configuration.
- [ ] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [ ] `.github/workflows/ci.yml` under BR81-EX1; `Makefile` under BR81-EX2.
  - [ ] `.github/workflows/llm-live-daily.yml` under BR81-EX3; `docker-compose.ci-provider.yml` under BR81-EX4 (both new).
- [ ] **Exception process**: apply only the declared purpose; record reason, impact, and rollback before changing a conditional path; any additional path needs its own bounded exception.

## Feedback Loop
- [ ] Track import belongs to the designated conductor; `.track/**` remains forbidden here. Import this branch plan, deliverables and final receipt during the next single-writer sync.
- [x] Local harness is absent from PATH; mechanical checks use the existing repository harness dist through an external Make entry point, without a Docker build.
- [ ] `DOCKER-LOCK.md` was empty at dispatch; acquire both the packet-file flock and the established `/home/antoinefa/.cache-tmp/sentropic-docker.lock` for Docker execution.
- [ ] BR81-EX1 — Planned workflow exception: replace PR/merge AI `continue-on-error` with required deterministic results and adjust API/browser/VSCode matrices. Impact: selected CI/CD dispatch and required results. Rollback: revert this branch's workflow changes while preserving complete-result checks.
- [ ] BR81-EX2 — Planned Makefile exception: change `test-api-*`, `test-e2e`, and `test-e2e-vscode` startup; add fixture, shard-manifest, and live-receipt tests; one Playwright process per shard. Impact: named CI entry points only. Rollback: restore the previous recipes and rerun their qualification.
- [ ] BR81-EX3 — Add daily live workflow for the exact selected tuple; impact: daily calls/cost and schedule monitoring; rollback: restore prior live execution ownership with visible schedule status.
- [ ] BR81-EX4 — Add isolated provider fixture service overlay; impact: test networks only; rollback: remove the overlay and restore prior test startup, with no production endpoint bypass.
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
- [ ] **Lot 1 — Provider-boundary protocol fixtures**
  - [x] Initial offline protocol gate: 8/8 HTTP/SSE, tools, errors/retries, cancellation/reconnection and egress tests pass; application qualification remains pending.
  - [ ] Add the named HTTP/SSE fixture and tests; cover streaming, tool requests/results, malformed output, errors/rate limits, cancellation, reconnection, model routing, and retries; assert outbound request shape and forbid unexpected real egress.
  - [ ] Adapt only the two named runtime composition seams and ten named API AI test files; preserve application HTTP/auth/database/queue/tool behavior. Runtime fixture configuration is test-only and cannot become a production bypass.
  - [ ] Lot gate: new `make test-ci-provider-fixtures ENV=test-ci-deterministic-journeys`; run every changed API AI file through `make test-api-ai` scoped by file on the assigned isolated environment; failures must block.
- [ ] **Lot 2 — Balanced browsers and daily live execution**
  - [ ] Add `browser-shards.mjs` and its test; build explicit file/project manifests using real durations, initially about six balanced shards; every selected test executes exactly once, one setup per shard, retaining real login coverage.
  - [ ] Update the listed browser setup/config/specs and inventory check; replace fixed autosave/provider sleeps with responses, persisted state, or events; preserve the production artifact under test.
  - [ ] Add the daily workflow, `live-provider-receipt.mjs`, and its test; retain the full selected API AI and browser/VSCode provider assertions with exact application/package tuple, schedule health, result, calls, and cost.
  - [ ] Lot gate: new `make test-ci-browser-shards test-ci-live-provider-receipt ENV=test-ci-deterministic-journeys`; `make check-e2e-inventory ENV=test-ci-deterministic-journeys`; all selected browser/VSCode shards and API groups on the assigned ports; one actual scheduled live run plus failure/schedule-health fixtures.
  - [ ] Pre-UAT static gate: `make typecheck-api API_PORT=9405 UI_PORT=5605 MAILDEV_UI_PORT=1505 ENV=test-ci-deterministic-journeys` and `make lint-api API_PORT=9405 UI_PORT=5605 MAILDEV_UI_PORT=1505 ENV=test-ci-deterministic-journeys` must pass before Lot 3 because both named API runtime seams change.
- [ ] **Lot 3 — UAT and measured acceptance**
  - [ ] Exercise web streaming/tools/persistence/cancellation and VSCode streaming on tested production images; prove fixture traffic stays local while a separate daily receipt records real provider calls.
  - [ ] Budget to measure: every complete browser/API shard ≤180s, VSCode ≤150s; compare browser maximum 255s from the source sample. PR/merge unexpected live calls = 0; missing daily data stays to measure, and live failures remain visible.
  - [ ] Preserve missing durations as **to measure**; publish all failures, cancellations, retries, queue time, runner-minutes, and threshold breaches alongside successes.
  - [ ] Rollback drill: restore prior test dispatch/transport wiring with visible provider status; keep application assertions and required deterministic checks; do not silently treat failed live or deterministic journeys as success.
- [ ] **Lot 4 — Docs consolidation**
  - [ ] Update this plan and the study with measured receipts and remaining gaps; consolidate any temporary EVOL notes before final checks; delete temporary spec scaffolding.
- [ ] **Lot 5 — Final validation**
  - [ ] Repeat the exact changed-file tests and lot commands above on the final SHA; compare expected/executed membership and retain the complete CI/security verdict.
  - [ ] Static: `make typecheck-api lint-api API_PORT=9405 UI_PORT=5605 MAILDEV_UI_PORT=1505 ENV=test-ci-deterministic-journeys`; UI source typecheck/lint is not applicable because no UI source is edited; retain fixture/shard/live-receipt checks from Lots 1–2.
  - [ ] Build: `make build-api build-ui-image API_PORT=9405 UI_PORT=5605 MAILDEV_UI_PORT=1505 ENV=e2e-ci-deterministic-journeys` with the selected provider-fixture overlay; record production-image digests and prove fixture configuration cannot enable a production endpoint bypass.
  - [ ] API regression: `make test-api API_PORT=9405 UI_PORT=5605 MAILDEV_UI_PORT=1505 ENV=test-ci-deterministic-journeys`; run every selected group and all ten named AI files against local HTTP/SSE fixtures, with no live credentials or allowed deterministic failure.
  - [ ] UI regression: `make test-ui API_PORT=9405 UI_PORT=5605 MAILDEV_UI_PORT=1505 ENV=test-ci-deterministic-journeys`; preserve the complete existing UI unit/DOM suite despite unchanged UI source.
  - [ ] E2E regression: `make clean test-e2e API_PORT=9405 UI_PORT=5605 MAILDEV_UI_PORT=1505 ENV=e2e-ci-deterministic-journeys` and `make test-e2e-vscode E2E_SPEC=tests/vscode/01-vscode-chat-streaming.spec.ts API_PORT=9405 UI_PORT=5605 MAILDEV_UI_PORT=1505 ENV=e2e-ci-deterministic-journeys`; execute every generated file/project shard exactly once, reconcile expected/executed membership, retain real login, and verify the tested production-image tuple.
  - [ ] Daily live regression: retain one actual scheduled run plus failure/schedule-health fixtures for the exact application/package tuple; provider assertions, calls, cost, and failures remain visible separately from blocking deterministic PR/merge results.
  - [ ] Run local service gates sequentially on slot 0, stopping the prior environment before reusing its ports; concurrent CI lanes need separately registered environments and port tuples.
  - [ ] Apply required package version bumps and lock refresh if package source changes; qualify exact candidate bytes; no source-change bump is waived.
  - [ ] Run `make scope-check ENV=test-ci-deterministic-journeys` before each commit; end isolated service lots with `make down ENV=test-ci-deterministic-journeys` and `make down ENV=e2e-ci-deterministic-journeys`.
  - [ ] Create/update the PR using `BRANCH.md`; obtain review and green CI/UAT on the same head; only then hand off to the authorized merge operator for branch-plan removal and merge.
