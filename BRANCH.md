# Feature: Generic judge capability — JEV first (BR96)

## Objective
- [ ] Deliver the strict judge contract, deterministic JEV adapter/service and lazy cluster surfaces in specification v2.2 §10.2; support the h2a native-plugin objective without consumer key custody.

## Scope / Guardrails
- [x] Execute `.h2a/inputs/build_brief.md`; specification `.h2a/specs/judge_spec_v2_2.md` and its Opus review are the design inputs.
- [x] Work only in `/home/antoinefa/src/sentropic/tmp/llm-judge`, branch `feat/llm-judge`; root dev/UAT remains untouched.
- [x] Baseline rebased onto origin/main `12be48eeb566439b9f455b106c7928065511aa7f` on 2026-10-04; mesh/gateway/cluster remain 0.22.3/0.19.1/0.13.0.
- [x] Build brief supersedes the spec's early-code prohibition: code/tests may proceed before PR #633 lands; TUPLE, migration generation and release qualification remain gated.
- [x] Make-only, Docker-first, no native package manager/Python; one Docker build at a time; every Make invocation ends with ENV.
- [x] Never ENV=dev; never make clean-all; all new code, comments, commits and Markdown text are in English.
- [x] Tracked judge design/docs consolidation is a prerequisite before any PR or integration; the ignored draft is a local execution input only.
- [x] Integration test slot: API_PORT=9480, UI_PORT=5680, MAILDEV_UI_PORT=1580, ENV=test-llm-judge; ports absent from `ss -ltn` at kickoff, recheck before stack creation.
- [x] Pass all three ports on stack-capable commands; command-line ENV/ports replace editing a custody copy; verify project prefix/binding through `make ps` after first startup.
- [x] No real provider tokens or real JEV calls; synthetic fixtures/injected transports only. Live qualification needs conductor-relayed owner GO.
- [x] Atomic commits at most 149 changed lines/15 files including BRANCH.md; selective staging, separate add/commit, `make commit MSG="type: description"`; no attribution trailers.
- [x] Stop after every lot and write `.h2a/build/lotN_report.md`; conductor's Opus 5.5 high review must resolve blocking findings before the next lot.
- [x] No version bumps, packaging tuple/lock changes, publish, push, PR or merge until conductor GO after the /gw train lands.
- [x] Product durable-host §10.3, later providers/local serving and §9.3 architecture are outside this execution; portable client 2.09 is the explicit §10.2 cluster prerequisite.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - [x] `BRANCH.md`, `.h2a/build/**`
  - [x] `packages/llm-mesh/src/judge/**`, `packages/llm-mesh/src/transport/jev.ts`
  - [x] `packages/llm-mesh/src/providers.ts`, `packages/llm-mesh/src/capabilities.ts`, `packages/llm-mesh/src/catalog.ts`, `packages/llm-mesh/src/registry.ts`
  - [x] `packages/llm-mesh/tests/judge-*.test.ts`, `packages/llm-mesh/tests/transport/jev*.test.ts`, `packages/llm-mesh/tests/muse.test.ts`, `packages/llm-mesh/tests/gcp.test.ts`
  - [x] `packages/llm-mesh/package.json` (judge export-map additions only; no version/dependency changes)
  - [x] `packages/cluster-mesh/src/modules/contracts.ts`, `packages/cluster-mesh/src/modules/catalog.ts`, `packages/cluster-mesh/src/compose/llm-mesh.ts`
  - [x] `packages/cluster-mesh/src/integrations/llm-mesh/judge.ts`, `packages/cluster-mesh/src/integrations/llm-mesh/judge/**`, `packages/cluster-mesh/src/integrations/llm-mesh/transport/jev.ts`
  - [x] `packages/cluster-mesh/src/loaders/llm-mesh/judge.ts`, `packages/cluster-mesh/src/loaders/llm-mesh/judge/**`, `packages/cluster-mesh/src/loaders/llm-mesh/transport/jev.ts`
  - [x] `packages/cluster-mesh/package.json` (judge export-map additions only; no version/peer-range changes)
  - [x] `packages/cluster-mesh/tests/judge-*.spec.ts`, `packages/cluster-mesh/tests/modules/judge-loading.spec.ts`, `packages/cluster-mesh/tests/modules/capabilities.spec.ts`
  - [x] `packages/cluster-mesh/tests/integrations/llm-surface.spec.ts`, `packages/cluster-mesh/tests/integrations/gateway-surface.spec.ts`, `packages/cluster-mesh/tests/fixtures/train.ts`, `packages/cluster-mesh/tests/fixtures/package-tree.ts`
  - [x] `packages/cluster-mesh/tests/modules/registry.spec.ts`, `packages/cluster-mesh/tests/modules/topology.spec.ts`, `packages/cluster-mesh/tests/modules/topology-ranges.spec.ts`
  - [x] `api/src/services/provider-runtime.ts`, `api/src/services/provider-registry.ts`, `api/src/services/model-catalog.ts`, `api/src/services/llm-runtime/index.ts`, `api/src/services/llm-runtime/gateway-wire-adapter.ts`
  - [x] `api/src/routes/namespaces/config-product-ai.ts`
  - [x] `api/tests/unit/judge-*-selection.test.ts`, `api/tests/unit/provider-registry-expansion.test.ts`, `api/tests/api/judge-chat-settings.test.ts`
  - [x] `packages/llm-mesh/README.md`, `packages/cluster-mesh/README.md`, `spec/SPEC_EVOL_LLM_MESH.md`, `spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md` (judge semantics only)
