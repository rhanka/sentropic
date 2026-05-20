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
- **BR19-N1 — `@sentropic/contracts` authz alignment resolved (Lot 1 note; updated Lot 3; closed 2026-05-18)**
  - Current `@sentropic/contracts` exports `TenantContext`, `PermissionMode`, and `AuthzContext`, but the canonical `AuthzContext` is a transverse caller/tool-allowance envelope (`caller`, `allowedTools`, contract permission mode). It does not contain the skills-specific catalog filters (`tenant.workspaceType`, `roles`, `permissions`, local `open`/`allowlist` exposure mode) already used by `SkillRegistry.resolveTools()`.
  - Resolution: keep the existing `@sentropic/skills` authz API stable and add a minimal adapter in `packages/skills/src/registry/authz.ts`: `ContractTenantContext`, `ContractPermissionMode`, `ContractAuthzContext`, `ContractAuthzAdapterOptions`, and `authzContextFromContract()`.
  - Rationale: a direct re-export would break skills callers and remove BR19's role/workspace/permission filtering semantics. The adapter maps contract `caller` into the local `tenant`, converts `ReadonlySet` allowlists to arrays, keeps `granular`/`untrusted` restrictive by default, and lets downstream governance pass roles, permissions, workspace type, or an explicit local exposure mode.
  - Verification: covered by `packages/skills/tests/registry/authz.test.ts`; `make typecheck-skills ENV=test-feat-agent-sandbox-skills` and `make test-skills ENV=test-feat-agent-sandbox-skills` pass on this worktree.
- **BR19-N2 — SKILL.md asset packaging — CLOSED (2026-05-19, Wave D step 1)**
  - Resolution: `packages/skills/package.json#files` now ships `src/bundles/**/*.md` AND `dist/bundles/**/*.md` AND `dist/**/*.{js,d.ts}` (in addition to `README.md` / `LICENSE`). Both workspace mode (parser reads from `src/bundles/.../SKILL.md` via `import.meta.url`) and any future `dist/`-published consumer continue to find the asset. No new Make target and no `BR19-EX` declared (BR19-EX4 untouched).
  - Verification: `make test-skills ENV=test-feat-agent-sandbox-skills` 99/99 green on the closing commit.
  - Closes: per BR19-D5 timing decision.

- **BR19-N3 — `caller.templateRenderer` adapter introduced (2026-05-20, Wave D step 1.C)**
  - Context: `document_generate` template DOCX sub-path (`action=generate && format=docx && templateId != null`) routes to legacy `generateDocxForEntity` (in `api/src/services/docx-generation.ts`) which loads workspace/initiative/folder records from the DB and renders an in-template Word document. `@sentropic/skills` MUST NOT import API/DB code, so the legacy function cannot be ported into the bundle.
  - Resolution: introduce a thin injected adapter `TemplateRenderer` (in `packages/skills/src/types/adapters.ts`) with `renderTemplate(args): Promise<{ buffer, fileName, mimeType }>` mirroring the existing `DocxGenerateRequest` shape (templateId, entityType, entityId, workspaceId, optional provided/controls/locale). The bundle handler calls `caller.templateRenderer.renderTemplate(...)`; if `caller.templateRenderer == null`, throws a clear deferred-binding error.
  - Wire-up: deferred to BR19-D3 (Wave D closing rebind) — chat-service will provide the adapter wrapping `generateDocxForEntity`, then delete `tools.ts` legacy dispatch.
  - Impact: pure interface addition in `packages/skills/src/types/`; no runtime DB knowledge in the package.

- **BR19-D1 — Persistence decision (Lot 3 outcome, BR19-Q6)**
  - Decision: in-memory `SkillRegistry` is sufficient for v0.1. No `skill_metadata` Postgres table is added in this branch; **no `BR19-EX1` is declared** and `api/drizzle/*.sql` is not touched.
  - Rationale: (1) Lot 5 (`tools.ts` migration) only needs runtime registration of built-in skills at API boot — no DB lookup required. (2) Marketplace audit + admin UI listing — the use cases that would justify a `skill_metadata` table — are out of scope (BR-27 / BR-19b). (3) The `SkillRegistry` interface is unchanged regardless of backing store, so a future `PgSkillRegistry` is a drop-in adapter with no breaking change.
  - Rollback: if a downstream branch (BR-27) needs persistence, declare `BR19b-EX1` then and ship one Drizzle migration there; this branch leaves no schema obligation.

