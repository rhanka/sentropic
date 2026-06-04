# SPEC_EVOL_CATALOG — Unified Capability Catalog Evolution (BR-42b)

Branch: `feat/catalog-evolution-42b` · Family: BR-42 scale / build-app foundry · Extends: BR-19 (skills package) + BR-26 (flow façade) + BR-33 (marketplace intention). Absorbs and retires the dormant `feat/mcp-tool-catalog-br19b` "19-mcp" stub.

Status: SCOPING gate (read-only analysis + this spec). No src/test/schema changes in this branch. This document is the input to double-review (Codex + Opus) and to the subsequent BRANCH.md / lot plan.

Scope decision (user, 2026-06-03): the catalog becomes a **UNIFIED capability registry of FIVE entry kinds** — `skill`, `tool`, `agent`, `workflow`, `canvas`. This supersedes the prior v1 framing (skill + agent + canvas, 3 kinds). The Codex-xhigh review of v1 (verdict REVISE) is folded below (§7 Review log) — its must-fixes on the catalog model, the `CatalogSource` seam, the execution path, and naming/version-bump still apply to this revision.

Sibling references (verified to exist): `spec/SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md` (§14 agent templating, §15 marketplace/SkillSource, §10.3 canvas, §16 module-isolation) is the canonical study; `spec/SPEC_EVOL_BUILD_APP_CLI.md`, `spec/SPEC_EVOL_CHAT_ECOSYSTEM.md`, `PLAN.md` (BR-42 family registration). `spec/SPEC_EVOL_BR26_FLOW_FACADE.md` defines the `@sentropic/flow` façade that grounds the new `workflow` kind. `SPEC_EVOL_CHAT_CANVAS` is currently a **named carve-out only** (`SPEC_EVOL_CHAT_ECOSYSTEM.md:52`), not yet a present spec file (Codex MF6) — the canvas RUNTIME lives there when it lands.

---

## 1. Current catalog model (VERIFIED)

The "catalog" today is the **`@sentropic/skills` package** (`packages/skills`, name `@sentropic/skills` v0.1.1 — `packages/skills/package.json:2-3`), wired into the API through one thin app-local module. It is **skill-only**: one first-class entry kind, tools owned by skills, agents/workflows in the DB + flow runtime, canvas carved out, no HTTP surface.

### 1.1 Entry kinds that exist today

Exactly **one** first-class catalog entry kind today: the **Skill** (which *owns* its tools).

- `Skill` (`packages/skills/src/types/skill.ts:52-72`): `{ metadata: SkillMetadata, tools: ReadonlyArray<SkillTool>, body: string, handlers?, sandboxEntry? }`. A skill is a bundle that carries **its own tools** plus a markdown `body` (system-prompt overlay) and optional `handlers` / `sandboxEntry`.
- `SkillTool` (`packages/skills/src/types/skill-tool.ts:28-52`): `{ name, description, inputSchema, outputSchema?, outputRenderHint?, sideEffect?, requiresApproval? }`. Tools are **not** independent registry entries today — they are owned by a skill and surfaced through it. The execution handler is intentionally not on the tool; it lives in `Skill.handlers` keyed by tool name (`skill-tool.ts:23-27`).
- `SkillMetadata` (`packages/skills/src/types/metadata.ts:22-45`): the cheap projection returned by `list()`/`search()` — `{ name, description, version, category, contextFilter?, sandbox?, authzRequirements?, toolNames }`.

So today's model is **skills (which contain tools)**: `tool` is not a separate registry kind, and `agent`/`workflow`/`canvas` do NOT exist as catalog entries (they live in separate app-local systems — §2).

### 1.2 Data shape of a catalog entry

A registry entry is keyed by `metadata.name` (kebab-case, globally unique) in an in-memory `Map<string, Skill>` (`registry.ts:94-106`). The registry interface (`registry.ts:34-54`) exposes `register / unregister / list(filter?) / get(name) / search(query, options?)`, all **synchronous**. `list` returns `SkillMetadata[]`; `get` returns the full `Skill`; `search` is a token-frequency heuristic over name/description/category (`registry.ts:125-159`, weights name×3 desc×2 cat×1).

### 1.3 Registration

- Concrete registry: `InMemorySkillRegistry` (`registry.ts:94`). One instance per process, shared by DI; **register throws on duplicate name** and idempotent re-registration is NOT supported (`registry.ts:102-104`, `bundles/foundation/index.ts:85-94`).
- Built-in entries: the **foundation bundle** — a frozen array of 16 skills (`bundles/foundation/index.ts:57-74`: workspace, web, organizations, folders, initiatives, solutions, proposals, products, executive_summary, matrix, history_analyze, gate_review, documents, comment_assistant, plan, document_generate). Registered by `registerFoundationSkills(registry)` (`bundles/foundation/index.ts:85-94`).
- App wiring: `api/src/services/skills/catalog.ts:12-17` constructs a module-singleton `foundationSkillRegistry`, calls `registerFoundationSkills`, wraps it in `SkillsToolRegistry`. **This is the only registry instance in the app.** No DB-backed registration, no dynamic/external registration path today.

### 1.4 How the catalog is exposed (consumers)

