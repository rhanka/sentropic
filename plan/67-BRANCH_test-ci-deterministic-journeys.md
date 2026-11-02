# Feature: BR-81 — Deterministic journeys and daily live providers

## Objective
- [ ] Keep complete application journeys blocking on PR/merge without live provider variability, and preserve live qualification once daily.
- [ ] Branch `test/ci-deterministic-journeys`, step 6 of nine; train order BR-81 → BR-82; dependencies: BR-80 merged for train order; BR-78 image identity and BR-79 scheduling.

## Scope / Guardrails
- [x] Follow `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md`; all timings below are **budget to measure**, not delivered results.
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
  - [ ] `scripts/ci/dev-image-pin.test.mjs`
- [ ] **Forbidden Paths (must not change in this branch)**:
  - [ ] `.cursor/rules/**`; `api/drizzle/*.sql`.
  - [ ] `plan/NN-BRANCH_*.md` except this branch file; `PLAN.md`; `.track/**`; production deployment configuration.
- [ ] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [ ] `.github/workflows/ci.yml` under BR81-EX1; `Makefile` under BR81-EX2.
  - [ ] `.github/workflows/llm-live-daily.yml` under BR81-EX3; `docker-compose.ci-provider.yml` under BR81-EX4 (both new).
  - [ ] `docker-compose.dev.yml` under BR81-EX5 (one `api` image line).
- [ ] **Exception process**: apply only the declared purpose; record reason, impact, and rollback before changing a conditional path; any additional path needs its own bounded exception.