- **BR19-D2 — PR draft sync discipline (2026-05-19)**
  - Decision: PR #166 draft already open and CI-green; keep `gh pr edit --body-file BRANCH.md` after EACH BRANCH.md update so PR body never drifts from the source of truth.
  - Rationale: workflow rule mandates PR body = exact BRANCH.md text. GitHub does NOT auto-sync; manual `gh pr edit` is required.
  - Action: every push that touches BRANCH.md → follow-up `gh pr edit 166 --body-file BRANCH.md`.

- **BR19-D3 — Atomic rebind in single Wave D closing commit (2026-05-19)**
  - Decision: bind all foundation skills handlers + remove legacy `if toolCall.name === '...'` dispatch + delete `tools.ts` in one closing commit (split into 2 sub-commits ONLY if >150 lines: bind-all then delete-legacy, both in the same push).
  - Rationale: master rule "no legacy fallback / zero dual paths" forbids progressive rebind with fallback.

- **BR19-D4 — Wave D order: document_generate first (2026-05-19)**
  - Decision: implement `document_generate` (port docx-freeform) FIRST in Wave D, then `batch_create_organizations`, then `task_dispatch`.
  - Rationale: forces sandbox runtime end-to-end + BR19-N2 packaging surface early.

- **BR19-D5 — BR19-N2 closure timing: start of Wave D (2026-05-19)**
  - Decision: resolve SKILL.md packaging in dist/ at the start of Wave D, before `document_generate`. Preferred impl: `package.json#files` glob (no new make target, no BR19-EX touch).
  - Closes: BR19-N2.

