# Feature: llm-mesh Lot 5 Gemini API-key fallback

## Objective
- [ ] Ship Lot 5 plan slice Gemini-only per owner D3: metered static-key Gemini fallback routed last behind subscription accounts with monthly cap and first-use overflow alert

## Scope / Guardrails
- [ ] Scope limited to packages/llm-mesh transport plus routing plus tests and api metering settlement plus tests
- [ ] Zero migration file in api/drizzle (cap and pricing rows are ops-seeded, exact SQL in report)
- [ ] Make-only workflow, Docker only via .tmp/packets/docker-slot.sh in foreground, one slot per command, never nested
- [ ] ENV=test-llm-mesh-lot5 always last, ports API_PORT=8915 UI_PORT=5315 MAILDEV_UI_PORT=1215
- [ ] Never ENV=dev, never make clean-all, no Python, English for code commits docs
- [ ] No OpenAI fallback key (owner D3 cost rejection), Gemini gemini-3.8-flash only
- [ ] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- [ ] Allowed Paths: packages/llm-mesh/src/transport/gemini-apikey-runtime-client.ts, packages/llm-mesh/src/transport/*, packages/llm-mesh/src/execution-features.ts, packages/llm-mesh/src/route-selection.ts, packages/llm-mesh/src/index.ts, packages/llm-mesh/tests/gemini-apikey-runtime-client.test.ts, packages/llm-mesh/tests/route-selection.test.ts, packages/llm-mesh/tests/execution-features.test.ts, api/src/services/llm-metering/route-settlement.ts, api/tests/api/llm-fallback-first-use.test.ts
- [ ] Forbidden Paths: Makefile, docker-compose*.yml, .cursor/rules/**, plan/NN-BRANCH_*.md
- [ ] Conditional Paths: api/drizzle/*.sql (max 1 file, none planned), .github/workflows/** (untouched), packages/llm-mesh/package.json (bump only if src changes per workflow Package Publication), package-lock.json (BRL5-EX1 version string only)
- [ ] Exception process: declare BRxx-EXn in ## Feedback Loop before touching any conditional or forbidden path

## Feedback Loop
- [ ] attention: root-owned vitest cache blocks local api gates: packages/llm-mesh/node_modules/.vite created root by make test-llm-mesh container without -u at 13:19 UTC, npm ci in install-internal-packages fails rmdir EACCES, sudo needs interactive auth so no self-repair, needs owner sudo cleanup of that single cache dir, follow-up propose -u flag on test-llm-mesh docker run
- [ ] attention: api PG test api/tests/api/llm-fallback-first-use.test.ts authored but not run locally (same blocker), verification delegated to branch CI, package suites all green locally
- [ ] BRL5-EX1 lock-sync: package-lock.json packages/llm-mesh version 0.33.0 to 0.34.0 only, reason CI changes job BRDP-EX10 requires manifest equals lock entry, impact single version string no dep change, rollback revert the one line
- [ ] No other exception declared

## AI Flaky tests
- [ ] Acceptance rule: non-systematic provider nondeterminism only, one success same commit same command, never additive timeouts, record command plus file plus signature, user sign-off before merge

## Orchestration Mode (AI-selected)
- [ ] Mono-branch + cherry-pick (default for orthogonal tasks; single final test cycle)
- [ ] Rationale: single-package slice plus one api file, one lane, one CI run

## UAT Management (in orchestration context)
- [ ] Mono-branch: no UI change, no UAT surface, verification is automated tests only

## Plan / Todo (lot-based)
- [x] Lot 0 Baseline and constraints
- [ ] Read rules/MASTER.md plus rules/workflow.md plus rules/testing.md plus .tmp/packets/COMMON-RULES.md plus plan llm-mesh-accounts-plan.md
- [ ] Create worktree tmp/worktrees/llm-mesh-lot5 on branch feat/llm-mesh-lot5-gemini-apikey-fallback from origin/main and verify branch
- [ ] Verify Lot 5 reuse files on origin/main: auth.ts direct-token, adapter-auth.ts, mistral-runtime-client.ts, decision/openai-adapter.ts, api gemini-provider.ts, enrollment seat-bundle static-key, llm-gateway ports budget.ts, budget-admission.ts, model-pricing-writer.ts, route-quote.ts, ci-lockfile-installs.test.mjs BRLOCK-EX1
- [ ] Verify unverified items: transport dir has no generic openai or gemini key transport, gemini-provider is app-local GenerateContent, seat-bundle lives under enrollment/, BRLOCK-EX1 review_by=2026-11-30T00:00:00Z, gemini-3.8-flash is a catalog model id
- [ ] Record ports API_PORT=8915 UI_PORT=5315 MAILDEV_UI_PORT=1215 and ENV=test-llm-mesh-lot5
- [x] Lot 1 Gemini API-key runtime client in llm-mesh
- [ ] Add packages/llm-mesh/src/transport/gemini-apikey-runtime-client.ts implementing GeminiAdapterClient: generate plus stream over GenerateContent plus streamGenerateContent, direct-token from context auth fail-closed, mesh tools to functionDeclarations, system to systemInstruction, usageMetadata to TokenUsage, errors via normalizeProviderError gemini, never log key
- [ ] Export client from packages/llm-mesh/src/index.ts beside mistral-runtime-client.ts
- [ ] Add packages/llm-mesh/tests/gemini-apikey-runtime-client.test.ts with mocked fetch: generate success plus usage, stream SSE success, 429 retryable, 400 non-retryable, missing auth fail-closed, no key material in thrown messages
- [ ] Lot gate: make typecheck plus lint for llm-mesh, scoped vitest run for new test file
- [x] Lot 2 Fallback-last ordering plus execution features
- [ ] Register gemini-apikey in TRANSPORT_EXECUTION_FEATURES with test-proven features only
- [ ] Sort metered static-key fallback transports after subscription transports in selectRouteCandidates with named constant and comment
- [ ] Extend packages/llm-mesh/tests/route-selection.test.ts: subscription eligible means fallback never first, only fallback eligible means fallback selected, explicit transport pin still honored
- [ ] Extend packages/llm-mesh/tests/execution-features.test.ts for gemini-apikey declaration
- [ ] Lot gate: scoped vitest runs for route-selection plus execution-features
- [x] Lot 3 Metering: monthly cap enforcement proof plus first-use overflow alert
- [ ] Prove over-budget 429 without provider call for gemini-3.8-flash quote via existing BudgetAdmissionPort in api tests on real Postgres of ENV=test-llm-mesh-lot5
- [ ] Emit llm.fallback.first_use outbox event plus structured log on first settled gemini-apikey attempt per tenant per month with spend-to-date plus monthly cap as projected max, fenced in-settlement-transaction
- [ ] Settle every fallback attempt with tenant attribution via existing route-settlement path, no new table, no migration
- [ ] Add api/tests/unit/llm-fallback-first-use.test.ts or extend llm-budget-ledger.test.ts for first-use event plus spend plus cap contents
- [ ] Lot gate: make test-api SCOPE for touched metering test file on ENV=test-llm-mesh-lot5
- [ ] Lot 4 Final validation
- [ ] Typecheck and lint full for impacted packages
- [ ] Retest UI (no UI change, not applicable)
- [ ] Retest API scoped files plus llm-mesh unit files
- [ ] Retest e2e (no e2e change, CI covers)
- [ ] Retest AI flaky (none added, non-blocking rule recorded)
- [ ] Bump packages/llm-mesh/package.json version per Package Publication if src changed, strictly greater than npm published version
- [ ] Final gate step 1: open PR with BRANCH.md as body, push, no rerun no skip
- [ ] Final gate step 2: iterate CI to green, provider-dependent AI e2e failure recorded in BRANCH.md with fresh head
- [ ] Final gate step 3: no merge (conductor merges), report in French to .tmp/rv/llm-mesh-lot5.md