- [x] **Forbidden Paths (must not change in this branch)**:
  - [x] `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`, `.github/workflows/**`, `plan/**`, `.track/**`
  - [x] `packages/llm-gateway/**`, `packages/contracts/**`, `packages/events/**`, `packages/cluster-mesh/tests/packaging/**`, `package.json`, `package-lock.json`
  - [x] `ui/**`, `apps/**`, `deploy/**`, `api/src/db/**`, `api/drizzle/**`, `api/src/services/llm-metering/**`
- [x] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [x] `api/vitest.config.ts` (judge-subpath aliases only; declare a numeric branch exception before editing)
  - [x] `api/src/routes/namespaces/llm-mesh.ts` (only aiSettingsSchema/updateUserSettings if the existing typesafe refusal needs a source edit)
- [x] **Exception process**: use the numeric BR96-EXn grammar with rationale, impact and rollback before a conditional/forbidden edit; no concrete exception ID is active.

## Feedback Loop
- [x] Q1 working assumption: develop code/tests now per launch brief; after PR #633 lands, rebase/recheck and wait for conductor GO before the reserved 0.24.0/0.21.0/0.15.0 tuple. No alternate tuple.
- [x] Q2/Q5/Q6 working assumptions remain revisable: product /llm-mesh host later; common ProviderId with explicit judgeOnly marker; environment-only JEV key, no BYOK.
- [x] Review S1: before future 2.08a, add app.ts registry authPaths union and root-mount-fence-completeness/namespace-inventory regressions; future host scope must explicitly include these paths.
- [x] Review S2 working assumption for future API tests: non-secret REGISTRY=local configuration with no provider keys; conductor confirms review-slot provisioning before any review/API stack launch.
- [x] Review s1: current GO covers §10.2 plus prerequisite 2.09; durable host rows 2.01–2.12 and TUPLE are not implicitly authorized by the phrase “Lot 1”.
- [x] Review s2/s3: future live guard needs a fsynced, ignored cross-run attempt ledger, boolean-only key check, injected public-rate estimate, command-line project/port overrides and startup verification.
- [x] Review s4/s5: future host uses DPoP for bound tokens, rejects workspace selectors, sanitizes duplicate-binding configuration failures; migration regeneration must have zero artifact delta.
- [x] Track source artifact only: concurrent worktree is not designated .track writer; conductor imports BRANCH.md under track-operation single-writer rules.
- [x] Lot 0 Opus review: no BLOCKER; M1 maps the brief's BRJ-EXn spelling to numeric BR96-EXn; exception numbers 1–3 remain reserved for future Compose/migration/TUPLE and numbers 4+ for Lot 1. Do not list concrete inactive IDs, since the harness unlock is global.
- [x] M2: 1.26a/b defer until PR #633 merged, rebase completed and 2.12 committed; no pre-train literal fixture changes.
- [x] M3 conductor decision, 2026-10-04: SPLIT into 1A contracts (1.01–1.03), 1B chat gates (1.04a–g), 1C JEV/service (1.05–1.18), 1D client/cluster/docs (2.09, 1.20a–1.23, 1.25a…). Stop/report/Opus review after each; no next checkpoint before blocking findings are resolved.
- [x] m1: user default-provider route is llm-mesh.ts, not config-product-settings.ts; 1.04e asserts its existing closed-enum refusal through judge-chat-settings.test.ts; conditional source scope is limited above.
- [x] m2: 1.04f includes R API provider-mesh-contract-proof.test.ts/provider-credentials.test.ts and mesh local.test.ts; any necessary test edit requires scope extension first. Gateway typecheck/lint/full tests join the checkpoint gates.
- [x] m3: template docs/final lots and English/dev/clean-all guardrails restored; release steps stay unchecked and conductor-gated.
- [x] m4: test-llm-judge replaces spec slot-0 test-llm-judge-int throughout this execution and the future host runbook; cleanup always includes the complete port triple and ENV.
- [x] m5: tracked consolidation into SPEC_EVOL_LLM_MESH.md is mandatory before PR/integration, so the ignored design draft is never the sole reviewer reference.
- [x] m6: host-global harness C1/recorder output is advisory; repository make scope-check C2 is authoritative. Makefile remains forbidden; no new host packages or C1 target.