There is **no dedicated HTTP catalog endpoint**. The catalog is consumed entirely server-side, through the chat tool loop, and the path is **synchronous end-to-end** (Codex MF2):

- **Adapter**: `SkillsToolRegistry` (`registry/adapter.ts:35-95`) bridges `SkillRegistry` → the `ToolRegistry` contract consumed by chat-core/flow. `resolveTools(authz, options?)` is **synchronous** (`adapter.ts:38`), walks `list()→get()`, runs `resolveAuthorizedTools`, and **always prepends the `search_skills` meta-tool** (`adapter.ts:64`) unless scoped to a single skill. It holds no mutable state — a skill registered after construction is immediately visible (`adapter.ts:30-34`). It executes **only** `search_skills` (`adapter.ts:76-89`, sentinel skill name `__skills__`); it does NOT dispatch foundation tools.
- **App façade**: `api/src/services/skills/catalog.ts` exposes `resolveFoundationChatTools(input)` (**sync** → OpenAI `ChatCompletionTool[]`, lines 57-64) and `executeFoundationSearchSkills(...)` (lines 66-74). Authz built from `{ userId, workspaceId, workspaceType?, currentUserRole?, allowedTools }` via `buildFoundationSkillsAuthz` (lines 27-42) — `permissionMode: 'allowlist'`. The OpenAI conversion does **no name sanitization** (`catalog.ts:44`) — tool names pass through verbatim (Codex MF3).
- **Chat loop entry**: `api/src/services/chat-service.ts:2749` calls `resolveFoundationChatTools(...)` **synchronously** to assemble the per-turn tool set; `api/src/services/skills/foundation-executor.ts:152-529` dispatches tool calls by **hardcoded name** (`search_skills` at :157, then the ~25 read/write foundation tools), returning **unhandled for unknown tool names** (`foundation-executor.ts:528`, surfaced at `chat-service.ts:4119`). Discovery is **search-first**: the LLM only ever sees `search_skills` + the authz-allowed tools; SKILL.md bodies are discovered on demand (`tools.ts:875-885`).
- `search_skills` is named and typed **skill-only** (`registry/search-skills-tool.ts:11` `SEARCH_SKILLS_TOOL_NAME = 'search_skills'`, output is `SkillSearchHit[]` metadata, NOT SKILL.md bodies) (Codex MF4).
- The `MarketplaceEngine` overlay (study §15) and any "marketplace" gating are **not implemented** — `adapter.ts:27-29` only references it as a planned wrap point.

**Summary**: one in-memory **synchronous** registry, one entry kind (skill-with-tools), static code-defined registration of a 16-skill foundation bundle, consumed exclusively by the chat tool loop via a `search_skills`-first adapter with **hardcoded, skill-only execution dispatch**. No HTTP, no DB persistence, no external sources, no marketplace gating.

---

## 2. Where the other four kinds live today (grounding the unification)

### 2.1 `tool` — today skill-owned; the new kind makes standalone tools first-class

Tools are not registry entries today — every tool is owned by a `Skill` (`skill.ts:52-72`, `skill-tool.ts:28-52`) and surfaced through it. The chat loop's actual executable tools live as hardcoded OpenAI descriptors in `api/src/services/tools.ts` (e.g. `documentGenerateTool` `tools.ts:868`) dispatched by name in `foundation-executor.ts:152-529`. There is **no concept of a standalone tool** that is not attached to a skill, and **no MCP client** in the repo (§2.5).

**The `tool` kind** makes a standalone tool a first-class `CatalogEntry` — primarily for **MCP-sourced tools** (one MCP `tools/list` entry → one `tool` entry), but also for any code-defined tool not owned by a skill. Reconciliation with skill-owned tools: the catalog surfaces **both** — `skill` entries (which carry their tool descriptors, unchanged) AND standalone `tool` entries. A skill's tools are NOT duplicated as standalone `tool` entries; the discriminator records provenance (`ownedBy?: skillName` is absent for standalone tools, present implicitly via the `skill` entry). This keeps the existing skill→tools ownership intact while letting external/standalone tools join the registry.

### 2.2 `agent` — today DB rows + flow `AgentTemplate` port; the kind catalogs the code-level templates

"Agents" exist as a separate, DB-backed, workspace-scoped system:

- **Templates / seeds (code-level, the catalog source)**: `WORKSPACE_TYPE_AGENT_SEEDS` (`api/src/config/default-agents.ts:37`), shape `DefaultGenerationAgentDefinition = { key, name, description, sourceLevel: 'code', config }` (`default-agents-types.ts:5-11`). These are global, code-defined, per-workspace-type catalogs.
- **Live instances (DB, NOT catalogued)**: table `agent_definitions` (`schema.ts:840-866`, unique on `(workspaceId, key)`, `sourceLevel` `'code'|'admin'|'user'`), managed at runtime via the API (`api/src/routes/api/agent-config.ts:59`, `api/src/services/todo-orchestration.ts:1194`) (Codex MF5).
- **Resolution port**: `AgentTemplate` (`packages/flow/src/agent-template.ts:26-68`) resolves an agent into a `ResolvedAgentConfig { systemPrompt, tools, modelPrefs }` (`agent-template.ts:20-24`) by rendering `promptTemplate`, applying `agentSelection` rules, overlaying skills. Study §14 (`SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md:379-408`) defines the agent-templating invariant: same `agentId + state` → same `ResolvedAgentConfig` before/after each extraction slice.