- **BR19-Q7 — `document_generate` port — sandbox-invocation pattern ambiguity (2026-05-19, BLOCKING Wave D step 1)**
  - Context: Launch packet (Wave D step 1) instructs to "port `api/src/services/docx-freeform-skill.ts`" into a sandbox-backed `document_generate` foundation skill whose handler calls `SandboxRuntime.execute(...)` (Lot 2 isolated-vm runtime).
  - Evidence gathered:
    1. `api/src/services/docx-freeform-skill.ts` is a TEXT curriculum string (`getDocxFreeformSkill(): string`) returned by chat-service when `args.action === 'upskill' && format === 'docx'`. It is NOT executable sandbox code and has no callable handler shape.
    2. The actual sandboxed execution for `document_generate` lives in `api/src/services/docx-generation.ts` → `generateFreeformDocx(request)`, which uses `node:vm` (`vm.createContext` + `script.runInContext`), NOT `isolated-vm`, and injects `getSandboxGlobals(contextData)` (helpers `doc`/`h`/`p`/`list`/`table`/etc. + raw `docx` classes + `Document`/`Packer` from `docx`). PPTX has a parallel `generateFreeformPptx` in `pptx-generation.ts`.
    3. The tool descriptor (`api/src/services/tools.ts:859` `documentGenerateTool`) declares a DUAL-MODE skill: `action: 'upskill' | 'generate'`, `format: 'docx' | 'pptx'`, sub-modes `templateId` (DOCX only) vs `code` (freeform, mutually exclusive). `chat-service.ts:4733-4920+` switches on these modes to call `getDocxFreeformSkill()` (upskill DOCX), `getPptxFreeformSkill()` (upskill PPTX), `generateFreeformDocx()` (generate DOCX freeform), `generateFreeformPptx()` (generate PPTX freeform), or template-based DOCX generators (`generateInitiativeDocx`, `generateExecutiveSynthesisDocx`).
  - Ambiguity:
    - Option A — port curriculum only: the new `document_generate` skill wraps `getDocxFreeformSkill()` (and `getPptxFreeformSkill()`) as the `body` / a tool output. Handler is a thin pass-through for the upskill branch and routes the generate branch back into legacy api helpers — does NOT exercise `SandboxRuntime.execute` end-to-end, breaks the packet's "FIRST handler-bound skill / exercises sandbox runtime end-to-end" goal and the BR19-D4 rationale ("forces sandbox runtime end-to-end").
    - Option B — port sandbox machinery to `SandboxRuntime` (isolated-vm): rewrite the freeform DOCX/PPTX runtime on top of `packages/skills/src/sandbox/runtime.ts`. Requires: (i) exposing the docx helpers (`doc`, `h`, `p`, `list`, `table`, `pageBreak`, `hr` + raw `docx` classes) inside isolated-vm — non-trivial because `docx`/`pptxgenjs` are large modules with classes that must be reachable from inside the isolate (the current `SandboxApiSurface` only exposes `files.create`/`db.query`/`fetch`); (ii) replacing `Document instanceof` validation with a host-side hand-off (file artefact via `files.create`); (iii) rebuilding the PPTX path symmetrically. This is a multi-commit redesign with significant risk to UAT semantics — not "≤150 lines".
    - Option C — port a NARROWER scope: ship `document_generate` as a sandbox-backed skill where `args.code` is the body and the sandbox returns a serialisable docx-AST that the HOST packs to a Buffer via `Packer.toBuffer` (Document construction stays in-host through `files.create` adapter). Closer to BR-19 §1.1 surface-allowlist intent but still requires designing the docx-AST contract from scratch (~ multi-PR design effort).
  - Out-of-scope deletions confirmed: per launch packet, `api/src/services/docx-freeform-skill.ts` deletion + chat-service rebind belong to the Wave D closing commit (BR19-D3), NOT this Wave D step 1.
  - Question to conductor: which option (A, B, or C — or a different framing) does Wave D step 1 actually intend? In particular, is `document_generate` allowed to keep `node:vm` semantics through a thin handler that calls back into `api/src/services/docx-generation.ts` (Option A+), or must Wave D step 1 strictly migrate the freeform runtime onto `SandboxRuntime` (Option B)?
  - Action taken this run: STOPPED Unit 3 (no `document_generate` bundle created, no Unit 4 BRANCH.md tick, no Unit 5 push). BR19-F1 flaky record (Unit 1) and BR19-N2 packaging closure (Unit 2) are committed because they are independent of this ambiguity.
  - **Resolution (2026-05-19, conductor decision)**: Option B — full V8 port of `generateFreeformDocx` (DOCX freeform) onto `SandboxRuntime`. PPTX + upskill curriculum + template renderers deferred to Wave D Step 1.B/1.C. Byte-stability vs legacy preserved as hard acceptance criterion. Closing rebind (BR19-D3) deletes `api/src/services/docx-generation.ts` legacy in Wave D closing commit.
  - **Rationale**: PLAN.md L188 ("V8 sandbox for tool execution + skill catalog") requires at least one production-bound handler exercising `SandboxRuntime.execute` end-to-end in BR19. `document_generate` (freeform DOCX) is the canonical use case.

