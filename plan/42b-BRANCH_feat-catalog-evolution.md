# Feature: Unified Capability Catalog (5 kinds) — BR-42b

## Objective
Build an app-local unified capability catalog of five entry kinds (skill, tool, agent, workflow, canvas) fed by pluggable `CatalogSource` plugins, refactoring the current skill-only registry behind a `CompositeCatalogRegistry` with zero regression, and retiring the dormant `feat/mcp-tool-catalog-br19b` MCP stub.

## Scope / Guardrails
- Scope limited to the app-local catalog machinery in `api/`, the consuming chat tool wiring, the agent template source, and tests. `@sentropic/skills` is consumed READ-ONLY (its `FOUNDATION_SKILLS` bundle is imported into `api/`); this branch does NOT modify `packages/skills/src/**`.
- Catalog is APP-LOCAL in `api/src/services/catalog/**` (Codex MF6 + plan-review MF3): `CatalogEntry`, `CatalogSource`, `CompositeCatalogRegistry`, `StaticCatalogSource`, the execution-dispatch seam, and `search_catalog` ALL live in `api/`. A package CANNOT import the api-local agent template type, so no shared catalog type is added to `@sentropic/skills`; the `@sentropic/catalog` package extraction is DEFERRED.
- No DB migration required in v1 (all kinds are code/in-memory templates; `agent_definitions` and `workflow_definitions` untouched).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/feat-catalog-42b` only.
- Automated test campaigns run on `test-feat-catalog-evolution-42b` / `e2e-feat-catalog-evolution-42b`, never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA).
- In every `make` command, `ENV=<env>` is passed as the last argument.
- All new text in English.
- Mono-branch + cherry-pick; characterization-first; GATE after Lot 1.
- Slot-3 ports: `API_PORT=9213`, `UI_PORT=5413`, `MAILDEV_UI_PORT=1313`.
- ENV alias: `feat-catalog-evolution-42b` (dev), `test-feat-catalog-evolution-42b` (test), `e2e-feat-catalog-evolution-42b` (e2e).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/services/catalog/**` (NEW — `CatalogEntry` union, `CatalogSource` interface, `CompositeCatalogRegistry`, `StaticCatalogSource`, execution seam, `search_catalog`, `McpCatalogSource`)
  - `api/src/services/skills/catalog.ts` (wire composite + execution seam + MCP config)
  - `api/src/services/skills/foundation-executor.ts` (consult catalog dispatch for non-hardcoded names)
  - `api/src/config/default-agents.ts` (read-only import for the `agent` template source)
  - `api/tests/**` (characterization + per-kind + MCP integration tests)
  - `@sentropic/skills` is consumed READ-ONLY (`FOUNDATION_SKILLS` imported into `api/src/services/catalog/sources/static-source.ts`); `packages/skills/src/**` is NOT in implementation scope — no adapter, no shared catalog type is added there (plan-review MF3)
- **Forbidden Paths (must not change in this branch)**:
  - `packages/skills/src/**` (consumed read-only; `StaticCatalogSource` + all catalog machinery live app-local in `api/`)
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `ui/**`
  - canvas runtime sub-program (`SPEC_EVOL_CHAT_CANVAS` — `LiveDocumentStore`/CRDT/editor)
  - other packages' `src/**` beyond a read-only kind-payload type import (`packages/flow/src/**`, canvas package src)
- **Conditional Paths (allowed only with explicit exception)**:
  - `api/package.json` + `api/package-lock.json` + root `package-lock.json` (add `@modelcontextprotocol/sdk` for Lot 5; the API image build runs `npm ci --workspaces` against the ROOT lock per `api/Dockerfile:51`, so BOTH locks must be updated for CI/image parity) → `BR42b-EX1`
  - `.github/workflows/**`
  - `api/drizzle/*.sql` (max 1 file — only if v1 scope unexpectedly needs DB persistence; default none)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