## AI Flaky tests
- [x] Deterministic fake-only execution; no flaky acceptance or real-call qualification claimed; never increase test timeouts.

## Orchestration Mode (AI-selected)
- [x] Mono-branch integration; rebase/fast-forward replaces the template's legacy cherry-pick label. This launch executes in this worktree only; conductor arranges the external Opus review.

## UAT Management (in orchestration context)
- [x] Lot 1 has no UI/extension changes; synthetic machine-caller tests qualify package behavior. Operational graphify/h2a UAT waits for the separately authorized durable host.
- [x] Reviewer must use the committed SHA; record actual commands/results, never claim an absent review or skipped packed suite passed.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read MASTER/workflow/testing/security, README, relevant TODO/PLAN, branch template, full v2.2 spec/Opus review and h2a objective.
  - [x] Verify isolated branch mechanically; fetch/rebase origin/main; capture actual baseline versions and release gates.
  - [x] Inspect existing Make targets; check ports; define the branch test slot, guardrails and file scope.
  - [x] Create the checkbox-only plan from the template; retain reviewed spec as design source without duplicating it into a new tracked spec.
  - [x] Lot gate: C1/C2 PASS; bounded plan commit and `.h2a/build/lot0_report.md` record the preparation boundary; stop before 1.01.
- [ ] **Lot 1A — Request, verdict and receipt contracts**
  - [ ] 1.01: request.ts strict inputs/criterion bounds; new mesh tests/judge-request.test.ts.
    - [x] 1.01a: request types and bounded JSON/correlation/money primitives; synthetic JSON/coercion/accessor tests.
  - [ ] 1.02: verdict.ts scale/direction/confidence/distributions; new mesh tests/judge-verdict.test.ts.
  - [ ] 1.03: receipt.ts/errors.ts discriminants, independent token provenance, correlation/null counts; new mesh tests/judge-receipt.test.ts.
  - [ ] Gate: scoped contract tests per coherent commit, mesh/gateway typecheck/lint/full suites, authoritative make scope-check before every commit; write .h2a/build/lot1A_report.md and stop for Opus review.
- [ ] **Lot 1B — Chat selection refusal**
  - [ ] 1.04a: catalog judgeOnly declaration and API provider-runtime predicate before activation; new API tests/unit/judge-chat-selection.test.ts; regress provider-registry-expansion.test.ts and unmarked local.
  - [ ] 1.04b: model-catalog marked explicit/stored refusal before fallback; update API tests/unit/judge-chat-selection.test.ts.
  - [ ] 1.04c: llm-runtime/index.ts marked-provider refusal; new API tests/unit/judge-runtime-selection.test.ts.
  - [ ] 1.04d: gateway-wire-adapter marked-provider refusal; new API tests/unit/judge-wire-selection.test.ts.
  - [ ] 1.04e: config-product-ai settings refusal; assert existing llm-mesh user-setting refusal in new API tests/api/judge-chat-settings.test.ts.
  - [ ] 1.04f: activate typesafe ProviderId/family, empty chat models, judgeOnly profile; update mesh muse/gcp and API provider-registry-expansion/chat-selection tests; rerun all 1.04 gates plus R API provider-mesh-contract-proof/provider-credentials and mesh local tests; extend scope before editing unlisted regressions.
  - [ ] 1.04g: registry type-only optional judge members; new mesh tests/judge-registry.test.ts; regress tests/facade.test.ts.
  - [ ] Gate: named API/mesh regressions, mesh/gateway typecheck/lint/full suites, scoped commits; write .h2a/build/lot1B_report.md and stop for Opus review.
