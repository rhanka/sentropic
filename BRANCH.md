# Feature: W4.a trusted catalog context

## Objective
- [x] Carry trusted request and turn authority through discovery, model selection and execution.

## Scope / Guardrails
- [x] Base W2.b d0ce8aeb0; merge commits only; worktree tmp/worktrees/app-w4a.
- [x] Draft #795 targets feat/app-cm-integration; review W4.a from W2.b d0ce8aeb0 because the PR also contains the approved inherited train until integration catches up.
- [x] ENV=test-app-w4a last; API/UI/Maildev ports 8797/5183/1090; Docker flock and teardown.
- [x] Tests first; selective atomic make commits under 150 lines; no trailers.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/catalog/**`
  - `api/src/services/skills/catalog.ts`
  - `api/src/services/skills/foundation-executor.ts`
  - `api/src/services/chat-service.ts`
  - `api/src/routes/namespaces/catalog*.ts`
  - `api/tests/services/catalog/**`
  - `api/tests/api/catalog-auth-context.test.ts`
  - `api/tests/api/cluster-mesh-catalog.test.ts`
  - `api/tests/unit/foundation-executor.test.ts`
  - `api/tests/services/catalog-characterization.spec.ts`
  - `api/tests/unit/chat-service-tools.test.ts`
  - `api/tests/unit/chat-service-batch-create-orgs.test.ts`
  - `api/tests/unit/chat-service-document-generate.test.ts`
  - `api/tests/ai/chat-tools.test.ts`
  - `api/tests/ai/comment-assistant.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`
  - `.track/**`
  - `plan/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - `.github/workflows/**`

## Plan / Todo (lot-based)
- [x] Lot 0: read Docker lock, full plan-v2, W0 context contract; mechanical branch check.
- [x] Lot 1: freeze file-level tests and implementation plan before code.
  - [x] api/tests/services/catalog/request-context.spec.ts: freeze, forged context, current authority, allowlists and revocation.
  - [x] api/tests/api/catalog-auth-context.test.ts: authenticated list/get/search/sources with interleaved subjects and missing authority.
  - [x] api/tests/services/catalog/chat-context.integration.test.ts: model selection/search through real executor and seam, zero denied effects.
  - [x] Evolve execution-seam/search-catalog-tool/mcp-source/standalone-tool-source regressions; existing composite-registry suite passes unchanged.
  - [x] Regression inventory also covers existing agent/canvas/workflow source suites; source fixtures use the current ai-priorities workspace type.
  - [x] BR04A-EX1: adapt catalog-characterization.spec.ts direct product discovery to required context; test-only impact; rollback with the HTTP port contract.
  - [x] Extend api/tests/api/cluster-mesh-catalog.test.ts; preserve existing api/tests/unit/foundation-executor.test.ts (2/2).
  - [x] Product catalog fixture grants a real approved tenant membership; direct comparisons use the resolved HTTP session context.
  - [x] Product regressions cover revoked tenant membership on every mounted path, foreign workspace selectors and session revocation after discovery.
  - [x] Session activity touches and conversation title updates do not invalidate an unchanged policy snapshot.
  - [x] Product chat-service regression uses a real scoped conversation and message, the real foundation executor and seam; revoked membership permits no second handler call.
- [x] Lot 2: frozen server-only context resolver and fresh product session/turn authority.
  - [x] Server inputs and allowlists frozen; provenance checked by identity; dispatch rechecks current grants and policy references.
  - [x] Product resolver rechecks session/conversation ownership, authoritative tenant and active account/memberships; consumes W2 compiled names directly.
- [x] Lot 3: require context at every HTTP product port; filter before ranking and serialization.
  - [x] Every HTTP transport path authenticates, resolves authority and disables caching; product ports require context.
  - [x] Direct product discovery ports reject missing or copied context at runtime.
  - [x] Context-view tests authored before filtering: interleaved users, ranking, source absence and read-only mutations.
  - [x] Synchronous request-local snapshots filter tools/skills before collision resolution, ranking and limiting; private sources absent globally.
- [x] Lot 4: pass turn context through model selection, search and execution; handled denials never fall through.
  - [x] Handler context travels separately from arguments; seam refreshes authority and dispatches only through the winning entry's source.
  - [x] Negative regressions explicitly deny missing context and read-only mutations with zero handler effects.
  - [x] Search and model tools use the same request-local catalog view; public identifiers pass through unchanged.
  - [x] The effective turn allowlist also governs search_skills/search_catalog advertisement.
  - [x] Foundation executor resolves verified conversation authority, checks caller binding/effective turn allowlist and returns handled denials.
  - [x] Bounded chat caller resolves context from server-owned conversation inputs before model tool selection.
- [x] Lot 5: focused suites, API typecheck/lint, runtime logs and locked make down.
  - [x] 18-file catalog/foundation/W2 regression pass: 334/334; final 5-file negative-vector pass: 28/28, no skips or AI calls.
  - [x] Typecheck identified the OpenAI custom-tool union; filter narrows to the function tools produced by this catalog.
  - [x] Final function-tool narrowing verified by chat-context integration (1/1), API typecheck and lint (0 errors, 219 warnings); startup logs contain no runtime errors.
  - [x] Local receipts: /tmp/app-w4a-{product,final,quality}.log; same package/lock tree as W2.b; reused local image d0928e and matching package outputs without rebuilding.
  - [x] Locked make down after checks, then project-scoped make clean and final make down; make ps and project-volume inventory empty; /tmp/app-w4a-cleanup.log.
  - [x] Mechanical branch/scope and ancestry checks pass; maximum authored commit is 106 changed lines; no trailers, package/lock or Track changes.
- [x] Lot 6: draft #795 against feat/app-cm-integration with BRANCH.md body and W4.b handoff; submit CI on the final documentation head with bootstrap_publish_target=none.
  - [ ] Remote CI outcome and independent receiving reviews remain separate gates before integration; no merge or deployment in this lot.
- [ ] Lot 7: address Opus R1 without making catalog authority a chat prerequisite.
  - [x] BR04A-EX2: grant approved tenant membership only in the five existing tool-availability fixtures listed in scope; requested chat regression coverage requires their authorized path; test-only impact; rollback removes those grants.
  - [x] chat-turn.integration.test.ts: real-store missing/requested tenant membership, NULL session workspace, hidden workspace, non-member and failed transport; completed generation, no catalog tools, explicit unavailable context and fixed PII-free warning.
  - [x] Real-store interleaved chat turns and mounted HTTP discovery for two users in two workspaces; assert each model tool list and revocation isolation; focused pass 17/17 in /tmp/app-w4a-r1-context-green.log.
  - [x] Existing ten chat-service/chat-summary/chat-tools/comment-assistant suites: 60/60 across the unchanged five suites (17 tests) and five fixture-adjusted suites (43 tests); /tmp/app-w4a-r1-{existing,fixtures}.log.
  - [x] Catalog/foundation/HTTP regressions: 317/317 across 17 files; API lint: 0 errors, 220 warnings; /tmp/app-w4a-r1-catalog-lint.log. Startup runtime log contains no errors.
  - [x] Locked make down completed; isolated containers and network removed; /tmp/app-w4a-r1-down.log.

## Feedback Loop
- [ ] R1 typecheck gate; owner: integration/W3.c for build preparation, auth owner to be assigned for jose typing. Local make typecheck-api fails at auth/federation/apple-provider.ts:2 (jose exports no CryptoKey); old-head CI job 122119554375 fails on missing @sentropic/artifacts subpath declarations. Receipts: /tmp/app-w4a-r1-{quality,ci-old}.log. Acceptance: canonical API typecheck and CI chat lanes pass on the integration head; no W4.a scope expansion into auth/build/packages.
- [x] W4.b owns host-registry-source.ts and its registration; W4.a prepares the context and execution contracts.
- [x] Preserve W2.b registry public names and same transport/service; no copied name map or mutation dispatcher.
- [x] W4.b must distinguish sessionKind=http (login credential) from sessionKind=turn (conversation authority); never use a conversation ID as a W1 session credential.
- [x] W4.b source must require context and return no unscoped snapshot; consume productArtifactTransport.ready tools/resolveTool and exact compiled names, then register that same source for discovery and execution.
- [x] W4.b must bind current provider/resource authority before projection, carry the verified credential to productArtifactTransport.invoke, and retain W1 finalization guards; do not introduce another effect dispatcher.
- [x] W4.b must complete the turn-to-host credential binding using server evidence, extend the effective server turn allowlist with authorized compiled names, and prove one persisted host effect plus denial after revocation.
- [x] No package, schema, lock, build or deployment changes; no Track writer turn in this lot.

## AI Flaky tests
- [x] No model/network calls or timeout increases; no accepted flakes.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, one code author; merges only; external independent review remains separate.

## UAT Management (in orchestration context)
- [x] API context work; browser/navigation qualification belongs to W4.c/W5.