- **BR19-Q8 — Wave D Step 1.A blocker — `docx` runtime dependency required by host-bridge but out of allowed paths (2026-05-19, BLOCKING Wave D step 1.A)**
  - Context: BR19-Q7 was resolved Option B (full V8 port of `generateFreeformDocx` onto `SandboxRuntime`). The launch packet for Wave D Step 1.A lists 8 allowed paths: `packages/skills/src/sandbox/runtime.ts`, `packages/skills/src/sandbox/docx-host-bridge.ts` (new), `packages/skills/src/bundles/foundation/document_generate/{handler.ts,index.ts,SKILL.md}` (new), `packages/skills/src/bundles/foundation/index.ts`, `packages/skills/tests/sandbox/docx-host-bridge.test.ts` (new), `packages/skills/tests/bundles/foundation.test.ts`, `packages/skills/tests/bundles/document_generate.test.ts` (new), `BRANCH.md`. Out of scope: "all docker-compose, all Makefile". `packages/skills/package.json` is neither listed in allowed nor forbidden.
  - Evidence gathered:
    1. The new `docx-host-bridge.ts` MUST import the real `docx` library (`Document`, `Packer`, `Paragraph`, `Table`, `TextRun`, `HeadingLevel`, `convertInchesToTwip`, `BorderStyle`, etc.) to (a) reproduce the legacy `getSandboxGlobals` helpers (`doc`/`h`/`p`/`list`/`table`/`pageBreak`/`hr`) host-side and (b) call `Packer.toBuffer` on the host. Byte-stability vs legacy `generateFreeformDocx` is the hard acceptance criterion; reproducing the exact helper output requires `docx@9.5.1` (the version `api/package.json` pins at line 55).
    2. `packages/skills/package.json` currently declares only `gray-matter@4.0.3`, `isolated-vm@6.1.2`, `zod@3.23.8` as runtime deps. No `docx`. The byte-stability test (`packages/skills/tests/bundles/document_generate.test.ts`) cannot import `docx` without a package.json entry.
    3. The skills Make targets (`typecheck-skills` line 568, `test-skills` line 646 of `Makefile`) bake the dependency list inline as `npm install ... gray-matter@4.0.3 zod@3.23.8 isolated-vm@6.1.2`. They do NOT read from `package.json#dependencies`. Adding `docx@9.5.1` to `package.json` alone has zero effect on `make typecheck-skills` / `make test-skills` — the inline list must also be updated for the import to resolve.
    4. The repo workspace (`workspaces: ["api", "ui", "packages/*"]` at root `package.json`) does NOT hoist `docx` to `node_modules/docx` at the repo root in a way the per-test Docker tool_dir would pick up — the make targets explicitly `--no-save --no-audit --no-fund` install into a fresh `tool_dir`.
  - Architectural impact:
    - The bridge pattern (host-side helpers + `ivm.Reference` exposure to isolate, host-side `Packer.toBuffer`) is achievable from `isolated-vm`'s API surface (`Reference` supports async function-call proxies, and `ExternalCopy` handles structured-clone payloads). The pattern is NOT the blocker.
    - The blocker is the runtime dependency footprint: bringing `docx` into `@sentropic/skills` requires:
      - `packages/skills/package.json` — add `"docx": "^9.5.1"` to `dependencies` (file NOT in allowed-paths list; status unclear).
      - `Makefile` — append `docx@9.5.1` to the inline install lists of `typecheck-skills` and `test-skills` (file EXPLICITLY in "Out of scope: … all Makefile" of the launch packet AND in `BRANCH.md` Forbidden Paths line 33).
  - Options:
    - **Option B1** — expand the launch packet to include `packages/skills/package.json` + invoke a new `BR19-EX5` ("Makefile additive — append `docx@9.5.1` to skills install lists for V8-bound freeform DOCX bridge"). Single Makefile delta, one-line per target, additive only, identical pattern to BR19-EX4. Adds ~3 lines to Makefile. Adds 1 line to `packages/skills/package.json`. Same delta would be needed eventually for PPTX (Step 1.B) — paying it now keeps the closing commit smaller.
    - **Option B2** — split the `docx` library into a host-injected `DocxHelpersBridge` interface declared in `packages/skills/src/sandbox/docx-host-bridge.ts`, where the helpers (`doc`/`h`/`p`/etc.) accept a typed `DocxFactory` parameter that the API layer constructs at boot. `@sentropic/skills` ships only the bridge interface + glue code; the real `docx` import lives in the API workspace (e.g. `api/src/services/docx-bridge-factory.ts`). Tests in `@sentropic/skills` use a deterministic mock `DocxFactory` for unit assertions, but byte-stability vs legacy CANNOT be verified from `@sentropic/skills/tests/**` because `docx` isn't there. Byte-stability test would have to live in `api/tests/services/skills/document-generate.spec.ts` (NOT in the 8 allowed paths; would need scope expansion regardless).
    - **Option B3** — defer Wave D Step 1.A to a follow-up sub-step "Step 1.A-0 — package wiring" that ONLY adds `docx` to `packages/skills/package.json` + Makefile under a clean `BR19-EX5`, no implementation; then Step 1.A proper proceeds in the next run with the runtime dep already in place. Cleanest split, smallest commits, but adds one orchestration round-trip.
  - Recommendation: Option B1 — expand the current launch packet's allowed-paths list to include `packages/skills/package.json` and declare `BR19-EX5` for the additive `docx@9.5.1` line in `Makefile`'s `typecheck-skills` + `test-skills` targets. Rationale: the dep is unavoidable for byte-stability; Step 1.B (PPTX) will need the same delta plus `pptxgenjs`; paying it now keeps the closing rebind commit (BR19-D3) atomic. Estimated incremental risk: 3 lines in Makefile (identical pattern, no logic change, no behaviour drift for any other package); 1 line in `packages/skills/package.json`.
  - Action taken this run: STOPPED Wave D Step 1.A (no `docx-host-bridge.ts` created, no `document_generate` bundle, no tests, no push). BR19-Q7 resolution is recorded above per launch packet Unit 1; no other unit committed. Awaiting conductor decision on option B1/B2/B3.
  - **Resolution (2026-05-19, conductor decision)**: Option B1 — add `docx@9.5.1` as a dependency of `@sentropic/skills`, expand Allowed Paths to include `packages/skills/package.json` and `Makefile`. The Makefile delta is purely additive (extend the inline `npm install` list in `typecheck-skills` + `test-skills` targets only) and is covered by `BR19-EX5` declared below.
  - **Rationale**: The V8 sandbox host bridge must execute `docx` library calls host-side (helpers reproduce `getSandboxGlobals` parity + `Packer.toBuffer`). Option B2 (DocxFactory injection from api/) would require equivalent scope expansion to put byte-stability tests in `api/tests/services/skills/`, with the added cost of designing an injection contract that buys nothing semantically. Option B3 (separate wiring sub-step) doubles orchestration overhead for no technical gain.