**The `agent` kind** catalogs the **code-level templates/seeds** (`default-agents.ts` `DefaultGenerationAgentDefinition`), giving `list/search/get` parity with skills — NOT the per-workspace DB rows, and NOT a new sub-agent runner. Runtime resolution stays in flow/chat-core via `AgentTemplate` (§14 invariant preserved). Source boundary (Codex MF5): the template source reads `default-agents.ts` (API-local), so the agent-kind lot touches `api/` for source wiring, not `packages/skills/**` only (§5).

### 2.3 `workflow` — NEW kind, grounded on `@sentropic/flow` ("workflows comme top ai ideas")

The user's "workflows comme top ai ideas" maps directly to the app's flow constructs. Grounded reading:

- **The catalogued workflow ENTRY = a `DefaultWorkflowDefinition`** (`packages/flow/src/seeds/workflows.ts:59-66`): `{ key, name, description, config, tasks: DefaultWorkflowTaskDefinition[], transitions: DefaultWorkflowTransitionDefinition[] }`. This is a **code-defined, named orchestration template** — a directed task graph (tasks with `agentKey`/`jobType` metadata + typed transitions `start|normal|conditional|fanout|join|end`).
- **"top ai ideas" is literal**: the app's product name is "Top AI Ideas" (`api/src/app.ts:197`, `api/src/openapi/export.ts:6`); its generation workflow is `DEFAULT_USE_CASE_GENERATION_WORKFLOW` (`seeds/workflows.ts:154-442`, key `ai_usecase_generation_v1` `:24`), the `ai-ideas` workspace-type seed (`WORKSPACE_TYPE_WORKFLOW_SEEDS` `:847-852`). This is exactly the use-case→organization-enrich→matrix→list→detail→executive-summary generation sequence the user means by "workflows".
- **The immo/opportunity domain** maps to the `opportunity` workspace-type workflows `OPPORTUNITY_IDENTIFICATION_WORKFLOW` + `OPPORTUNITY_QUALIFICATION_WORKFLOW` (`seeds/workflows.ts:448`, `:730`, seed `:853-857`); `code` maps to `CODE_ANALYSIS_WORKFLOW` (`:793`, seed `:858-862`). (No literal `radar-immobilier` symbol exists; the opportunity workflows ARE that domain's generation sequence.)
- **Source = the flow seed catalog**: `WORKSPACE_TYPE_WORKFLOW_SEEDS` (`seeds/workflows.ts:847-864`), looked up by `getWorkflowSeedsForType` (`:867`), exported from `@sentropic/flow` (`packages/flow/src/index.ts:178-186`). Like agents, **live workspace instances** are DB rows (`workflow_definitions` `schema.ts:868`, `WorkflowDefinitionRow` `:1225`) managed by the flow `WorkflowStore` port (`packages/flow/src/workflow-store.ts:22-57`) — NOT catalogued.

**No genuine ambiguity** after grounding: the app's "workflow" is one well-defined thing (`DefaultWorkflowDefinition`, the flow-seed orchestration template). The single thing to double-check at impl is the **template source import** — `@sentropic/flow` seeds are the source of truth, so the workflow-kind lot imports from `@sentropic/flow`, not from `api/`. **The `workflow` kind catalogs the seed-level orchestration templates** (`list/search/get` parity), runtime execution stays in `@sentropic/flow` (`FlowRuntime`, `processing-loop`, `job-runner`) + the Postgres adapters in `api/`.

### 2.4 `canvas` (canevas) — kind/template only; runtime stays carved out (D-CANVAS RESOLVED)

`canevas` is the French spelling for **canvas**. Repo evidence (verified):

- Originating intention (`SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md:489,495`): *"Catalogue `skill+tools+agent` → + agents + canevas … `canevas` = LiveDocument/artifact templates (cf. §10.3)."*
- **§10.3 Canvas bidirectional editing** (`SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md:200-211`): canvas = a `LiveDocument` abstraction; a tool returns `LiveDocumentRef { id, initialContent, mimeType }`; `chat-core` owns a `LiveDocumentStore` port (`create/apply(patch)/read/subscribe/close`); wire events `livedoc-opened/livedoc-patch/livedoc-closed`; CRDT (Y.js/Automerge).
- The port exists as a **stub**: `LiveDocumentStore { readonly _kind: 'LiveDocumentStore' }` (`packages/chat-core/src/ports.ts:66-72`).
- Canvas is an **explicitly carved-out sub-program** with its OWN (not-yet-written) spec: `SPEC_EVOL_CHAT_ECOSYSTEM.md:52` *"(carved out) Canvas → own `SPEC_EVOL_CHAT_CANVAS` (livedoc/CRDT, editors, collab/audit/reversibility)"* (reaffirmed `:55`, `:75`, `:108`). It is currently a named carve-out only, not a present file (Codex MF6).
- Existing **`canvas|artifact` vocabulary** to align with: `packages/comments/src/types.ts:11` (comments anchor to `messages|canvas|artifacts`) (Codex MF6).
- No `canvas`/`canevas` UI component exists for this meaning. Grep hits in `ui/src/lib/components/InitiativeScatterPlot.svelte` + `e2e/tests/03-chat.spec.ts` are the HTML `<canvas>` element (charting) — unrelated.

**RESOLVED (user confirmed canvas-in-catalog → kind-only)**: the `canvas` kind catalogs **canvas/live-document artifact *templates*** — a named LiveDocument starter (`{ id, title, mimeType, initialContent, schema? }`, mirroring §10.3 `LiveDocumentRef`) — and STOPS there. The `LiveDocumentStore`/CRDT/editor **runtime stays carved out to `SPEC_EVOL_CHAT_CANVAS`**; BR-42b MUST NOT pull canvas runtime in (collision with `SPEC_EVOL_CHAT_ECOSYSTEM.md:52,75,108`). D-CANVAS is no longer a fork: it is kind-only.

### 2.5 Sources today: only the static foundation bundle

There is **no MCP client/server, no Google-marketplace integration** in code. Grep for MCP in non-doc code yields only (a) a comment in `packages/skills/src/types/skill.ts:16` noting "Adapters (chat-core, MCP) pass their own AuthzContext-equivalent here" — the skill type was *designed* to be MCP-frontable — and (b) a doc-string in `api/src/config/default-chat-system.ts:32`. The study's §15 `SkillSource` enum includes `{ kind: 'mcp.so'; filter }` (`:420`); chat-ecosystem T4 calls for a "unified CatalogSource (tools/MCP/canvas/agents/flow)" (`SPEC_EVOL_CHAT_ECOSYSTEM.md:47`). MCP is **greenfield** and absorbs the dormant br19b stub (no code on origin — confirmed).

---

## 3. The 5-kind unified catalog — `CatalogEntry` + `CatalogSource`

### 3.1 The five kinds and the shared `CatalogEntry` shape

A tagged union discriminated by `kind`, with shared metadata + a per-kind payload. Illustrative — frozen during build, co-designed with the real host consumer (chat tool loop), per the contract-consumer-co-design rule:

```ts
type CatalogEntryKind = 'skill' | 'tool' | 'agent' | 'workflow' | 'canvas';

// Shared metadata = the INTERSECTION of the 5 kinds' common fields, NOT a superset of SkillMetadata.
// Skill-specific fields (`sandbox` metadata.ts:37, `toolNames` metadata.ts:44) are NOT shared — they
// live in the SkillEntry PAYLOAD (the full `Skill`, which already carries them), not in this metadata.
interface CatalogEntryMetadata {            // genuinely-shared fields across skill|tool|agent|workflow|canvas
  readonly name: string;                     // public, provider-safe id (see §3.3 naming)
  readonly description: string;
  readonly version?: string;                 // optional: not every kind is semver'd
  readonly category?: string;                // optional: free taxonomy where present
  readonly contextFilter?: ContextFilter;    // optional: availability gating where applicable
  readonly authzRequirements?: SkillAuthzRequirements; // optional: authz where applicable
}
// Rule (Codex MF1): shared metadata = the intersection of all kinds; anything kind-specific (a skill's
// `sandbox`/`toolNames`, a tool's `rawName`, an agent's `config`, a workflow's `tasks`/`transitions`, a
// canvas template's `mimeType`/`initialContent`) belongs to that kind's PAYLOAD below, never to shared metadata.

interface CatalogEntryBase {
  readonly kind: CatalogEntryKind;
  readonly metadata: CatalogEntryMetadata;
  readonly sourceId: string;                 // provenance: which CatalogSource produced it
}

// Per-kind payloads (each maps from its source):
type SkillEntry    = CatalogEntryBase & { kind: 'skill';    skill: Skill };                  // skill.ts:52-72 — owns its tools
type ToolEntry     = CatalogEntryBase & { kind: 'tool';     tool: SkillTool;                  // skill-tool.ts:28-52
                                                            rawName?: string };               // raw MCP/source name (see §3.3)
type AgentEntry    = CatalogEntryBase & { kind: 'agent';    template: AgentEntryTemplate };   // from default-agents.ts DefaultGenerationAgentDefinition
type WorkflowEntry = CatalogEntryBase & { kind: 'workflow'; workflow: DefaultWorkflowDefinition }; // seeds/workflows.ts:59-66
type CanvasEntry   = CatalogEntryBase & { kind: 'canvas';   template: CanvasTemplate };        // LiveDocumentRef-shaped starter (§2.4)

type CatalogEntry = SkillEntry | ToolEntry | AgentEntry | WorkflowEntry | CanvasEntry;
```

Per-kind source mapping:

| kind       | source of truth (file:line)                                          | catalogued payload                        | runtime owner (NOT here)                 |
|------------|----------------------------------------------------------------------|-------------------------------------------|------------------------------------------|
| `skill`    | foundation bundle `bundles/foundation/index.ts:57-74`                | full `Skill` (with tools)                 | foundation-executor dispatch             |
| `tool`     | MCP `tools/list` (§3.3) / standalone code tool                       | single `SkillTool` + `rawName`            | catalog execution seam (§3.4)            |
| `agent`    | `api/src/config/default-agents.ts:37` (templates/seeds)             | template (`DefaultGenerationAgentDefinition`) | flow `AgentTemplate` (`agent-template.ts`) |
| `workflow` | `@sentropic/flow` `seeds/workflows.ts:847` `WORKSPACE_TYPE_WORKFLOW_SEEDS` | `DefaultWorkflowDefinition`               | flow `FlowRuntime`/`processing-loop`     |
| `canvas`   | code-defined canvas templates (§2.4)                                 | `CanvasTemplate` (LiveDocumentRef starter) | `SPEC_EVOL_CHAT_CANVAS` (carved out)     |

### 3.2 `CatalogSource` + composite registry (the Lot 1 seam)

**Goal**: feed the catalog from **pluggable sources** instead of only the static foundation bundle. Generalises study §15 `SkillSource` (`SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md:417-422`) from a skills-only enum into a source interface yielding `CatalogEntry`s of any kind.

**Sync constraint (Codex MF2)**: the live resolve path is synchronous end-to-end (`adapter.ts:38` → `catalog.ts:57` → `chat-service.ts:2749`). A naive `async list()` breaks it. Resolution: `CatalogSource` exposes a **synchronous `snapshot()`** consumed on the hot path, plus an **optional async `refresh()`** for remote sources that repopulates the snapshot out-of-band. Static sources are always-fresh; MCP refreshes on a schedule/connect, never on the per-turn resolve.

```ts
interface CatalogSource {
  readonly id: string;                       // 'foundation' | 'mcp:<server>' | 'google-marketplace' | …
  readonly kind: 'static' | 'mcp' | 'marketplace';
  snapshot(): ReadonlyArray<CatalogEntry>;   // SYNC — consumed on the resolve hot path
  refresh?(): Promise<void>;                  // ASYNC — remote sources repopulate the snapshot out-of-band
  health?(): Promise<{ ok: boolean; detail?: string }>;
}
```

- The **static foundation bundle** wraps as `StaticCatalogSource` (id `'foundation'`) over `FOUNDATION_SKILLS`, emitting `skill`-kind entries — **zero behaviour change**, pure refactor (characterization-first, §5).
- `CompositeCatalogRegistry` fans `list/get/search` across sources' snapshots; name collisions resolve by source precedence (foundation wins / explicit policy). Preserves `InMemorySkillRegistry`'s O(1) get / O(n) search per source and the **search-first** discovery contract (§1.4) and the no-cache-invalidation property.

### 3.3 Naming — provider-safe public ids, raw name mapping (Codex MF3)

Today's parser enforces kebab-ish names (`packages/skills/src/format/parser.ts:20,52,87`) and the OpenAI conversion does no sanitization (`catalog.ts:44`). MCP tool names (`mcp:<server>/<tool>` with `:`/`/`) are **invalid** as public tool ids. Rule: each entry carries a **provider-safe public `metadata.name`** (sanitized to the kebab/underscore charset accepted by the parser and OpenAI) plus, for `tool` entries, a `rawName` that maps back to the source's real tool name for the execution call. The catalog owns the public-id↔raw-name map; the model never sees raw names.

### 3.4 The catalog execution seam (Codex MF1 — prerequisite for `tool`/MCP)

Today `SkillsToolRegistry` executes **only** `search_skills` (`adapter.ts:76-89`) and `foundation-executor.ts` dispatches the ~25 foundation tools by **hardcoded name**, returning unhandled for anything else (`foundation-executor.ts:528`, `chat-service.ts:4119`). So an MCP/standalone `tool` entry would *resolve* into the tool set but **never execute**. Before MCP, BR-42b MUST add a **generic catalog execution seam**: a `CatalogEntry`-keyed dispatch (entry carries/returns its handler — for `tool` entries the MCP `call` or code handler) that `foundation-executor`/`chat-service` consults for any tool name it does not hardcode. This is Lot 2's prerequisite and is scheduled there.

### 3.5 Discovery — keep `search_skills` skill-only; add `search_catalog` (Codex MF4)

`search_skills` is named + typed skill-only (`search-skills-tool.ts:11`, returns `SkillSearchHit[]` metadata). It **cannot silently** become unified catalog search. Rule: **keep `search_skills` exactly as-is** (skill discovery, stable contract — chat-core dispatcher keys on the literal `'search_skills'` and sentinel `'__skills__'`). For cross-kind discovery, **add a sibling `search_catalog`** meta-tool returning `CatalogEntry` hits across all kinds (kind in each hit). The `search_skills`-first contract for skills is preserved verbatim; `search_catalog` is additive. Renaming `search_skills` is explicitly rejected (breaks the dispatcher contract).

### 3.6 MCP source

`McpCatalogSource` (`kind: 'mcp'`) connects to a configured MCP server (stdio or HTTP/SSE, via the official `@modelcontextprotocol/sdk`, added through `make install-api`), calls MCP `tools/list`, and **maps each MCP tool → one `tool`-kind `CatalogEntry`** (MCP `inputSchema` → `SkillTool.inputSchema`; sanitized public name + `rawName`, §3.3). MCP `call` is wired through the §3.4 execution seam, so discovery + dispatch keep working. Per-source config (server URL/command, auth token/headers, allow/deny filter) is carried out-of-band (env / workspace config), NOT in the entry — exactly where study §15 `MarketplacePolicy.allowedSources` (`:424-431`) would later gate exposure (marketplace gating stays deferred, §15 admin UI out of scope). MCP refreshes via the async `refresh()` (§3.2), never on the per-turn resolve. **Absorbs and retires `feat/mcp-tool-catalog-br19b`** (no code/PR on origin).

### 3.7 Google marketplace source (deferred v2)

`GoogleMarketplaceCatalogSource` (`kind: 'marketplace'`) discovers Google/Vertex marketplace tools/extensions, mapped to `tool`-kind `CatalogEntry`s the same way. Per study §16.3 + `SPEC_EVOL_BUILD_APP_CLI.md:382`, the scale-relevant Google piece is the MCP/marketplace catalog integration, but the individual provider work moved to BR-43. **DESIGNED here, IMPLEMENTED deferred / v2** (MCP is the v1 external source); see D-SRC.

---

## 4. Batched decisions (ALL conductor-resolvable — no user-blocker)

Per the user's 5-kind clarification, every prior fork is resolved. Surface, then proceed.

- **D-CANVAS** → **RESOLVED to kind-only** (§2.4). User confirmed canvas-in-catalog. Catalog the `canvas` template kind; the LiveDocumentStore/CRDT/editor runtime stays carved out to `SPEC_EVOL_CHAT_CANVAS`. No longer a fork.
- **D-SRC (which sources in v1)** → MCP **implemented** v1 (absorbs br19b, greenfield-clean); Google marketplace **designed, deferred** to v2 (depends on BR-43 + §15 gating). Reversible.
- **D-AGENT-SCOPE** → catalog `agent` = **code-level templates/seeds** (`default-agents.ts`), NOT per-workspace `agent_definitions` DB rows (§2.2). Preserves §14 invariant; per-workspace projection deferred. Source boundary noted (Codex MF5): the agent lot touches `api/` for the template source.
- **D-WORKFLOW-SCOPE** → catalog `workflow` = **flow seed orchestration templates** (`@sentropic/flow` `WORKSPACE_TYPE_WORKFLOW_SEEDS`, §2.3), NOT per-workspace `workflow_definitions` DB rows. **The one item to double-check at impl**: the template source is `@sentropic/flow` (import the seeds from the package, not from `api/`); runtime stays in flow. No user-blocker after grounding.
- **D-TOOL-RECONCILE** → `tool` is first-class for **standalone/MCP** tools; skill-owned tools stay owned by their `skill` entry (NOT duplicated as `tool` entries) (§2.1). Requires the §3.4 execution seam.
- **D-SEARCH** → keep `search_skills` skill-only; add additive `search_catalog` for cross-kind discovery (§3.5). No rename.
- **D-PKG (where the abstraction lives)** → **RESOLVED (Codex MF6): the unified catalog lives APP-LOCAL in `api/` for v1** (e.g. `api/src/services/catalog/**`). The kind-agnostic machinery — the `CatalogEntry` union, the `CatalogSource` interface, `CompositeCatalogRegistry`, the execution seam (§3.4) and `search_catalog` (§3.5) — is **api-local**, because the catalog must compose the **api-local** agent template type (`api/src/config/default-agents-types.ts:5`) and a package CANNOT import from `api/` (architecture module-isolation, study §16). The catalog **COMPOSES** kind payloads from their homes: `Skill`/`SkillTool` from `@sentropic/skills`, `DefaultWorkflowDefinition` from `@sentropic/flow`, the agent template from `api/config`, the canvas template from the canvas package/api. **No `@sentropic/skills → @sentropic/flow` dep is added** (the workflow payload is imported api-side, not into the skills package). The foundation skill bundle stays in `@sentropic/skills`; the catalog composes it api-side via a `StaticCatalogSource`. A **reusable `@sentropic/catalog` package extraction is DEFERRED** to a follow-up (per `architecture.md` "activate by real consumption" — extract once the app proves the abstraction). Marketplace *gating* (`@sentropic/marketplace`, §15) likewise stays a separate future package.
- **D-MIGRATION** → **none required in v1**. All catalogued kinds are templates (code/in-memory). `agent_definitions` (`schema.ts:840`) and `workflow_definitions` (`schema.ts:868`) are untouched. A migration is only needed if catalog scope later expands to DB-backed entries or MCP-source persistence — out of v1.
- **D-NO-HTTP** → keep the catalog server-side via the chat tool loop (§1.4); no public catalog HTTP endpoint in v1 unless the build-app CLI needs it (then a follow-up).
- **D-RETIRE-19B** → retire `feat/mcp-tool-catalog-br19b`; its scope is absorbed by §3.6. No-op cleanup (no code/PR/plan on origin).
- **D-VERSION-BUMP** (Codex MF7) → every lot touching `packages/skills/src/**` (and `packages/flow/**` if exports change) MUST bump that package's `package.json` `version` per `rules/workflow.md` (`enforce-package-bump` CI gate). Recorded in §5 allowed paths.

No user-blocking decision remains. The workflow grounding produced no new fork (the app's "workflow" is one well-defined thing, §2.3).

---

## 5. Scope / paths + lots outline (LEAN, mono-branch, characterization-first)

**Characterization-first**: the foundation-bundle → `StaticCatalogSource` refactor touches live tool resolution (`adapter.ts`, `catalog.ts`, the chat loop). It MUST be covered by a characterization test that pins today's resolved tool set (16 foundation skills + `search_skills`, per authz) BEFORE refactoring — no behaviour change in the composite refactor. **Gate after the seam lot (Lot 1).**

**Allowed paths (for the IMPLEMENTATION branch, NOT this scoping branch):**
- `api/src/services/catalog/**` (NEW — the app-local kind-agnostic machinery: `CatalogEntry` union, `CatalogSource` interface, `CompositeCatalogRegistry`, `StaticCatalogSource`, the execution seam §3.4, `search_catalog` §3.5, `McpCatalogSource`; per Codex MF6 / D-PKG this is api-local, NOT a package).
- `api/src/services/skills/catalog.ts`, `api/src/services/skills/foundation-executor.ts` (wire composite + execution seam + MCP config; consult catalog dispatch for non-hardcoded names).
- `api/src/config/default-agents.ts` (read-only import for the `agent` template source — Codex MF5: agent lot touches `api/`).
- `@sentropic/skills` is consumed **READ-ONLY** — `StaticCatalogSource` lives app-local in `api/src/services/catalog/sources/static-source.ts` and imports `FOUNDATION_SKILLS` from the package; **`packages/skills/src/**` is NOT modified** by this branch (plan-review MF3: no adapter, no shared catalog type added to the package, so no `enforce-package-bump` bump is triggered). The foundation bundle stays in the package; the catalog composes it api-side.
- `api/package.json` + BOTH `api/package-lock.json` and root `package-lock.json` (add `@modelcontextprotocol/sdk` via `make install-api NPM_LIB=@modelcontextprotocol/sdk ENV=…`; the API image build runs `npm ci --workspaces` against the ROOT lock per `api/Dockerfile:51`, so both locks must be updated — plan-review MF4).
- Read-only imports for kind payload TYPES: `@sentropic/flow` (`DefaultWorkflowDefinition`) and the canvas package/api — composed api-side, so NO `packages/flow/src/**` edit and NO `@sentropic/skills → @sentropic/flow` dep is added (Codex MF6).

**Forbidden / out of scope**: canvas runtime (`SPEC_EVOL_CHAT_CANVAS` — LiveDocumentStore/CRDT/editor), marketplace gating engine (`@sentropic/marketplace` §15), per-workspace DB-agent/DB-workflow projection, public HTTP catalog endpoint, any `Makefile`/`docker-compose*` change, BR-43 Google provider, renaming `search_skills`.

**Lots outline (mono-branch + cherry-pick; gate after Lot 1):**
- **Lot 0 — Characterization** (tests only): pin current resolved-tool behaviour of `SkillsToolRegistry` + `resolveFoundationChatTools` (16 skills + `search_skills`, per authz). Pin `search_skills` output shape.
- **Lot 1 — `CatalogSource` seam (no behaviour change)** [GATE]: introduce `CatalogEntry`/`CatalogSource` (sync `snapshot()` + optional async `refresh()`, §3.2) **app-local in `api/src/services/catalog/**`** (Codex MF6 / D-PKG), wrap foundation bundle as `StaticCatalogSource` (`skill` entries), `CompositeCatalogRegistry`; keep `search_skills`-first contract. Green char tests = gate.
- **Lot 2 — `tool` kind + execution seam** (Codex MF1): make standalone tools first-class `CatalogEntry`s; add the **generic catalog execution seam** (§3.4) so non-hardcoded tool names dispatch; reconcile skill-owned vs standalone (§2.1, D-TOOL-RECONCILE). Prerequisite for MCP.
- **Lot 3 — `agent` template kind**: `agent`-kind entries over `default-agents.ts` templates (§2.2); `list/search/get` parity; preserve §14 invariant. Touches `api/` for the template source (Codex MF5).
- **Lot 4 — `workflow` kind** (NEW): `workflow`-kind entries over `@sentropic/flow` `WORKSPACE_TYPE_WORKFLOW_SEEDS` (§2.3); `list/search/get` parity. Double-check the template source import is from `@sentropic/flow` (D-WORKFLOW-SCOPE).
- **Lot 5 — MCP `CatalogSource`** (absorbs br19b): `McpCatalogSource` (`tools/list` → `tool` entries, sanitized public name + `rawName`, §3.3; `call` → execution seam §3.4); async `refresh()`; per-source config. Integration test vs a stub MCP server.
- **Lot 6 — `canvas` template kind** (kind-only, D-CANVAS resolved): `canvas`-kind entries (template metadata + `LiveDocumentRef` starter, §2.4); align `canvas|artifact` vocabulary (`packages/comments/src/types.ts:11`). NO runtime.
- **Lot 7 — Google marketplace source** — **DEFERRED v2** (design only here; D-SRC). Not in v1 unless user elevates.

Reorder note: Lot 2 (execution seam) MUST precede Lot 5 (MCP) — MCP tools are dead without it. The kind lots (3,4,6) are independent and can interleave; MCP (5) depends on 2.

---

## 6. Open blockers / asks for conductor → user

**None user-blocking.** All decisions in §4 are conductor-resolvable after the user's 5-kind clarification and the canvas resolution. Items to surface (proceed unless the user objects):

1. **D-SRC** (MCP v1, marketplace deferred v2) and **D-AGENT-SCOPE / D-WORKFLOW-SCOPE** (templates, not DB rows) — preconised, proceed.
2. **D-PKG** — **RESOLVED (Codex MF6)**: the catalog is **app-local in `api/`**, composing kind payloads from their homes; no `@sentropic/skills → @sentropic/flow` coupling is introduced (the `workflow` payload type is imported api-side). The reusable `@sentropic/catalog` package extraction is **DEFERRED** to a follow-up (activate-by-real-consumption). No open question remains here.

The one impl-time double-check (not a blocker): the `workflow` template source is `@sentropic/flow` seeds (§2.3 / D-WORKFLOW-SCOPE). Lots 0-6 can be planned now; Lot 7 is deferred design.

---

## 7. Review log

- **2026-06-03 — user 5-kind clarification**: catalog = unified registry of FIVE kinds `skill | tool | agent | workflow | canvas`. `tool` promoted to first-class (standalone/MCP) while skills keep owning theirs; `agent` = code templates; `workflow` = NEW, grounded on `@sentropic/flow` ("workflows comme top ai ideas" = `DEFAULT_USE_CASE_GENERATION_WORKFLOW`); `canvas` = kind/template only, runtime carved out. D-CANVAS resolved to kind-only. Spec revised from v1 (3-kind: skill+agent+canvas) to this.
- **Codex-xhigh review of v1 (verdict REVISE)** — folded must-fixes:
  - **MF1** (execution): MCP/standalone tools would resolve but not execute (`adapter.ts:76`, `foundation-executor.ts:157,528`, `chat-service.ts:4119`) → §3.4 generic catalog execution seam, scheduled Lot 2 before MCP.
  - **MF2** (sync): `CatalogSource` async `list()` conflicts with the sync resolve path (`adapter.ts:38`, `catalog.ts:57`, `chat-service.ts:2749`) → §3.2 sync `snapshot()` + optional async `refresh()`.
  - **MF3** (naming): `mcp:<server>/<tool>` invalid for the kebab parser (`parser.ts:20,52,87`) + no sanitization in OpenAI conversion (`catalog.ts:44`) → §3.3 provider-safe public id + `rawName` mapping.
  - **MF4** (search): `search_skills` is skill-only + returns metadata not bodies (`search-skills-tool.ts:11,100,172`) → §3.5 keep `search_skills`, add `search_catalog`; no rename.
  - **MF5** (agent boundary): templates are API-local (`default-agents.ts:37`), instances DB/API-managed (`agent-config.ts:59`, `todo-orchestration.ts:1194`) → §2.2 + Lot 3 touches `api/`, not skills-only.
  - **MF6** (canvas): C1/C3 framing right; `SPEC_EVOL_CHAT_CANVAS` is a named carve-out only (`SPEC_EVOL_CHAT_ECOSYSTEM.md:52`), not a file; align `canvas|artifact` vocab (`comments/src/types.ts:11`) → §2.4 + Lot 6.
  - **MF7** (version bump): `packages/<pkg>/src/**` edits require a `package.json` version bump (`rules/workflow.md`) → §4 D-VERSION-BUMP + §5 allowed paths.
- The v1 current-catalog model (§1) was judged "mostly accurate" and `+AGENTS`/`+CANEVAS` "grounded"; this revision keeps §1, corrects the sync + execution + naming + search facts, and extends to 5 kinds.
- **Codex re-check 2 (5-kind)** — MF1 metadata-shared-not-superset (`CatalogEntryMetadata` = intersection of the 5 kinds; skill `sandbox`/`toolNames` move to the SkillEntry payload — §3.1) + MF6 catalog app-local in `api/` (kind-agnostic machinery in `api/src/services/catalog/**`; composes payloads from `@sentropic/skills`/`@sentropic/flow`/`api/config`/canvas; `@sentropic/catalog` package extraction deferred — §4 D-PKG, §5, §6); circular-dep cleared, workflow grounding (`DefaultWorkflowDefinition` from `@sentropic/flow`) + lot order (Lot 2 execution seam before Lot 5 MCP) confirmed.
- **Codex plan-review (xhigh, 2026-06-03)** — verdict REVISE on `plan/42b-BRANCH_feat-catalog-evolution.md`; lot order + marketplace-deferred confirmed sound. 5 must-fixes folded into plan + spec: **MF1** Lot 0/1 add a real live-chat oracle pinning the per-turn OpenAI tool array (`chat-service.ts:2749`: `search_skills`-first, exact 16 names, descriptor order, sync), re-asserted byte-identical post-Lot 1; **MF2** `search_skills` SEMANTIC fixtures (ranking/limit/empty/authz-role-category filters), not just shape; **MF3** catalog 100% app-local — `packages/skills/src/**` consumed READ-ONLY, no adapter/shared-type added there (§5); **MF4** EX1 covers BOTH `api/package-lock.json` + root `package-lock.json` (image build uses root lock, `api/Dockerfile:51`), `make install-api NPM_LIB=…`; **MF5** `ENV=` is the LAST make argument (E2E_GROUP before ENV).
