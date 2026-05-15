# Feature: BR-19 — @sentropic/skills (Skill Catalog + Sandbox)

## Objective
Ship `@sentropic/skills` package — skill catalog, sandbox runtime, description-based discovery, `SKILL.md` format, MCP export — and migrate the ~30 entries of `api/src/services/tools.ts` into skill bundles consumed by `@sentropic/chat-core` through the federated `ToolRegistry`.

## Scope / Guardrails
- Scope limited to `packages/skills/**`, skill seed data, `api/src/services/skills/**` integration, and `api/src/services/tools.ts` migration only.
- One migration max in `api/drizzle/*.sql` (only if `skill_metadata` table is needed; Lot 3 to decide).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/entropiq` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-agent-sandbox-skills`.
- Automated test campaigns must run on `ENV=test-feat-agent-sandbox-skills` / `ENV=e2e-feat-agent-sandbox-skills`, never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Identity: BR-19, branch `feat/agent-sandbox-skills`, worktree `tmp/feat-agent-sandbox-skills`, base `origin/main` (a7541823), ENV alias `test-feat-agent-sandbox-skills`, slot 0 (API 9095, UI 5295, Maildev 1195).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `spec/SPEC_EVOL_BR19_SKILLS.md`
  - `spec/SPEC_VOL_AGENT_SANDBOX_SKILLS.md` (consolidation only at Lot N-1)
  - `packages/skills/**` (new package root)
  - `api/src/services/skills/**` (new integration layer)
  - `api/src/services/tools.ts` (migration target, eventual deletion)
  - `api/src/services/tool-service.ts` (handler migration target)
  - `api/src/services/chat-service.ts` (tool dispatch refactor — Lot N migration only)
  - `api/src/config/default-skills.ts` (new, built-in skills seed)
  - `api/tests/services/skills/**` (new tests)
  - `api/tests/api/skills.spec.ts` (new tests)
  - `package.json` (workspace registration only)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file in Lot N-1)
  - `ui/**` (skill output viewer deferred to BR-19b)
  - `api/src/services/queue-manager.ts` (deferred to BR-19c)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file, only if `skill_metadata` table — declare `BR19-EX1`)
  - `packages/contracts/**` (only to add `Skill`/`SkillMetadata` re-exports — declare `BR19-EX2`)
  - `.github/workflows/**` (only to add packages/skills CI job — declare `BR19-EX3`)
  - `api/src/db/schema.ts` (only paired with `BR19-EX1`)
