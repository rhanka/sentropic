# Feature: Retire GPT-4.1 nano and qualify both Luna candidates

## Objective
- [ ] Replace every active nano selection through one configurable model default; qualify A `openai/gpt-6-luna` and B `openai/gpt-5.6-luna` before the owner decides, with results by October 19 and production readiness before October 23, 2026.

## Scope / Guardrails
- [x] Implementation packet: `/home/antoinefa/src/sentropic/.tmp/packets/nano-retirement-build.md`; `AGENT_SIG:7f3a9c2e1b`.
- [x] Worktree `tmp/worktrees/openai-nano-retirement`, branch `fix/openai-nano-retirement`, baseline `origin/main` at `5202dd87c`; harness branch check passed; initial worktree clean.
- [x] Test ports: API 9450, UI 5650, Maildev 1550, `ENV=test-model-retirement`; E2E 9451/5651/1551, `ENV=e2e-model-retirement`.
- [x] Make-only, Docker-first, RTK-prefixed commands; ENV last; one Docker build at a time; never test on dev.
- [x] Live qualification: synthetic fixtures only, concurrency one, exact model/API identity, explicit reasoning none, bounded output, no paid hosted tools, no retry or route substitution; hard cumulative budget USD 15, reserve before every upstream attempt.
- [x] Atomic Conventional Commits of at most 150 changed lines, selective staging, `make scope-check` before every `make commit`; push and DRAFT PR with CI.
- [x] Never merge, publish, deploy, rewrite historical usage/model provenance, or change CI seat policy; A is a reversible branch default awaiting the owner's measured decision.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/config/models.ts`
  - `api/src/config/env.ts`
  - `api/src/services/model-selection-legacy.ts`
  - `api/src/services/model-catalog.ts`
  - `api/src/services/settings.ts`
  - `api/src/services/llm-runtime/**`
  - `api/src/services/chat-service.ts`
  - `api/src/services/tool-service.ts`
  - `api/src/services/tools.ts`
  - `api/src/services/business/organizations.ts`
  - `api/src/services/context-organization.ts`
  - `api/src/services/context-document.ts`
  - `api/src/db/schema.ts`
  - `api/tests/**`
  - `ui/src/lib/components/chat/AppChatPanel.svelte`
  - `ui/src/lib/stores/initiatives.ts`
  - `ui/src/routes/settings/+page.svelte`
  - `ui/src/routes/folder/new/+page.svelte`
  - `ui/tests/**`
  - `packages/chat-ui/src/state/chatLoopController.ts`
  - `packages/chat-ui/package.json`
  - `packages/chat-ui/export-manifest.json`
  - `packages/chat-ui/tests/**`
  - `packages/llm-mesh/src/catalog.ts`
  - `packages/llm-mesh/src/providers.ts`
  - `packages/llm-mesh/src/generated-model-council.ts`
  - `packages/llm-mesh/package.json`
  - `packages/llm-mesh/tests/**`
  - `scripts/llm-model-equivalences/council.source.json`
  - `package-lock.json`
  - `api/package-lock.json`
  - `spec/SPEC_RUNBOOK_LLM_MODEL_UPDATE.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `.track/**`
  - `plan/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (no migration planned).
- **Exception process**:
  - [x] Declare `BRNANO-EXn` in Feedback Loop with reason, impact, and rollback before extending scope.

## Feedback Loop
- [x] Root Track writer is not assigned to this worktree: maintain this mergeable branch artifact; do not append `.track` events concurrently.
- [x] Packet's `.cursor/rules/*.mdc` sources resolve to canonical `rules/*.md`; source studies and model-update runbook read.
- [x] Four helper-contract failures reproduced before changes: title/effort candidates, non-OpenAI compaction, and tool-follow-up bounds; two independent source reviews reconciled these issues.
- [x] Helper/wire correction gate: 31 tests passed across nano helper/wire, chat summary, document analysis and history analysis suites.
- [x] Client default regression reproduced before fix; registry prechecks: llm-mesh 0.26.1, chat-ui 0.34.1; chat-ui candidate bumped to 0.34.2.
- [x] BRNANO-EX1: include chat-ui export-manifest metadata and its existing version assertions to synchronize the required package bump; metadata-only impact, rollback together with the bump.
- [x] Selectable-retired-model assertion reproduced before catalog removal; mesh candidate bumped to 0.26.2 after npm registry precheck.
- [x] Full llm-mesh regression gate passed: 42 files, 808 tests; client package gate passed after the server-default and version-contract updates.
- [x] Full API unit run exposed 26 changed assumptions: domain-tool/prompt fixtures need independent classification stubs with A, and retired stream fixtures need migration; preserve the Gemini evaluator test.

## AI Flaky tests
- [ ] Record every provider failure verbatim after secret sanitization; failed qualification remains failed, without rerunning for a pass or inflating timeouts.
- [ ] Any accepted AI flake requires an existing same-command/same-commit success and explicit owner sign-off before a future merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch**: sequential implementation and builds; independent read-only peer reviews; no cherry-pick.
- [ ] **Multi-branch** (not required for this single retirement objective).

## UAT Management (in orchestration context)
- [x] Use captured bounded campaign outputs for inspection; no unbudgeted inference or dev-environment tests.
- [ ] Record qualification SHA and installed mesh version with the result artifacts.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read rules, workflow, studies, template and relevant source; run harness branch check and `make ps-all`.
  - [x] Check all allocated ports before services start; privately provision the existing credential mechanism.
- [ ] **Lot 1 — Regression tests first and configurable cutover**
  - [x] Update `api/tests/unit/model-selection-legacy.test.ts`; add `api/tests/unit/nano-replacement-contract.test.ts` for aliases, dated snapshot, whitespace/case, provider repair and synchronous none/output cap; context-budget coverage follows with helper contracts.
  - [x] Observe failures with `make test-api-unit SCOPE="tests/unit/model-selection-legacy.test.ts tests/unit/nano-replacement-contract.test.ts" API_PORT=9450 UI_PORT=5650 MAILDEV_UI_PORT=1550 ENV=test-model-retirement`: six expected failures, twelve passes; nano cutovers and synchronous none/caps are missing.
  - [x] Implement one configuration point, defaults and helper selection; preserve unrelated legacy mappings and explicit user reasoning; fix provider pairing, follow-up caps and in-memory compaction continuation.
  - [ ] Update `api/tests/unit/llm-runtime-stream.test.ts`, `chat-summary-runtime.test.ts`, `provider-mesh-contract-proof.test.ts` and `llm-metering-usage-normalizer.test.ts` only where behavior changes.
- [ ] **Lot 2 — Retire selectable/default references and preserve large-context paths**
  - [x] Remove retired catalog/provider entries, regenerate council, update frontend loading defaults and affected seeds/fixtures; bump touched public packages after registry precheck and regenerate locks through Make.
  - [ ] Run `make test-llm-mesh SCOPE=tests/facade.test.ts ENV=test-model-retirement`, then scoped `execution-features.test.ts` and `responses-wire.test.ts`; run `make test-chat-ui ENV=test-model-retirement`.
  - [ ] Verify history/document single, chunk and merge output caps, retained facts, maximum input and cancellation with deterministic contracts.
  - [x] Six budget-refusal failures reproduced offline before adding full-rendered-request admission and finite output validation; document summaries now share the configured model and explicit none.
- [ ] **Lot 3 — Bounded paired live qualification**
  - [x] Budget contract tests written before implementation: exact-SCOPE opt-in, shared dollar/call limits, worst-input reservation, missing-usage/cancellation closure and long-tier pricing.
  - [x] Physical-fetch contracts written before implementation: exact endpoint/model/none/cap/Standard tier, no hosted paid tools or redirects, durable reservation before any send; API typecheck and lint pass.
  - [x] Evidence contracts written first: an exclusive, fsynced journal prevents a rerun from resetting spending; capture raw Chat Completions and Responses counters before mesh normalization.
  - [ ] Add `api/tests/ai/nano-replacement-qualification.test.ts` and shared fixture/budget support; offline-test reservation, missing usage, cancellation and refusal before budget overflow.
  - [ ] Exercise BOTH candidates on identical title, effort, compaction, JSON/tool continuation and history/document single/chunk fixtures through product helpers and llm-mesh; retain outputs and usage evidence.
  - [ ] Run `make test-api-ai SCOPE=tests/ai/nano-replacement-qualification.test.ts API_TEST_ARGS="--no-file-parallelism" API_PORT=9450 UI_PORT=5650 MAILDEV_UI_PORT=1550 ENV=test-model-retirement`; record validity, fact retention, latency p50/p95, input/output/reasoning tokens and measured costs per class, with sample sizes.
- [ ] **Lot 4 — UAT and documentation consolidation**
  - [ ] Web: load saved nano choice, inspect replacement provider/model, generate/reload title, inspect persisted compact summary and retained facts, tool/JSON result, history/document single/chunk/merge usage.
  - [ ] Chrome/VSCode: verify shared catalog selection and captured tool-continuation behavior; report any unavailable live surface explicitly.
  - [ ] Write tables-first `.tmp/model-retirement/qualification-results.md` and French `.tmp/model-retirement/dossier-remplacement-nano.html` with exact matching title/H1, verbatim owner quote, measured evidence and one decision question.
- [ ] **Lot 5 — Final validation and draft handoff**
  - [ ] Typecheck/lint impacted API/UI/packages; final `make test-api` and `make test-ui` with test ports/ENV; investigate every failure.
  - [ ] Build API then UI images sequentially; `make clean test-e2e API_PORT=9451 UI_PORT=5651 MAILDEV_UI_PORT=1551 ENV=e2e-model-retirement`; use existing E2E files without new UI scenarios.
  - [ ] Run two independent reviews, reconcile findings and inspect every final diff hunk; verify no active retired selection remains.
  - [ ] Check logs, update evidence and checkboxes, stop isolated services with `make down`.
  - [ ] Push `fix/openai-nano-retirement`, create DRAFT PR using this file as body, add the required execution-plan comment, monitor CI and resolve failures.
  - [ ] Leave BRANCH.md and PR in draft; never merge, publish or deploy.
