# Feature: W4.a trusted catalog context

## Objective
- [ ] Carry trusted request and turn authority through discovery, model selection and execution.

## Scope / Guardrails
- [x] Base W2.b d0ce8aeb0; merge commits only; worktree tmp/worktrees/app-w4a.
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
- [ ] Lot 1: freeze file-level tests and implementation plan before code.
  - [x] api/tests/services/catalog/request-context.spec.ts: freeze, forged context, current authority, allowlists and revocation.
  - [x] api/tests/api/catalog-auth-context.test.ts: authenticated list/get/search/sources with interleaved subjects and missing authority.
  - [x] api/tests/services/catalog/chat-context.integration.test.ts: model selection/search through real executor and seam, zero denied effects.
  - [ ] Update api/tests/services/catalog/{composite-registry,execution-seam,search-catalog-tool,mcp-source,standalone-tool-source}.spec.ts as signatures evolve.
  - [x] Regression inventory also covers existing agent/canvas/workflow source suites; source fixtures use the current ai-priorities workspace type.
  - [x] BR04A-EX1: adapt catalog-characterization.spec.ts direct product discovery to required context; test-only impact; rollback with the HTTP port contract.
  - [ ] Update api/tests/api/cluster-mesh-catalog.test.ts and api/tests/unit/foundation-executor.test.ts.
  - [x] Product catalog fixture grants a real approved tenant membership; direct comparisons use the resolved HTTP session context.
- [ ] Lot 2: frozen server-only context resolver and fresh product session/turn authority.
  - [x] Server inputs and allowlists frozen; provenance checked by identity; dispatch rechecks current grants and policy references.
  - [x] Product resolver rechecks session/conversation ownership, authoritative tenant and active account/memberships; consumes W2 compiled names directly.
- [ ] Lot 3: require context at every HTTP product port; filter before ranking and serialization.
  - [x] Every HTTP transport path authenticates, resolves authority and disables caching; product ports require context.
  - [x] Direct product discovery ports reject missing or copied context at runtime.
  - [x] Context-view tests authored before filtering: interleaved users, ranking, source absence and read-only mutations.
  - [x] Synchronous request-local snapshots filter tools/skills before collision resolution, ranking and limiting; private sources absent globally.
- [ ] Lot 4: pass turn context through model selection, search and execution; handled denials never fall through.
  - [x] Handler context travels separately from arguments; seam refreshes authority and dispatches only through the winning entry's source.
  - [x] Search and model tools use the same request-local catalog view; public identifiers pass through unchanged.
  - [x] Foundation executor resolves verified conversation authority, checks caller binding/effective turn allowlist and returns handled denials.
  - [x] Bounded chat caller resolves context from server-owned conversation inputs before model tool selection.
- [ ] Lot 5: focused suites, API typecheck/lint, runtime logs and locked make down.
- [ ] Lot 6: draft against feat/app-cm-integration with BRANCH.md body, publication-disabled CI and W4.b handoff.

## Feedback Loop
- [x] W4.b owns host-registry-source.ts and its registration; W4.a prepares the context and execution contracts.
- [x] Preserve W2.b registry public names and same transport/service; no copied name map or mutation dispatcher.
- [x] No package, schema, lock, build or deployment changes; no Track writer turn in this lot.

## AI Flaky tests
- [x] No model/network calls or timeout increases; no accepted flakes.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, one code author; merges only; external independent review remains separate.

## UAT Management (in orchestration context)
- [x] API context work; browser/navigation qualification belongs to W4.c/W5.