- **Exception process**:
  - Declare exception ID `BR19-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- **BR19-EX4 — Makefile (additive only, Lot 1+)**
  - Reason: `@sentropic/skills` requires its own `typecheck-skills` and `test-skills` Make targets so that the package can satisfy the Make-Only mandate (host Docker calls are forbidden). Targets must mirror the existing `typecheck-llm-mesh` / `test-llm-mesh` pattern.
  - Impact: additive only — no edits to existing targets, no behaviour change for other packages. Limited to two new `.PHONY` targets and one shared image variable reuse (`LLM_MESH_NODE_IMAGE`).
  - Rollback: delete the two new targets in a single revert commit; no downstream consumer outside this branch.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: single skill catalog package + linear migration through tools.ts (~30 tools); each lot is sequentially gated by the previous (sandbox before discovery before migration). No independent CI cycle required.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT after Lot 5 (search_skills meta-tool integration) and at Final Lot, when chat-service uses the catalog end-to-end.
- UAT checkpoints listed as checkboxes inside Lot 5 and Final Lot.
- Execution flow: develop+test in `tmp/feat-agent-sandbox-skills`, push, UAT from root workspace, switch back.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Scoping (this lot)**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `plan/BRANCH_TEMPLATE.md`.
  - [x] Read `plan/19-BRANCH_feat-agent-sandbox-skills.md` (stub), `spec/SPEC_VOL_AGENT_SANDBOX_SKILLS.md`, `SPEC_STUDY_SKILLS_TOOLS_VS_AGENT_MARKETPLACE.md`, `SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md` §1+§5+§14+§15, `SPEC_VOL_SKILLS.md`.
  - [x] Inventory `api/src/services/tools.ts` (~30 entries) and `docx-freeform-skill.ts` reference pattern.
  - [x] Create worktree `tmp/feat-agent-sandbox-skills` from `origin/main` on branch `feat/agent-sandbox-skills`.
  - [x] Produce `spec/SPEC_EVOL_BR19_SKILLS.md` covering SKILL.md format, sandbox runtime decision, `SkillRegistry` interface, migration plan, `search_skills` meta-tool, MCP export, distribution, marketplace/chat-core boundaries, open questions.
  - [x] Confirm slot 0 port assignment: API `9095`, UI `5295`, Maildev `1195` (BR-19 → `9000 + 19*5 + 0 = 9095`).
  - [x] Commit scoping artefacts via `make commit`.

- [ ] **Lot 1 — `@sentropic/skills` package shell + `SKILL.md` parser**
  - [x] Create `packages/skills/` workspace entry with `package.json`, `tsconfig.json`, `vitest.config.ts` aligned with `packages/llm-mesh`.
  - [x] Define `Skill`, `SkillMetadata`, `ContextFilter`, `SandboxPolicy`, `SkillTool`, `SkillSearchHit` types in `src/types/`.
  - [ ] Implement `SKILL.md` parser (frontmatter YAML + body extraction) in `src/format/parser.ts` with strict schema validation (Zod).
  - [ ] Re-export shared types from `@sentropic/contracts` where applicable (no circular dep).
  - [ ] Lot gate: typecheck + unit tests on parser (valid/invalid frontmatter, missing fields, malformed YAML).

- [ ] **Lot 2 — Sandbox runtime integration**
  - [ ] Implement `SandboxRuntime` port in `src/sandbox/runtime.ts` with `isolated-vm` adapter (decision frozen in SPEC_EVOL §2).
  - [ ] Implement `SandboxPolicy` enforcement: timeout (default 30s), memory cap (128MB), API-surface allowlist (`files.create`, `db.query`, `fetch` only).
  - [ ] Carry forward the docx-freeform sandbox helpers into a built-in skill bundle as reference implementation.
  - [ ] Lot gate: typecheck + unit tests (isolation breach attempts, timeout, memory cap, allowlist enforcement).

- [ ] **Lot 3 — `SkillRegistry` (catalog + filter + resolve)**
  - [ ] Implement `SkillRegistry` (`register`, `list`, `get`, `search`, `resolveTools(authz)`) backed by in-memory map; in-memory ref adapter mandatory.
  - [ ] Implement `SkillsToolRegistry` that adapts `SkillRegistry` to the `ToolRegistry` interface from `@sentropic/contracts`.
  - [ ] Wire `AuthzContext` filtering (roles, workspace types, permission mode).
  - [ ] Decide on optional `skill_metadata` table (defer to Lot 3 outcome; if needed declare `BR19-EX1`).
  - [ ] Lot gate: typecheck + unit tests (filter by role, workspace, search ranking, resolve under AuthzContext).

- [ ] **Lot 4 — `search_skills` meta-tool**
  - [ ] Implement `search_skills(query, context)` callable as a tool: top-K skills by description match (BM25 or embedding-light heuristic — frozen in SPEC_EVOL §5).
  - [ ] Auto-register `search_skills` in any `SkillsToolRegistry` instance.
  - [ ] Lot gate: typecheck + unit tests (top-K behaviour, context filtering applied before ranking, empty result).

- [ ] **Lot 5 — Migrate `tools.ts` to skill bundles (waves)**
  - [ ] Migrate **wave A** (low-risk listers): `web` skill (`web_search`, `web_extract`), `workspace` skill (`workspace_list`, `initiative_search`).
  - [ ] Migrate **wave B** (read-only object skills): `organizations`, `folders`, `initiatives`, `solutions`, `proposals`, `products` skills (each grouping `list`+`get`+optional `update`).
  - [ ] Migrate **wave C** (write/structured skills): `executive_summary`, `matrix`, `documents`, `comment_assistant`, `plan`, `gate_review`, `history_analyze` skills.
  - [ ] Migrate **wave D** (sandbox-backed skills): `document_generate` (uses sandbox, ports the docx-freeform skill), `batch_create_organizations`, `task_dispatch`.
  - [ ] Refactor `api/src/services/chat-service.ts` tool dispatch to consume `SkillsToolRegistry.resolveTools(authz)`; delete the legacy `if toolCall.name === '...'` branches in one cleanup commit.
  - [ ] Delete `api/src/services/tools.ts` after final wave (`no legacy fallback` rule).
  - [ ] Lot gate (per wave): typecheck + unit tests + scoped API test (`make test-api-<suite> SCOPE=tests/services/skills/<wave>.spec.ts ENV=test-feat-agent-sandbox-skills`).

- [ ] **Lot 6 — MCP server export (interop)**
  - [ ] Implement `interop/mcp-export.ts` compiling one skill to one MCP server bundle (stdio + HTTP transports).
  - [ ] Document `mcp.so` publish workflow (manual for v0.1, deferred to release tooling).
  - [ ] Lot gate: typecheck + unit tests (round-trip skill ↔ MCP tool descriptor).

- [ ] **Lot 7 — Tests (full pyramid)**
  - [ ] Lot gate:
    - [ ] `make typecheck-api` + `make lint-api`
    - [ ] **API tests**
      - [ ] Add `api/tests/services/skills/registry.spec.ts`, `parser.spec.ts`, `sandbox.spec.ts`, `discovery.spec.ts`.
      - [ ] Add `api/tests/services/skills/migration-wave-<a|b|c|d>.spec.ts` (non-regression vs prior tools).
      - [ ] Add `api/tests/api/skills.spec.ts` if HTTP surface exists (deferred decision in Lot 3).
      - [ ] Sub-lot gate: `make test-api ENV=test-feat-agent-sandbox-skills`
      - [ ] AI flaky tests run: `make test-api-ai ENV=test-feat-agent-sandbox-skills`
    - [ ] **UI tests (TypeScript only)** — N/A (UI not in scope; deferred to BR-19b)
    - [ ] **E2E tests**
      - [ ] Prepare E2E build: `make build-api build-ui-image API_PORT=9095 UI_PORT=5295 MAILDEV_UI_PORT=1195 ENV=e2e-feat-agent-sandbox-skills`
      - [ ] Update `e2e/tests/03-chat*.spec.ts` assertions: tool calls now go through `execute_skill` indirection (or stay direct — Lot 5 frozen behaviour).
      - [ ] Sub-lot gate: `make clean test-e2e API_PORT=9095 UI_PORT=5295 MAILDEV_UI_PORT=1195 ENV=e2e-feat-agent-sandbox-skills E2E_GROUP=<matrix.e2e_group>`

- [ ] **Lot 8 — Docs consolidation**
  - [ ] Integrate `spec/SPEC_EVOL_BR19_SKILLS.md` into `spec/SPEC_VOL_AGENT_SANDBOX_SKILLS.md` (final form) + cross-link from `spec/SPEC_VOL_LLM_MESH.md` adjacent specs.
  - [ ] Delete `spec/SPEC_EVOL_BR19_SKILLS.md` after integration.

- [ ] **Lot 9 — Final validation**
  - [ ] Typecheck & Lint (`make typecheck-api lint-api`)
  - [ ] Retest API (copy Lot 7 checklist)
  - [ ] Retest e2e (copy Lot 7 checklist)
  - [ ] Retest AI flaky tests and document signatures.
  - [ ] Record explicit user sign-off if any AI flaky test is accepted.
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` text as PR body.
  - [ ] Final gate step 2: run/verify branch CI and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI both `OK`, commit removal of `BRANCH.md`, push, merge.

## Deferred to follow-up branches
- **BR-19b** — UI surface (`SkillOutputViewer.svelte`, ChatPanel TOOL_TOGGLES → skill categories mapping, inline file preview).
- **BR-19c** — `queue-manager.ts` skill-based dispatch + workflow integration.
- **BR-27** — `@sentropic/marketplace` (policy/audit/RBAC overlay consulting `SkillsToolRegistry`).
- **BR-15** — spectral-generated tools registering as skills (depends on BR-19 done).