- `BR42b-EX1` (`deferred` until Lot 5): touch `api/package.json` + BOTH `api/package-lock.json` and root `package-lock.json` to add `@modelcontextprotocol/sdk` via `make install-api NPM_LIB=@modelcontextprotocol/sdk ENV=test-feat-catalog-evolution-42b`.
  - Reason: MCP `CatalogSource` (Lot 5) needs the official SDK. The API image build runs `npm ci --workspaces --include-workspace-root` against the ROOT `package-lock.json` (`api/Dockerfile:51`), so updating only `api/package-lock.json` breaks CI/image parity — both locks must carry the new dependency.
  - Impact: one new runtime dependency in `api/`; two lockfiles updated (api + root). No `@sentropic/skills` change (catalog is fully app-local; the foundation bundle is consumed read-only), so no skills version bump.
  - Rollback: remove the dependency line + both lockfile entries; MCP source falls back to deferred.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in this file; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: One cohesive capability (the unified catalog) with sequential lots and a single gate after Lot 1; no independent CI streams needed.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT performed on the integrated branch only (after relevant lots when behaviour-visible changes exist).
- UAT checkpoints listed as checkboxes inside each relevant lot (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run tests in `tmp/feat-catalog-42b`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/top-ai-ideas-fullstack`, `ENV=dev`).
  - Switch back to `tmp/feat-catalog-42b` after UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & characterization lock**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/testing.md`, `spec/SPEC_EVOL_CATALOG.md`, `plan/BRANCH_TEMPLATE.md`.
  - [x] Confirm worktree `tmp/feat-catalog-42b` + slot-3 ports (9213/5413/1313) + ENV mapping.
  - [x] Confirm scope boundaries and declare `BR42b-EX1` posture (deferred until Lot 5).
  - [x] Pin CURRENT catalog behaviour GREEN on current code (0-regression baseline):
    - [x] Add `api/tests/services/catalog-characterization.spec.ts`: assert `resolveFoundationChatTools(input)` returns the 16-skill foundation bundle projection + the `search_skills` meta-tool, per authz allowlist (`buildFoundationSkillsAuthz`).
    - [x] **Live-chat oracle (plan-review MF1)**: pin the ACTUAL per-turn OpenAI tool array as consumed by `chat-service.ts:2749` — assert `search_skills` is FIRST, the exact 16 foundation skill names are present, the exact resolved tool descriptors (name/description/parameters) and their ORDER, and that consumption is synchronous. This is the live 0-regression oracle (not just the facade); it must stay byte-identical through Lot 1 BEFORE any new kind is added.
    - [x] Add coverage pinning `SkillsToolRegistry.resolveTools` prepends `SEARCH_SKILLS_RESOLVED_TOOL` (skill-only) and stays synchronous.
    - [x] **`search_skills` SEMANTICS (plan-review MF2)**, not just shape: add exact `SkillSearchHit[]` fixtures for representative queries (multi-hit, single-hit), proving ranking/order, the result `limit`, empty-query behaviour, and category/role/authz filtering — `executeFoundationSearchSkills` returns metadata hits (not SKILL.md bodies). Same fixtures re-asserted through Lot 1 and after Lot 7 (`search_catalog`).
    - [x] Add coverage pinning `foundation-executor` dispatch by hardcoded name + `unhandled` for unknown names (`chat-service.ts:4119` surface).
  - [x] Lot gate:
    - [x] `make typecheck-api ENV=test-feat-catalog-evolution-42b` + `make lint-api ENV=test-feat-catalog-evolution-42b`
    - [x] Sub-lot gate: `make test-api-smoke SCOPE=tests/services/catalog-characterization.spec.ts` + `make test-api-unit SCOPE=tests/services/catalog-characterization.spec.ts` — 38/38 GREEN on unchanged code. Full `make test-api` has pre-existing EACCES/OOM issues in parallel workers (not caused by this lot); characterization spec passes in isolation.
  - [ ] `make down ENV=test-feat-catalog-evolution-42b`

- [x] **Lot 1 — `CatalogSource` seam [GATE, no behaviour change]**
  - [x] Add `api/src/services/catalog/types.ts`: `CatalogEntryKind`, `CatalogEntryMetadata` (shared = intersection, §3.1), `CatalogEntryBase`, the 5 per-kind payload entries, `CatalogEntry` union.
  - [x] Add `api/src/services/catalog/source.ts`: `CatalogSource` interface (sync `snapshot()` + optional async `refresh()` + optional `health()`).
  - [x] Add `api/src/services/catalog/composite-registry.ts`: `CompositeCatalogRegistry` fanning `list/get/search` across source snapshots with foundation-precedence collision policy.
  - [x] Add `api/src/services/catalog/sources/static-source.ts`: `StaticCatalogSource` (id `foundation`) wrapping `FOUNDATION_SKILLS` → `skill`-kind entries.
  - [x] Wire `api/src/services/skills/catalog.ts` to compose foundation via the composite registry; keep `search_skills`-first contract byte-identical; chat tool contract unchanged.
  - [x] Keep `packages/skills/src/**` UNTOUCHED — `StaticCatalogSource` lives app-local in `api/src/services/catalog/sources/static-source.ts` and imports `FOUNDATION_SKILLS` read-only (plan-review MF3); no shared catalog type or adapter is added to the package.
  - [x] Lot gate:
    - [x] `make typecheck-api ENV=test-feat-catalog-evolution-42b` + `make lint-api ENV=test-feat-catalog-evolution-42b`
    - [x] **API tests**
      - [x] Update `api/tests/services/catalog-characterization.spec.ts` to run through the composite path and prove byte-identical resolved tool set INCLUDING the live-chat oracle (MF1 per-turn OpenAI tool array) + the `search_skills` semantic fixtures (MF2) — GATE = 0-regression. Any byte difference STOPS the lot.
      - [x] Add `api/tests/services/catalog/composite-registry.spec.ts` (list/get/search fan-out + collision precedence).
      - [x] Add `api/tests/services/catalog/static-source.spec.ts` (foundation → `skill` entries, snapshot is sync + always-fresh).
      - [x] Scoped runs while evolving: `make test-api-services SCOPE=tests/services/catalog ENV=test-feat-catalog-evolution-42b`
      - [x] Sub-lot gate: `make test-api ENV=test-feat-catalog-evolution-42b`
  - [x] GATE: characterization GREEN through composite = proceed; otherwise STOP and fix before any kind lot.
  - [ ] `make down ENV=test-feat-catalog-evolution-42b`

- [x] **Lot 2 — `tool` kind + generic execution seam**
  - [x] Add `api/src/services/catalog/sources/standalone-tool-source.ts`: standalone `tool`-kind entries (`SkillTool` payload + optional `rawName`).
  - [x] Add `api/src/services/catalog/execution-seam.ts`: kind-agnostic `CatalogEntry`-keyed dispatch (entry carries/returns its handler) for any tool name not hardcoded.
  - [x] Wire `api/src/services/skills/foundation-executor.ts` to consult the execution seam before returning `unhandled` (precedes MCP).
  - [x] Reconcile skill-owned vs standalone tools (D-TOOL-RECONCILE): skill tools stay owned by their `skill` entry, NOT duplicated as `tool` entries.
  - [x] Lot gate:
    - [x] `make typecheck-api ENV=test-feat-catalog-evolution-42b` + `make lint-api ENV=test-feat-catalog-evolution-42b`
    - [x] **API tests**
      - [x] Add `api/tests/services/catalog/standalone-tool-source.spec.ts` (standalone tool entry shape + no skill-tool duplication).
      - [x] Add `api/tests/services/catalog/execution-seam.spec.ts` (non-hardcoded tool name dispatches through the seam; unknown still `unhandled`).
      - [x] Update `api/tests/services/catalog-characterization.spec.ts` to assert hardcoded foundation tools still dispatch unchanged.
      - [x] Sub-lot gate: `make test-api ENV=test-feat-catalog-evolution-42b` (characterization 41/41 byte-identical + catalog specs 114/114 GREEN; typecheck/lint clean)
  - [x] `make down ENV=test-feat-catalog-evolution-42b`

- [ ] **Lot 3 — `agent` template kind**
  - [ ] Add `api/src/services/catalog/sources/agent-template-source.ts`: `agent`-kind entries over `WORKSPACE_TYPE_AGENT_SEEDS` (`api/src/config/default-agents.ts:37`, `DefaultGenerationAgentDefinition`).
  - [ ] `list/search/get` parity with skills; per-workspace `agent_definitions` DB rows NOT catalogued; flow `AgentTemplate` runtime untouched (§14 invariant preserved).
  - [ ] Lot gate:
    - [ ] `make typecheck-api ENV=test-feat-catalog-evolution-42b` + `make lint-api ENV=test-feat-catalog-evolution-42b`
    - [ ] **API tests**
      - [ ] Add `api/tests/services/catalog/agent-template-source.spec.ts` (seeds → `agent` entries; list/search/get parity; no DB-row leakage).
      - [ ] Sub-lot gate: `make test-api ENV=test-feat-catalog-evolution-42b`
  - [ ] `make down ENV=test-feat-catalog-evolution-42b`

- [ ] **Lot 4 — `workflow` kind**
  - [ ] Add `api/src/services/catalog/sources/workflow-seed-source.ts`: `workflow`-kind entries over `@sentropic/flow` `WORKSPACE_TYPE_WORKFLOW_SEEDS` (`DefaultWorkflowDefinition` payload).
  - [ ] Import the seeds from `@sentropic/flow` (NOT from `api/`); runtime stays in flow (`FlowRuntime`/`processing-loop`); no `packages/flow/src/**` edit, no skills→flow dep.
  - [ ] `list/search/get` parity with skills.
  - [ ] Lot gate:
    - [ ] `make typecheck-api ENV=test-feat-catalog-evolution-42b` + `make lint-api ENV=test-feat-catalog-evolution-42b`
    - [ ] **API tests**
      - [ ] Add `api/tests/services/catalog/workflow-seed-source.spec.ts` (flow seeds → `workflow` entries; source import is `@sentropic/flow`; no DB-row leakage).
      - [ ] Sub-lot gate: `make test-api ENV=test-feat-catalog-evolution-42b`
  - [ ] `make down ENV=test-feat-catalog-evolution-42b`

- [ ] **Lot 5 — MCP `CatalogSource` (absorbs br19b)**
  - [ ] Declare/confirm `BR42b-EX1` before touching `api/package.json`.
  - [ ] `make install-api NPM_LIB=@modelcontextprotocol/sdk ENV=test-feat-catalog-evolution-42b` (positional package arg is NOT supported — the target reads `${NPM_LIB}`); verify BOTH `api/package-lock.json` and root `package-lock.json` are updated for CI/image parity.
  - [ ] Add `api/src/services/catalog/sources/mcp-source.ts`: `McpCatalogSource` (`kind: 'mcp'`) — connect (stdio/HTTP-SSE), `tools/list` → `tool`-kind entries, sanitized provider-safe public name + `rawName` (§3.3), async `refresh()`.
  - [ ] Wire MCP `call` through the Lot-2 execution seam; per-source config (URL/command, auth token/headers, allow/deny filter) carried out-of-band (env/workspace config), NOT in the entry.
  - [ ] Retire `feat/mcp-tool-catalog-br19b` (no-op cleanup; no code/PR on origin).
  - [ ] Lot gate:
    - [ ] `make typecheck-api ENV=test-feat-catalog-evolution-42b` + `make lint-api ENV=test-feat-catalog-evolution-42b`
    - [ ] **API tests**
      - [ ] Add `api/tests/services/catalog/mcp-source.spec.ts` (integration vs a stub MCP server: `tools/list` → namespaced `mcp:<server>/<tool>` `tool` entries with public-id↔rawName map; `call` dispatches via the seam; `refresh()` repopulates snapshot, never on the per-turn resolve).
      - [ ] Add name-sanitization coverage (`mcp:`/`/` raw names → kebab/underscore public ids accepted by the parser + OpenAI conversion).
      - [ ] Sub-lot gate: `make test-api ENV=test-feat-catalog-evolution-42b`
  - [ ] `make down ENV=test-feat-catalog-evolution-42b`

- [ ] **Lot 6 — `canvas` template kind (kind-only, no runtime)**
  - [ ] Add `api/src/services/catalog/sources/canvas-template-source.ts`: `canvas`-kind entries (`CanvasTemplate` = `LiveDocumentRef`-shaped starter `{ id, title, mimeType, initialContent, schema? }`, §2.4).
  - [ ] Align `canvas|artifact` vocabulary with `packages/comments/src/types.ts` (`CommentTargetKind`); NO `LiveDocumentStore`/CRDT/editor runtime (carved out to `SPEC_EVOL_CHAT_CANVAS`).
  - [ ] Lot gate:
    - [ ] `make typecheck-api ENV=test-feat-catalog-evolution-42b` + `make lint-api ENV=test-feat-catalog-evolution-42b`
    - [ ] **API tests**
      - [ ] Add `api/tests/services/catalog/canvas-template-source.spec.ts` (canvas template entry shape; list/search/get parity; no runtime pulled in).
      - [ ] Sub-lot gate: `make test-api ENV=test-feat-catalog-evolution-42b`
  - [ ] `make down ENV=test-feat-catalog-evolution-42b`

- [ ] **Lot 7 — `search_catalog` cross-kind discovery + integration**
  - [ ] Add `api/src/services/catalog/search-catalog-tool.ts`: additive `search_catalog` meta-tool returning `CatalogEntry` hits across all 5 kinds (kind in each hit); keep `search_skills` skill-only + unchanged (no rename, §3.5).
  - [ ] Wire `search_catalog` into the chat tool set alongside `search_skills`; dispatch through the execution seam.
  - [ ] Lot gate:
    - [ ] `make typecheck-api ENV=test-feat-catalog-evolution-42b` + `make lint-api ENV=test-feat-catalog-evolution-42b`
    - [ ] **API tests**
      - [ ] Add `api/tests/services/catalog/search-catalog-tool.spec.ts` (cross-kind hits with kind tag; `search_skills` contract byte-identical).
      - [ ] Update `api/tests/services/catalog-characterization.spec.ts` to assert `search_skills` is still present + skill-only.
      - [ ] Sub-lot gate: `make test-api ENV=test-feat-catalog-evolution-42b`
    - [ ] **E2E tests**
      - [ ] Prepare E2E build: `make build-api build-ui-image API_PORT=9213 UI_PORT=5413 MAILDEV_UI_PORT=1313 ENV=e2e-feat-catalog-evolution-42b`
      - [ ] Add/extend `e2e/tests/03-chat.spec.ts` coverage: a chat turn that surfaces a catalog tool via `search_catalog` resolves + executes (non-regression of `search_skills` flow).
      - [ ] Sub-lot gate: `make clean test-e2e API_PORT=9213 UI_PORT=5413 MAILDEV_UI_PORT=1313 E2E_GROUP=<matrix.e2e_group> ENV=e2e-feat-catalog-evolution-42b` (groups per `.github/workflows/ci.yml`; `ENV=` is the LAST argument)
    - [ ] non mandatory UAT (only if a behaviour-visible chat change needs human confirmation)
      - [ ] Web app: chat panel — confirm `search_skills`-first behaviour unchanged; `search_catalog` returns cross-kind hits.
  - [ ] `make down ENV=e2e-feat-catalog-evolution-42b`

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Keep `spec/SPEC_EVOL_CATALOG.md` in sync with any impl-time deviation (no separate `BRANCH_SPEC_EVOL.md` — the standalone spec already exists).
  - [ ] Record `BR42b-EX1` resolution in `## Feedback Loop`.

- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint (api): `make typecheck-api lint-api ENV=test-feat-catalog-evolution-42b`
  - [ ] Retest API (cf Lot 1): `make test-api ENV=test-feat-catalog-evolution-42b`
  - [ ] Retest E2E (cf Lot 7 groups): `make clean test-e2e API_PORT=9213 UI_PORT=5413 MAILDEV_UI_PORT=1313 E2E_GROUP=<matrix.e2e_group> ENV=e2e-feat-catalog-evolution-42b`
  - [ ] Retest AI flaky tests (non-blocking only under acceptance rule) and document pass/fail signatures here.
  - [ ] Record explicit user sign-off if any AI flaky test is accepted.
  - [ ] Bump affected `packages/<pkg>/package.json` version (semver) for every package whose `src/**` changed — enforced by CI `enforce-package-bump`. NONE expected: the catalog is fully app-local in `api/` and `@sentropic/skills` is consumed read-only (plan-review MF3), so no package `src/**` is touched.
  - [ ] Final gate step 1: create/update PR using this file's text as PR body (source of truth).
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of this file, push, and merge.

## Deferred to BR-XX
- **Google marketplace `CatalogSource`** (`GoogleMarketplaceCatalogSource`, `kind: 'marketplace'`) — DEFERRED v2 (depends on BR-43 Google provider + §15 marketplace gating). Designed in `spec/SPEC_EVOL_CATALOG.md §3.7`, NOT built here.
- **`@sentropic/catalog` package extraction** — DEFERRED follow-up (foundry reusability). v1 keeps the catalog app-local in `api/` (activate-by-real-consumption); extract once the app proves the abstraction.
- **Marketplace gating engine** (`@sentropic/marketplace`, study §15) — separate future package; out of v1.
- **Per-workspace DB-agent / DB-workflow projection** (`agent_definitions` / `workflow_definitions` rows as catalog entries) — out of v1; templates/seeds only.
- **Public HTTP catalog endpoint** — out of v1 unless the build-app CLI needs it (then a follow-up).
- **Canvas runtime** (`LiveDocumentStore`/CRDT/editors) — carved out to `SPEC_EVOL_CHAT_CANVAS`; this branch is canvas kind/template only.