- **BR19-EX5 — Makefile (additive only, Wave D step 1.A)**
  - Reason: `@sentropic/skills` Wave D V8 port of freeform DOCX/PPTX needs `docx` (and later `pptxgenjs`) installed in the containerised typecheck/test targets. The `Makefile` `typecheck-skills` and `test-skills` targets hardcode their `npm install` list inline (they do NOT read `package.json#dependencies`), so the dep is added in two places: (a) `packages/skills/package.json#dependencies` (source of truth), and (b) the inline list of both Makefile targets.
  - Impact: additive only — no edits to existing targets' command shape, no changes to other targets' behaviour. Two lines edited.
  - Rollback: remove `docx@9.5.1` from the two inline lists; revert `package.json` add.

- **BR19-EX6 — `api/Dockerfile` (additive only, Wave D step 1.A fix)**
  - Reason: Wave D Step 1.A added `docx@9.5.1` as a dependency of `@sentropic/skills` (BR19-EX5). The root `package.json` declares `"workspaces": ["api", "ui", "packages/*"]`, so `npm ci --workspaces` at Docker build time expects all workspace manifests to be available. `api/Dockerfile` currently COPYs only the `api/`, `ui/`, and `packages/llm-mesh/` package.json files before `npm ci`; the missing `packages/skills/package.json` corrupts the workspace install when `docx` is in the lockfile but the manifest isn't present, degrading runtime module resolution and breaking E2E `03-chat.spec.ts:203` recurrently on `0794fdf0` (2 fails after rerun).
  - Impact: additive only — ONE new `COPY packages/skills/package.json ./packages/skills/package.json` line, inserted immediately after the existing llm-mesh COPY and before `RUN ... npm ci --workspaces`. No other Dockerfile edits, no behaviour change for other workspaces.
  - Rollback: delete the one new COPY line.