## Feedback Loop
- [x] Resume review A2 query repro confirmed silent URL rewriting. Unsupported provider query parameters now fail visibly before forwarding, with only hostname/reason in the journal; query-less application protocols remain unchanged.
- [x] Resume review A2: a local probe confirmed four credential headers reached the fixture. Strip all supported provider credential headers while preserving local application cookies; regression passes. Cancellation during the final SSE delay did not reproduce A1 (fixture stays healthy, no response error, one cancellation).
- [ ] Track import belongs to the designated conductor; `.track/**` remains forbidden here. Import this branch plan, deliverables and final receipt during the next single-writer sync.
- [x] Local harness is absent from PATH; mechanical checks use the existing repository harness dist through an external Make entry point, without a Docker build.
- [x] The current owner rule supersedes historical multi-lock notes: acquire only `/home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md`, wait without expiration, and keep the lock through service validation and cleanup.
- [x] Resume 2026-11-02: clean pushed source `0eac30fda` preserved as `backup/br81-resume-0eac30fda`; rebase onto current main after merge-tree identified only `BRANCH.md` as conflicting. All 36 commits retained at `1bfdade27`; mechanical harness branch/full-diff scope and offline fixture/shard/live-receipt/YAML/CI-wiring checks pass. Docker qualification is queued; no PR CI has been dispatched.
- [x] BR81-EX1 — Declared workflow exception: replace PR/merge AI `continue-on-error` with required deterministic results and adjust API/browser/VSCode matrices. Impact: selected CI/CD dispatch and required results. Rollback: revert this branch's workflow changes while preserving complete-result checks.
- [x] BR81-EX2 — Declared Makefile exception: change `test-api-*`, `test-e2e`, and `test-e2e-vscode` startup; add fixture, shard-manifest, and live-receipt tests; one Playwright process per shard. Impact: named CI entry points only. Rollback: restore the previous recipes and rerun their qualification.
- [x] BR81-EX3 — Declared daily workflow exception for the exact selected tuple; impact: daily calls/cost and schedule monitoring; rollback: restore prior live execution ownership with visible schedule status.
- [x] BR81-EX4 — Declared isolated provider fixture service overlay; impact: test networks only; rollback: remove the overlay and restore prior test startup, with no production endpoint bypass.
- [x] BR81-EX5 — Declared dev-overlay image exception: `docker-compose.dev.yml` `api` pins the development tag verbatim (base fallback minus `API_IMAGE_REF`); base and CI overlays keep the pin for SUT lanes. Reason: the canonical-artifact pin (merged to main after this plan) redirects every dev-stack `build`/`run`/`up` at the npm-less production digest once a receipt exists. Impact: dev/test stacks only; SUT/production resolution unchanged. Rollback: delete the added `image:` line. Regression guard: `scripts/ci/dev-image-pin.test.mjs` wired into the CI deterministic gate.
- [ ] Record failed acceptance with run/attempt/job IDs and a responsible branch owner; do not mark an unmet budget as done.
- [x] 2026-11-01 Lot 5 rerun 1 FAILED at `make test-api` (rc=2, 617s): `sh: npm: not found` in `prepare-node-workspace` — production pin leaked into dev-stack resolution. Rerun 2 FAILED at `make typecheck-api` (rc=2, 466s) at the typecheck `run` line, proving every dev-stack resolution needs the overlay fix, not per-recipe overrides (attempted in `755d28b8f`, reverted). Final fix under BR81-EX5; local Lot 5 order runs API/UI regression before `build-api` so E2E keeps the exact production tuple.
- [x] Offline receipt checks reject unpublished main tuples and paginate all job/artifact rows; application qualification is pending.
- [x] Daily preparation reuses published images only after the existing source/tree/workflow/profile/run/image validator accepts them. Retain two small identity receipts for 30 days; preserve transport archive deletion and one-day expiry.
- [ ] `attention`, owner: BR-81 author and CI-train conductor; `gw-native-qualification.test.ts` requires operator UAT evidence, two authorized sessions and an active metered partition. None is available locally. Owner clarification is pending; do not fabricate readiness, drop the suite or treat it as qualified.
- [x] Code review disposition: selected Mistral/OpenAI chat-completion and Tavily protocols are implemented; other remote hosts fail closed. Any failed attempt remains fatal in deterministic browser reconciliation. Generated receipts contain no credentials and are kept out of selective staging.
- [x] Protocol review cycle 2 correction: abort before Playwright if shard-file generation fails or returns no files; allow the local `auth-idp` service without admitting external egress. Docker proof is pending.
- [x] Daily main selection searches workflow pages lazily until a complete published tuple with retained identities is found; API and artifact errors still fail qualification. Schedule monitoring examines the latest 100 scheduled runs, which cover more than its 26-hour freshness window at the declared 25-per-day cadence.
- [x] Browser membership snapshots are emitted by the execution process before hooks run; remove the separate Playwright list process while retaining runtime-skip rejection and expected/actual receipts.
- [x] AI/VSCode fixture receipts require actual provider-boundary requests; non-provider browser shards retain their complete journeys. Live qualification requires at least one successful provider response and preserves expected cancellations separately. VSCode uploads its isolation receipt.

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
  - [x] Offline protocol gate: 15/15 HTTP/SSE, tools, errors/retries, cancellation/reconnection, egress, vision, document and PPTX request-shape tests pass; application qualification remains pending.
  - [ ] Add the named HTTP/SSE fixture and tests; cover streaming, tool requests/results, malformed output, errors/rate limits, cancellation, reconnection, model routing, and retries; assert outbound request shape and forbid unexpected real egress.
  - [ ] Adapt only the two named runtime composition seams and ten named API AI test files; preserve application HTTP/auth/database/queue/tool behavior. Runtime fixture configuration is test-only and cannot become a production bypass.
  - [ ] Lot gate: new `make test-ci-provider-fixtures ENV=test-ci-br81`; run every changed API AI file through `make test-api-ai` scoped by file on the assigned isolated environment; failures must block.
- [ ] **Lot 2 — Balanced browsers and daily live execution**
  - [ ] Add `browser-shards.mjs` and its test; build explicit file/project manifests using real durations, initially about six balanced shards; every selected test executes exactly once, one setup per shard, retaining real login coverage.
  - [ ] Update the listed browser setup/config/specs and inventory check; replace fixed autosave/provider sleeps with responses, persisted state, or events; preserve the production artifact under test.
  - [ ] Add the daily workflow, `live-provider-receipt.mjs`, and its test; retain the full selected API AI and browser/VSCode provider assertions with exact application/package tuple, schedule health, result, calls, and cost.
  - [ ] Lot gate: new `make test-ci-browser-shards test-ci-live-provider-receipt ENV=test-ci-br81`; `make check-e2e-inventory ENV=test-ci-br81`; all selected browser/VSCode shards and API groups on the assigned ports; one actual scheduled live run plus failure/schedule-health fixtures.
  - [ ] Pre-UAT static gate: `make typecheck-api API_PORT=9405 UI_PORT=5605 MAILDEV_UI_PORT=1505 ENV=test-ci-br81` and `make lint-api API_PORT=9405 UI_PORT=5605 MAILDEV_UI_PORT=1505 ENV=test-ci-br81` must pass before Lot 3 because both named API runtime seams change.
