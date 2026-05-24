# SPEC_VOL — Agent Sandbox & Skill Catalog

Status: Consolidated implementation spec after BR-19. PR #166 delivered the first production slice of the skill catalog and sandboxed foundation execution. Future marketplace, MCP export, and personal/shared skill capitalization are deferred to BR-19B.

## 1. Scope delivered by BR-19

BR-19 introduces `@sentropic/skills` as the reusable package boundary for skills, skill metadata, registry/search, authorization filtering, sandbox execution, and foundation skill bundles.

Delivered surfaces:

- `packages/skills`: reusable package with core types, strict `SKILL.md` parsing, registry/search, foundation bundles, and sandbox host bridges.
- `api/src/services/skills`: API bridge that loads foundation skill bundles and exposes them to chat-service tool resolution.
- `search_skills`: registry meta-tool used for capability discovery instead of the removed legacy `action=upskill` shortcut.
- `document_generate`: sandbox-backed DOCX/PPTX generation using host bridges and controlled helper APIs.
- Authorization-aware filtering: foundation tools are resolved from current tenant/workspace/user context before exposure to the LLM.
- Package publication readiness: `@sentropic/skills` is a publishable workspace package and was version-bumped for BR-19 changes.

BR-19 intentionally does not deliver a persistent skill marketplace, a registry UI, MCP server export, generated/admin-authored skills, or a generic `execute_skill` dispatcher. Those remain future scope.

## 2. Canonical concepts

- **Tool**: atomic LLM-callable function with `name`, `description`, `inputSchema`, and an executor.
- **Skill**: capability bundle containing instructions, zero or more tools, invocation guidance, optional context filters, and optional sandbox policy.
- **Skill registry**: runtime catalog that registers skills, searches metadata, filters availability through authorization/context, and adapts skills into tool descriptors.
- **Sandbox runtime**: isolated execution boundary used when a skill needs to run generated or untrusted JavaScript.
- **Foundation bundle**: built-in Sentropic skill shipped by `@sentropic/skills`, replacing parts of the former hardcoded tool surface.

The source-of-truth vocabulary remains `spec/SPEC_STUDY_SKILLS_TOOLS_VS_AGENT_MARKETPLACE.md`.

## 3. `SKILL.md` format

A skill is defined by YAML frontmatter plus a Markdown instruction body.

Required metadata:

- `name`: unique skill name within the registry.
- `description`: short LLM-readable capability description used for search/discovery.
- `version`: semantic version for package/catalog evolution.
- `category`: taxonomy used for filtering and ranking.
- `tools`: LLM-callable tool declarations with JSON-schema inputs.

Optional metadata:

- `contextFilter`: workspace types, roles, and online/offline constraints.
- `sandbox`: allowlisted host surface, timeout, and memory constraints.
- `authzRequirements`: explicit permission requirements when context filtering is not sufficient.

The Markdown body is injected as skill instructions when the skill is loaded. It documents when to use the skill, inputs, examples, helper APIs, and failure modes.

## 4. Registry and discovery

`@sentropic/skills` provides an in-memory registry for BR-19:

- `register`, `list`, `get`, and `search` over skill metadata.
- Authorization-aware `resolveTools` adapter for chat-service tool exposure.
- `search_skills` meta-tool with context-filtered results.
- Ranking by skill metadata fields; vector search is deferred until the catalog size justifies it.

Discovery model:

- The agent receives a small starter surface plus `search_skills`.
- The agent can search by natural language when it needs a capability not already obvious from the starter set.
- Search results are filtered before ranking so denied skills are never exposed.
- The agent invokes normal tool names after discovery; BR-19 does not introduce a generic `execute_skill` tool.

## 5. Foundation bundles delivered

BR-19 migrates foundation capabilities into package bundles under `packages/skills/src/bundles/foundation`.

Delivered bundle groups include:

- `workspace`
- `web`
- `organizations`
- `folders`
- `initiatives`
- `solutions`
- `proposals`
- `products`
- `matrix`
- `executive_summary`
- `history_analyze`
- `gate_review`
- `documents`
- `comment_assistant`
- `plan`
- `document_generate`

The API bridge resolves these bundles into chat tools while preserving non-migrated local descriptors where BR-19 did not yet port behavior. Full deletion of legacy local descriptors is not part of BR-19.

## 6. Sandbox runtime

BR-19 uses `isolated-vm` as the primary sandbox runtime.

Security model:

- Fresh isolate per execution.
- No filesystem access from generated code.
- No ambient network access.
- Host APIs exposed only through explicit bridge functions.
- Timeout and memory caps enforced by runtime policy.
- Artifact creation happens through controlled host bridges, not direct disk writes.

Host surfaces delivered in BR-19:

- DOCX host bridge for byte-stable document generation.
- PPTX host bridge for byte-stable presentation generation.
- Helper APIs documented in the `document_generate` skill body.

## 7. `document_generate` semantics after BR-19 UAT fixes

`document_generate` has two execution modes.

Freeform mode:

- Supports targets `organization`, `folder`, and `initiative`.
- `entityType` and `entityId` may be omitted when the session context already provides the target.
- Organization context loads the organization plus linked folders and initiatives into helper context.
- `context.folders` is available to DOCX and PPTX freeform helpers.
- Generated artifacts are stored through the chat/session document pipeline and returned as downloadable cards.

Template mode:

- Remains strict and template-compatible only.
- Requires an explicit `entityType` / `entityId` target.
- Supports only entity types that have templates, currently `folder` and `initiative`.

UAT outcome:

- Organization DOCX generation completes and downloads as DOCX.
- Organization PPTX generation completes and downloads as PPTX.
- Refresh/history keeps the generated document cards.
- Residual browser saturation/tool-call loop risk is deferred to `BR19FIX-LOOP1`.

## 8. Personal/shared catalog and MCP export

BR-19 creates the package and registry foundation but does not yet materialize the end-user catalog comparable to gems or a shared skill capitalization store.

Deferred BR-19B scope:

- MCP-backed tool catalog and export/import adapters.
- Context-driven generic tool-call targeting, reducing Sentropic-specific `entityType` / `entityId` requirements except where a tool explicitly needs them.
- Personal and shared skill catalog for reuse/capitalization.
- Catalog UI/product specification and UAT.
- Distribution model across npm, MCP, and future Sentropic-managed registry.

MCP remains an adapter/transport layer. The business source of truth is the Sentropic skill model and `SKILL.md` format.

## 9. Known deferred issue: chat/tool loop guards

BR-19 fixed the DOCX/PPTX context-targeting loop root cause, but did not implement generic loop prevention.

Deferred `BR19FIX-LOOP1` scope:

- Backend repeated-tool-error breaker.
- Frontend stream projection compaction and bounds.
- Guardrails so repeated tool-call loops cannot freeze the browser tab.
- Dedicated problem analysis before implementation.

## 10. Dependencies and downstream

Dependencies:

- Workspace type context from earlier roadmap branches.
- Chat-service tool dispatch and authorization context.
- Document storage/download pipeline.
- `@sentropic/contracts` tool descriptor shapes.

Downstream:

- BR-19B MCP/personal shared skill catalog.
- BR19FIX chat loop guard analysis.
- Future flow/agent runtimes consuming the same skill registry.
- Future marketplace/managed registry work may build on this package but must not redefine the `Tool` / `Skill` / `Plugin` / `Agent` vocabulary.