- **BR19-F1 — AI test flaky accepted on `b4128c1a` (2026-05-19)**
  - Command: GitHub Actions matrix job `test-api-unit-integration (ai, initiative-generation-async,executive-summary-sync)` (equivalent local: `make test-api-ai ENV=test-feat-agent-sandbox-skills` scoped to `initiative-generation-async,executive-summary-sync`).
  - Failed run: https://github.com/rhanka/sentropic/actions/runs/26117075967/job/76809528377 (commit `b4128c1a`).
  - Re-run on same commit: PASS. Per BR19 AI Flaky acceptance rule (non-systematic = at least one success on same commit + same command), accepted as flaky.
  - Wave C Step 3 diff scope: only `packages/skills/src/bundles/foundation/{documents,comment_assistant,plan}/**` + `packages/skills/tests/bundles/foundation.test.ts`. No code path overlap with `initiative-generation-async` or `executive-summary-sync` execution paths — flakiness is provider/model nondeterminism unrelated to BR19.
  - Sign-off required before merge (Lot 9).

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
  - [x] Implement `SKILL.md` parser (frontmatter YAML + body extraction) in `src/format/parser.ts` with strict schema validation (Zod).
  - [x] Re-export shared types from `@sentropic/contracts` where applicable (no circular dep).
  - [x] Lot gate: typecheck + unit tests on parser (valid/invalid frontmatter, missing fields, malformed YAML).

- [x] **Lot 2 — Sandbox runtime integration**
  - [x] Implement `SandboxRuntime` port in `src/sandbox/runtime.ts` with `isolated-vm` adapter (decision frozen in SPEC_EVOL §2).
    - [x] Step 1: scaffold port + resolved-policy enforcement + `isolated-vm@6.1.2` dep.
    - [x] Step 2: API-surface wrappers (`files.create`, `db.query`, `fetch`).
    - [x] Step 3: `execute()` body + unit tests (11 cases passing).
  - [x] Implement `SandboxPolicy` enforcement: timeout (default 30s), memory cap (128MB), API-surface allowlist (`files.create`, `db.query`, `fetch` only).
  - [ ] Carry forward the docx-freeform sandbox helpers into a built-in skill bundle as reference implementation (deferred to Lot 5 Wave D — `documents` bundle).
  - [x] Lot gate: typecheck + unit tests (isolation breach attempts, timeout, memory cap, allowlist enforcement). 23/23 green via `make test-skills`.

- [x] **Lot 3 — `SkillRegistry` (catalog + filter + resolve)**
  - [x] Implement `SkillRegistry` (`register`, `list`, `get`, `search`) backed by in-memory map (Step 1).
  - [x] Implement `resolveTools(authz)` with `AuthzContext` filtering — roles, workspace types, permission mode (Step 2).
  - [x] Implement `SkillsToolRegistry` that adapts `SkillRegistry` to the `ToolRegistry` interface (locally declared until `@sentropic/contracts` exists — see BR19-N1) (Step 3).
  - [x] Persistence decision (BR19-Q6): in-memory only — no `skill_metadata` table. No `BR19-EX1` declared. See `## Feedback Loop` BR19-D1.
  - [x] Lot gate: typecheck + unit tests — 32/32 green for Lot 3 (registry 14 + resolve 12 + adapter 6); 55/55 across the package.

- [x] **Lot 4 — `search_skills` meta-tool**
  - [x] Implement `search_skills(query, context)` callable as a tool: top-K skills by description match (BM25 or embedding-light heuristic — frozen in SPEC_EVOL §5).
  - [x] Auto-register `search_skills` in any `SkillsToolRegistry` instance.
  - [x] Lot gate: typecheck + unit tests (top-K behaviour, context filtering applied before ranking, empty result). 67/67 green via `make test-skills` (12 Lot 4 cases: 9 in `search-skills-tool.test.ts` + 3 in `adapter.test.ts`).