- [ ] **Lot 1C — JEV codec, transport and service**
  - [ ] 1.05: jev-codec.ts/jev-descriptor.ts bounded single-question encoding, unqualified identity/billing evidence; new mesh tests/judge-jev-request.test.ts.
  - [ ] 1.06: jev-verdict.ts exact Noul/Choice answers; new mesh tests/judge-jev-binary-choice.test.ts.
  - [ ] 1.07: fractional Score and ordered index/label distribution mapping; new mesh tests/judge-jev-score.test.ts.
  - [ ] 1.08: jev-response.ts exact qualified served IDs and independently validated usage on identity mismatch; new mesh tests/judge-jev-usage.test.ts.
  - [ ] 1.09: transport/jev.ts injected fetch, fixed endpoint/bearer, single send, bounded responses and no redirects; new mesh tests/transport/jev.test.ts.
  - [ ] 1.10: transport deadline/cancellation/status mapping without retry; new mesh tests/transport/jev-failure.test.ts.
  - [ ] 1.11: adapter.ts JevAdapter descriptor discovery and no chat execution; new mesh tests/judge-adapter.test.ts.
  - [ ] 1.12: service.ts/policy.ts exact revision/input/capability selection; new mesh tests/judge-selection.test.ts.
  - [ ] 1.13: concrete resolved auth and descriptive retention, unsupported retention requests refuse; new mesh tests/judge-policy.test.ts.
  - [ ] 1.14: pricing.ts/budget.ts integer quotes and defensible liability-bound refusal; new mesh tests/judge-budget.test.ts.
  - [ ] 1.15: service admission, awaited durable marker and one dispatch; new mesh tests/judge-dispatch.test.ts.
  - [ ] 1.16: settlement/receipt persistence, identity-mismatch usage, charged overrun and no replay; new mesh tests/judge-settlement.test.ts.
  - [ ] 1.17: raw/observation allowlists and content/secret canaries; new mesh tests/judge-privacy.test.ts.
  - [ ] 1.18: consumer index.ts, trusted host.ts and three export subpaths; new mesh tests/judge-public-surface.test.ts; typecheck-llm-mesh; no version change.
  - [ ] Gate: named fake-only codec/transport/service/privacy tests, mesh/gateway typecheck/lint/full suites; write .h2a/build/lot1C_report.md and stop for Opus review.
- [ ] **Lot 1D — Remote client, cluster surface and public docs**
  - [ ] 2.09 prerequisite: client.ts authenticated mesh-only caller, correlation, bounded envelopes, receipt-null connection failure and no retry; new mesh tests/judge-client.test.ts; update public-surface test.
  - [ ] 1.20a–c: three separate cluster module/catalog commits after client exists; update tests/modules/capabilities.spec.ts and new/update tests/modules/judge-loading.spec.ts for each.
  - [ ] 1.21a–c: three separate cluster leaf/typed-loader/export commits; update tests/integrations/llm-surface.spec.ts and tests/modules/judge-loading.spec.ts for each; retain existing ranges.
  - [ ] 1.22: compose/llm-mesh optional host judge input, disabled path acquires nothing; new cluster tests/judge-compose.spec.ts.
  - [ ] 1.23: public-port receipt correlation/generation-policy refusal; new cluster tests/judge-receipts.spec.ts.
  - [ ] 1.25a…: bounded public consumer/host examples, normalization/privacy/failure semantics and tracked architecture consolidation; regress mesh tests/judge-public-surface.test.ts.
  - [ ] Per-row gate: run each named mesh/cluster file separately with `make test-llm-mesh`/`make test-cluster-mesh SCOPE=<package-relative-path> API_PORT=9480 UI_PORT=5680 MAILDEV_UI_PORT=1580 ENV=test-llm-judge`.
  - [ ] API gate when needed: `make up-api-test REGISTRY=local API_PORT=9480 UI_PORT=5680 MAILDEV_UI_PORT=1580 ENV=test-llm-judge`, then scoped test-api-unit/test-api-endpoints in that slot; `make down API_PORT=9480 UI_PORT=5680 MAILDEV_UI_PORT=1580 ENV=test-llm-judge` afterward.
  - [ ] Gate: sequential mesh/gateway/cluster typecheck/lint/full affected suites and named API regressions; scope-check before each commit; write .h2a/build/lot1D_report.md and stop for Opus review.

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Consolidate judge contract, normalization, custody, privacy and failure semantics into tracked SPEC_EVOL_LLM_MESH.md/DEPLOYABLE_PROCESS.md and package READMEs before any PR/integration; verify public-surface tests.
  - [ ] Judge durable-host Lot 2 requires separate execution scope/schema exception/product tests; preserve S1–S2/s1–s5 as handoff requirements and keep live qualification separately gated.
- [ ] **Lot N — Final validation (deferred to conductor release train)**
  - [ ] After PR #633 merged + rebase + 2.12 committed: 1.26a independent post-train literals in tests/fixtures/train.ts, integration suites/package-tree helper; registry/topology regressions.
  - [ ] Under the same gate: 1.26b registry/topology/topology-ranges literals and intentional skew cases; run all three and both integration suites.
  - [ ] After conductor GO: atomic TUPLE/package bumps and 1.24a… packaging fixtures, complete exact-artifact/packed gates; default-suite skips are not qualification evidence.
  - [ ] Under separately authorized release scope: PR title/body from BRANCH.md, UAT/CI green, commit BRANCH.md removal, push/merge and separately authorized publication. No such action is authorized now.