- [ ] **Lot 3 — UAT and measured acceptance**
  - [ ] Exercise web streaming/tools/persistence/cancellation and VSCode streaming on tested production images; prove fixture traffic stays local while a separate daily receipt records real provider calls.
  - [ ] Budget to measure: every complete browser/API shard ≤180s, VSCode ≤150s; compare browser maximum 255s from the source sample. PR/merge unexpected live calls = 0; missing daily data stays to measure, and live failures remain visible.
  - [ ] Preserve missing durations as **to measure**; publish all failures, cancellations, retries, queue time, runner-minutes, and threshold breaches alongside successes.
  - [ ] Rollback drill: restore prior test dispatch/transport wiring with visible provider status; keep application assertions and required deterministic checks; do not silently treat failed live or deterministic journeys as success.
- [ ] **Lot 4 — Docs consolidation**
  - [ ] Update this plan and the study with measured receipts and remaining gaps; consolidate any temporary EVOL notes before final checks; delete temporary spec scaffolding.
- [ ] **Lot 5 — Final validation**
  - [ ] Repeat the exact changed-file tests and lot commands above on the final SHA; compare expected/executed membership and retain the complete CI/security verdict.
  - [ ] Static: `make typecheck-api lint-api API_PORT=9405 UI_PORT=5605 MAILDEV_UI_PORT=1505 ENV=test-ci-br81`; UI source typecheck/lint is not applicable because no UI source is edited; retain fixture/shard/live-receipt checks from Lots 1–2.
  - [ ] Build: `make build-api build-ui-image API_PORT=9405 UI_PORT=5605 MAILDEV_UI_PORT=1505 ENV=test-ci-br81` with the selected provider-fixture overlay; record production-image digests and prove fixture configuration cannot enable a production endpoint bypass.
  - [ ] API regression: `make test-api API_PORT=9405 UI_PORT=5605 MAILDEV_UI_PORT=1505 ENV=test-ci-br81`; run every selected group and all ten named AI files against local HTTP/SSE fixtures, with no live credentials or allowed deterministic failure.
  - [ ] UI regression: `make test-ui API_PORT=9405 UI_PORT=5605 MAILDEV_UI_PORT=1505 ENV=test-ci-br81`; preserve the complete existing UI unit/DOM suite despite unchanged UI source.
  - [ ] E2E regression: `make clean test-e2e API_PORT=9405 UI_PORT=5605 MAILDEV_UI_PORT=1505 ENV=test-ci-br81` and `make test-e2e-vscode E2E_SPEC=tests/vscode/01-vscode-chat-streaming.spec.ts API_PORT=9405 UI_PORT=5605 MAILDEV_UI_PORT=1505 ENV=test-ci-br81`; execute every generated file/project shard exactly once, reconcile expected/executed membership, retain real login, and verify the tested production-image tuple.
  - [ ] Daily live regression: retain one actual scheduled run plus failure/schedule-health fixtures for the exact application/package tuple; provider assertions, calls, cost, and failures remain visible separately from blocking deterministic PR/merge results.
  - [ ] Run local service gates sequentially on slot 0, stopping the prior environment before reusing its ports; concurrent CI lanes need separately registered environments and port tuples.
  - [ ] Apply required package version bumps and lock refresh if package source changes; qualify exact candidate bytes; no source-change bump is waived.
  - [ ] Run `make scope-check ENV=test-ci-br81` before each commit; end isolated service lots with `make down ENV=test-ci-br81` and `make down ENV=test-ci-br81`.
  - [ ] Create/update the PR using `BRANCH.md`; obtain review and green CI/UAT on the same head; only then hand off to the authorized merge operator for branch-plan removal and merge.