- [ ] **Lot 5 — Migrate `tools.ts` to skill bundles (waves)**
  - [ ] Migrate **wave A** (low-risk listers): `web` skill (`web_search`, `web_extract`), `workspace` skill (`workspace_list`, `initiative_search`).
    - [x] Step 1 — foundation bundle scaffold + `workspace` skill (`workspace_list`, `initiative_search`) via `packages/skills/src/bundles/foundation/` + `registerFoundationSkills(registry)` registrar. 9 new tests; `make test-skills` 76/76 green. Handlers ship as `not bound` guards: legacy `api/src/services/tools.ts` still drives execution until `chat-service` is rebound (deferred to Lot 5 final cleanup commit).
    - [x] Step 2 — `web` skill (`web_search`, `web_extract`) added to foundation bundle.
  - [x] Migrate **wave B** (read-only object skills): `organizations`, `folders`, `initiatives`, `solutions`, `proposals`, `products` skills (each grouping `list`+`get`+optional `update`).
    - [x] Step 1 — `organizations`, `folders`, `initiatives` foundation object skills added as metadata bundles with not-bound handler guards. 9 tools registered; `make typecheck-skills ENV=test-feat-agent-sandbox-skills` and `make test-skills ENV=test-feat-agent-sandbox-skills` pass.
    - [x] Step 2 — `solutions`, `proposals`, `products` foundation object skills.
  - [ ] Migrate **wave C** (write/structured skills): `executive_summary`, `matrix`, `documents`, `comment_assistant`, `plan`, `gate_review`, `history_analyze` skills.
    - [x] Step 1 — package-only first sub-lot: `executive_summary` + `matrix` foundation skills added under `packages/skills/src/bundles/foundation/` with legacy `api/src/services/tools.ts` schemas and `not bound` handler guards only. 4 tools registered; API/chat-service rebind remains deferred. `make typecheck-skills ENV=test-feat-agent-sandbox-skills` and `make test-skills ENV=test-feat-agent-sandbox-skills` pass.
    - [x] Step 2 — package-only second sub-lot: `history_analyze` + `gate_review` foundation skills added under `packages/skills/src/bundles/foundation/` with legacy `api/src/services/tools.ts` schemas and `not bound` handler guards only. 2 tools registered; `history_analyze` remains base/cross-workspace while `gate_review` stays filtered to `ai-ideas` and `opportunity`. API/chat-service rebind remains deferred.
    - [x] Step 3 — package-only third sub-lot: `documents` + `comment_assistant` + `plan` foundation skills added under `packages/skills/src/bundles/foundation/` with legacy `api/src/services/tools.ts` schemas and `not bound` handler guards only. 3 tools registered; API/chat-service rebind remains deferred. `make typecheck-skills ENV=test-feat-agent-sandbox-skills` and `make test-skills ENV=test-feat-agent-sandbox-skills` pass.
  - [ ] Migrate **wave D** (sandbox-backed skills): `document_generate` (uses sandbox, ports the docx-freeform skill), `batch_create_organizations`, `task_dispatch`.
    - [x] Step 1.A — V8 port of `generateFreeformDocx` onto `SandboxRuntime` via `docx-host-bridge` (host-side `Packer.toBuffer`, isolate-side helper API parity with legacy `getSandboxGlobals`). `document_generate` foundation bundle registered with BOUND handler for `action=generate && format=docx` freeform code path; other sub-paths throw deferred-error (Step 1.B PPTX, Step 1.C upskill + template). Byte-stability vs legacy verified via structural ZIP-entry comparison (`docProps/core.xml` excluded because the `docx` lib stamps it with the current wall clock — legacy already differs across two runs). `docx@9.5.1` added as dep (BR19-EX5). 23 new tests across `docx-host-bridge.test.ts` (9), `document_generate.test.ts` (10), and `foundation.test.ts` (4 + extended existing assertions); 121/121 `make test-skills ENV=test-feat-agent-sandbox-skills` and `make typecheck-skills ENV=test-feat-agent-sandbox-skills` pass.
    - [x] Step 1.B — V8 port of `generateFreeformPptx` onto `SandboxRuntime` via `pptx-host-bridge` (symmetric with Step 1.A DOCX bridge). `document_generate` handler now binds `action=generate && format=pptx && code != null` to the V8 sandbox path; the corresponding deferred-error guard removed. `upskill` modes + `generate template docx` remain deferred to Step 1.C. `pptxgenjs@^4.0.1` added as dep (covered by BR19-EX5; Makefile inline lists extended in `typecheck-skills` + `test-skills`). PPTX byte-stability vs legacy `generateFreeformPptx` verified via structural ZIP-entry comparison (`docProps/core.xml` + `docProps/app.xml` excluded as PptGenJS wall-clock timestamps; legacy already differs across two runs). 14 new tests across `pptx-host-bridge.test.ts` (9) and `document_generate.test.ts` (3 bound-path + 2 byte-stability); 135/135 `make test-skills ENV=test-feat-agent-sandbox-skills` and `make typecheck-skills ENV=test-feat-agent-sandbox-skills` pass.
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
