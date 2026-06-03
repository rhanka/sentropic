# SPEC_EVOL_CATALOG — Capability Catalog Evolution (BR-42b)

Branch: `feat/catalog-evolution-42b` · Family: BR-42 scale / build-app foundry · Extends: BR-19 (skills package) + BR-33 (marketplace intention). Absorbs and retires the dormant `feat/mcp-tool-catalog-br19b` "19-mcp" stub.

Status: SCOPING gate (read-only analysis + this spec). No src/test/schema changes in this branch. This document is the input to double-review (Codex + Opus) and to the subsequent BRANCH.md / lot plan.

Sibling references (verified to exist): `spec/SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md` (§14 agent templating, §15 marketplace, §10.3 canvas, §16 module-isolation) is the canonical study; `spec/SPEC_EVOL_BUILD_APP_CLI.md`, `spec/SPEC_EVOL_CHAT_ECOSYSTEM.md`, `PLAN.md` (BR-42 family registration). `spec/SPEC_AGENTIC_MODEL.md` and `spec/SPEC_TEMPLATING.md` are cited by §14 for the agent-templating invariant.

---

## 1. Current catalog model (VERIFIED)

The "catalog" today is the **`@sentropic/skills` package** (`packages/skills`, name `@sentropic/skills` v0.1.1 — `packages/skills/package.json:2-3`), wired into the API through one thin app-local module.

### 1.1 Entry KINDS that exist today

There is exactly **one** first-class catalog entry kind today: the **Skill**.

- `Skill` (`packages/skills/src/types/skill.ts:52-72`): `{ metadata: SkillMetadata, tools: ReadonlyArray<SkillTool>, body: string, handlers?, sandboxEntry? }`. A skill is a bundle that carries **its own tools** plus a markdown `body` (system-prompt overlay) and optional `handlers` / `sandboxEntry`.
- `SkillTool` (`packages/skills/src/types/skill-tool.ts:28-52`): `{ name, description, inputSchema, outputSchema?, outputRenderHint?, sideEffect?, requiresApproval? }`. Tools are **not** independent registry entries — they are owned by a skill and surfaced through it. The execution handler is intentionally not on the tool; it lives in `Skill.handlers` keyed by tool name (`skill-tool.ts:23-27`).
- `SkillMetadata` (`packages/skills/src/types/metadata.ts:22-45`): the cheap projection returned by `list()`/`search()` — `{ name, description, version, category, contextFilter?, sandbox?, authzRequirements?, toolNames }`.

So the launch-packet framing "skills + tools + agents" is, against the live code, more precisely: **skills (which contain tools)**. "tools" is not a separate registry kind; "agents" do NOT exist as catalog entries at all today (see §2.1 — they live in a separate app-local system).

### 1.2 Data shape of a catalog entry

A registry entry is keyed by `metadata.name` (kebab-case, globally unique) in an in-memory `Map<string, Skill>` (`registry.ts:94-106`). The registry interface (`registry.ts:34-54`) exposes `register / unregister / list(filter?) / get(name) / search(query, options?)`. `list` returns `SkillMetadata[]`; `get` returns the full `Skill`; `search` is a token-frequency heuristic over name/description/category (`registry.ts:125-159`, weights name×3 desc×2 cat×1).

### 1.3 Registration

- Concrete registry: `InMemorySkillRegistry` (`registry.ts:94`). One instance per process, shared by DI; **register throws on duplicate name** and idempotent re-registration is NOT supported (`registry.ts:102-104`, `bundles/foundation/index.ts:85-94`).
- Built-in entries: the **foundation bundle** — a frozen array of 16 skills (`bundles/foundation/index.ts:57-74`: workspace, web, organizations, folders, initiatives, solutions, proposals, products, executive_summary, matrix, history_analyze, gate_review, documents, comment_assistant, plan, document_generate). Registered by `registerFoundationSkills(registry)` (`bundles/foundation/index.ts:85-94`).
- App wiring: `api/src/services/skills/catalog.ts:12-17` constructs a module-singleton `foundationSkillRegistry`, calls `registerFoundationSkills`, and wraps it in `SkillsToolRegistry`. **This is the only registry instance in the app.** There is no DB-backed registration, no dynamic/external registration path today.

### 1.4 How the catalog is exposed (consumers)

There is **no dedicated HTTP catalog endpoint**. The catalog is consumed entirely server-side, through the chat tool loop:

- **Adapter**: `SkillsToolRegistry` (`registry/adapter.ts:35-95`) bridges `SkillRegistry` → the `ToolRegistry` contract consumed by chat-core/flow. `resolveTools(authz, options?)` walks `list()→get()`, runs `resolveAuthorizedTools`, and **always prepends the `search_skills` meta-tool** (`adapter.ts:64`) unless scoped to a single skill. It holds no mutable state — a skill registered after construction is immediately visible (`adapter.ts:30-34`).
- **App façade**: `api/src/services/skills/catalog.ts` exposes `resolveFoundationChatTools(input)` (→ OpenAI `ChatCompletionTool[]`, lines 57-64) and `executeFoundationSearchSkills(...)` (lines 66-74). Authz is built from `{ userId, workspaceId, workspaceType?, currentUserRole?, allowedTools }` via `buildFoundationSkillsAuthz` (lines 27-42) — `permissionMode: 'allowlist'`.
- **Chat loop entry**: `api/src/services/chat-service.ts:2750` calls `resolveFoundationChatTools(...)` to assemble the per-turn tool set; `api/src/services/skills/foundation-executor.ts:152-529` dispatches tool calls by name (`search_skills` at :157, then the ~25 read/write foundation tools). Discovery is **search-first**: the LLM only ever sees `search_skills` + the authz-allowed tools; SKILL.md bodies are discovered on demand (`tools.ts:875-885`, `chat-service.ts:3050`).
- The `MarketplaceEngine` overlay (study §15) and any "marketplace" gating are **not implemented** — `adapter.ts:27-29` only references it as a planned wrap point.

**Summary**: one in-memory registry, one entry kind (Skill-with-tools), static code-defined registration of a 16-skill foundation bundle, consumed exclusively by the chat tool loop via a `search_skills`-first adapter. No HTTP surface, no DB persistence, no external sources, no marketplace gating.

---

## 2. Ambiguous terms, resolved against the code

### 2.1 `+AGENTS` — grounded interpretation (conductor-resolvable, with one user flag)

"Agents" already exist in the app, but **outside** the skills catalog, as a separate, DB-backed, workspace-scoped system:

- DB table `agent_definitions` (`api/src/db/schema.ts:840-866`): `{ id, workspaceId, key, name, description?, config jsonb, sourceLevel ('code'|'admin'|'user', :849), lineageRootId, parentId, isDetached, … }`, unique on `(workspaceId, key)`. Referenced by `workflow_definition_tasks.agentDefinitionId` (`schema.ts:908`, `:995`). Row type `AgentDefinitionRow` (`schema.ts:1228`).
- Seed data: `api/src/config/default-agents.ts` (`WORKSPACE_TYPE_AGENT_SEEDS`, lines 37-42; per-type catalogs in `default-agents-ai-ideas/-opportunity/-code/-shared`). Shape `DefaultGenerationAgentDefinition = { key, name, description, sourceLevel:'code', config }` (`default-agents-types.ts:5-11`).
- The **forward-compatible target already exists as ports**: `AgentRuntime { base: AgentDefinition; attachedSkills: Skill[]; resolve(authz, contextVars) }` (`packages/chat-core/src/ports.ts:132-160`) — base agent = `{ promptTemplate, defaultToolNames, modelPrefs? }`, resolved with a **skill overlay**. Study §14 (`SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md:379-408`) defines this as the agent-templating invariant: a base agent is "specializable" by attaching skills at runtime without forking the definition.

**Grounded reading**: `+AGENTS` = make the **agent definition** a first-class **catalog entry kind** alongside skills, so the catalog can `list/search/get` agents the same way it lists skills, and so external sources (§3) can contribute agents — NOT a new "sub-agent runner". The agent's *runtime* (selection, prompt resolution, execution) stays where it is (flow / chat-core `AgentRuntime`, study §14 invariant: "MUST be preserved during the BR-flow extraction"). In catalog terms, `+AGENTS` adds an `AgentTemplate`-kind entry whose shape mirrors `ports.ts AgentDefinition` + a skill-attachment list. This is **conductor-resolvable**.

User flag (small): the existing `agent_definitions` rows are **workspace-scoped and DB-backed**, whereas the skills catalog is process-static and global. Catalog `+agents` must decide whether catalog-agents are the *templates/seeds* (global, code-defined, like the foundation bundle) or also project the per-workspace DB rows. Preconisation: v1 catalogs **agent templates** (the code/source-level definitions), leaving per-workspace instances in the DB as today; surfacing DB rows through the catalog is deferred. Flag this to the user only if they intended catalog to expose live per-workspace agents.

### 2.2 `+CANEVAS` (canvas) — **USER-BLOCKING decision**

`canevas` is the French spelling; in the repo it consistently maps to English **"canvas"**. Repo evidence (verified):

- The originating intention, verbatim French, in `SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md:489` and the mapping row `:495`: *"Catalogue `skill+tools+agent` → + agents + canevas … `canevas` = LiveDocument/artifact templates (cf. §10.3)."* And `:496` ties comments to "messages / canvas / artifacts".
- **§10.3 Canvas bidirectional editing** (`SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md:200-211`): canvas = a `LiveDocument` abstraction beyond the message log — a tool returns `LiveDocumentRef { id, initialContent, mimeType }`; `chat-core` owns a `LiveDocumentStore` port (`create/apply(patch)/read/subscribe/close`); wire events `livedoc-opened/livedoc-patch/livedoc-closed`; CRDT (Y.js/Automerge); reference patterns Vercel AI Artifacts, Claude Artifacts, ChatGPT Canvas.
- This port already exists as a **stub** in code: `LiveDocumentStore { readonly _kind: 'LiveDocumentStore' }` (`packages/chat-core/src/ports.ts:66-72`).
- Canvas is an **explicitly carved-out sub-program** with its OWN spec, not owned here: `SPEC_EVOL_CHAT_ECOSYSTEM.md:52` *"(carved out) Canvas → own `SPEC_EVOL_CHAT_CANVAS` (livedoc/CRDT, editors, collab/audit/reversibility, 3D-CATIA/sheets)"*; reaffirmed `:55`, `:75`, `:108`. WP-CHAT keeps "only the port seams".
- No `canvas`/`canevas` component or feature exists in the live UI for this meaning. Grep hits in `ui/src/lib/components/InitiativeScatterPlot.svelte` and `e2e/tests/03-chat.spec.ts` are the **HTML `<canvas>` element / chart rendering** — a different, unrelated meaning. The prioritization-matrix is "matrix", not "canvas" (skill `matrix`, `foundation-executor.ts:175`).

**Grounded interpretation** (high confidence): `+CANEVAS` = **canvas/live-document artifact *templates*** as a catalog entry kind — i.e. the catalog can hold registrable "canvas templates" (a named LiveDocument starter: id/title/mimeType/initialContent/schema) that a skill or agent can instantiate via the §10.3 `LiveDocumentStore`. It is the *catalog registration of canvas templates*, NOT the canvas editor/CRDT runtime (that is `SPEC_EVOL_CHAT_CANVAS`, carved out).

**Why this is USER-BLOCKING**: the scope boundary is the decision, not the meaning. Candidates the user must choose between:
- **(C1) Catalog-only** (preconisation): add a `CanvasTemplate` catalog **entry kind** (metadata + `LiveDocumentRef` starter shape) so canvas templates are discoverable/installable like skills, and STOP there — the LiveDocumentStore/CRDT/editor stays deferred to `SPEC_EVOL_CHAT_CANVAS`. Lean, additive, respects the carve-out.
- **(C2) Pull canvas runtime into 42b** — implement `LiveDocumentStore` + wire events here. This **collides with the explicit carve-out** (`SPEC_EVOL_CHAT_ECOSYSTEM.md:52,75,108`) and would over-scope BR-42b. Not recommended.
- **(C3) Defer canvas entirely** — ship `+agents` + `CatalogSource` now, add `+canevas` when `SPEC_EVOL_CHAT_CANVAS` lands.

The user said "don't over-scope". (C1) registers the *kind* without the runtime; (C3) drops it for now. The conductor cannot pick between "register the kind now" vs "wait for the canvas spec" without the user, because it trades catalog completeness against premature coupling to a carved-out program.

---

## 3. `CatalogSource` abstraction (design sketch)

**Goal**: make the catalog fed by **pluggable sources** instead of only the static foundation bundle, so external providers (MCP servers; Google marketplace) contribute entries. This generalises `SkillSource` (study §15, `SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md:417-422`) from a skills-only enum into a source **interface** that yields catalog entries of any kind.

### 3.1 Where it plugs in

The composition point already exists and is documented as the intended wrap site: `SkillsToolRegistry` walks `registry.list()→get()` at resolve time and holds no cache (`adapter.ts:30-34, 46-50`). The clean seam is to make the registry a **composite over N sources** (the existing foundation bundle becomes the first, static `CatalogSource`), and to keep the `resolveTools`/`search_skills` adapter unchanged on top. This preserves the search-first discovery contract (§1.4) and the no-cache-invalidation property.

### 3.2 Proposed interface (illustrative — to be frozen during build, co-designed with the host consumer)

```ts
// Generalises SkillRegistry entries from Skill to a tagged CatalogEntry union.
type CatalogEntryKind = 'skill' | 'agent' | 'canvas';   // 'canvas' gated by §2.2

interface CatalogEntry {
  readonly kind: CatalogEntryKind;
  readonly metadata: CatalogEntryMetadata;   // superset of today's SkillMetadata (name/description/version/category/contextFilter?/authzRequirements?)
  readonly sourceId: string;                  // provenance: which CatalogSource produced it
}

interface CatalogSource {
  readonly id: string;                        // 'foundation' | 'mcp:<server>' | 'google-marketplace' | …
  readonly kind: 'static' | 'mcp' | 'marketplace';
  list(): Promise<ReadonlyArray<CatalogEntry>>;   // discovery
  get(name: string): Promise<CatalogEntry | null>;
  // optional lifecycle for remote sources:
  refresh?(): Promise<void>;
  health?(): Promise<{ ok: boolean; detail?: string }>;
}
```

- The **static foundation bundle** is wrapped as `StaticCatalogSource` (id `'foundation'`) over the existing `FOUNDATION_SKILLS` array — zero behaviour change, pure refactor (characterization-first, §5).
- A `CompositeCatalogRegistry` fans `list/get/search` across sources; name collisions resolve by source precedence (foundation wins, or explicit policy). This keeps `InMemorySkillRegistry`'s O(1) get / O(n) search semantics per source.

### 3.3 MCP source — reuse existing MCP knowledge, don't reinvent

Verified MCP reality in the repo: **there is no MCP client/server implementation in code today.** Grep for MCP in non-doc code yields only (a) a comment in `packages/skills/src/types/skill.ts:16` noting that "Adapters (chat-core, MCP) pass their own AuthzContext-equivalent here" — i.e. the skill type was *designed* to be MCP-frontable — and (b) a documentation-string mention in `api/src/config/default-chat-system.ts:32` (Claude Code sub-pages list). The study's §15 `SkillSource` enum includes `{ kind: 'mcp.so'; filter }` (`:420`) and the chat-ecosystem T4 row calls for a "unified CatalogSource (tools/MCP/canvas/agents/flow)" (`SPEC_EVOL_CHAT_ECOSYSTEM.md:47`).

So the **19-mcp intent is greenfield** (consistent with the launch packet: br19b has no implementation — confirmed it is not even present on `origin`). The MCP `CatalogSource` design:
- An `McpCatalogSource` connects to a configured MCP server (stdio or HTTP/SSE transport, via the official `@modelcontextprotocol/sdk` — to be added through `make install-api`), calls MCP `tools/list`, and **maps each MCP tool → a single-tool `skill`-kind `CatalogEntry`** (MCP `inputSchema` → `SkillTool.inputSchema`; MCP tool name → entry name, namespaced `mcp:<server>/<tool>` to avoid collisions). MCP tool `call` is wired as the entry's handler, so the existing `foundation-executor` dispatch and the `search_skills`-first contract keep working unchanged.
- Auth/config: per-source config (server URL/command, auth token/headers, allow/deny tool filter) carried out-of-band (env / workspace config), NOT in the entry. This is exactly where study §15 `MarketplacePolicy.allowedSources` (`:424-431`) would later gate which sources/tools are exposed — but the **marketplace gating layer stays deferred** (study §15 admin UI "out of scope for v1").
- This **absorbs and retires `feat/mcp-tool-catalog-br19b`** (the dormant stub): its scope ("MCP servers as a tool source") becomes the `McpCatalogSource` here; the stub branch is retired (it carries no code/PR/plan).

### 3.4 Google marketplace source

`GoogleMarketplaceCatalogSource` (`kind: 'marketplace'`) discovers Google/Vertex marketplace tools/extensions and maps them to `CatalogEntry`s the same way. Per §16.3 of the study and `SPEC_EVOL_BUILD_APP_CLI.md:382`, the "scale-relevant Google piece" is the MCP/marketplace catalog integration — but the *individual provider* work moved to BR-43. **Preconisation: marketplace source is DESIGNED here, IMPLEMENTED as deferred / v2** (MCP is the v1 external source); see decision D-SRC.

---

## 4. Batched decisions

### 4.1 USER-BLOCKING (cannot resolve without the user)

- **D-CANVAS (the canevas meaning/scope)** — §2.2. Choose **C1 (register `CanvasTemplate` entry kind only, runtime deferred to `SPEC_EVOL_CHAT_CANVAS`)** [preconisation], **C2 (pull canvas runtime into 42b — over-scopes, collides with carve-out)**, or **C3 (defer canvas entirely from 42b)**. This is the one genuine fork: it sets whether BR-42b ships 2 new kinds (agents+canvas) or 1 (agents), and whether it touches the carved-out canvas program.

### 4.2 Conductor-resolvable (preconisations; surface but proceed)

- **D-SRC (which CatalogSources in v1)** → MCP **implemented** v1; Google marketplace **designed, deferred** to v2. Rationale: MCP absorbs br19b and is greenfield-clean; marketplace depends on Google-provider work (BR-43) and §15 gating. (Reversible; revisit if user wants marketplace in v1.)
- **D-AGENTS-SCOPE** → catalog `+agents` = **agent *templates* (code/source-level)**, NOT per-workspace `agent_definitions` DB rows (§2.1). Preserves the §14 invariant; per-workspace projection deferred.
- **D-PKG (where the abstraction lives)** → `CatalogSource` + composite registry land **inside `@sentropic/skills`** (rename-in-place of its public surface, e.g. additive `CatalogEntry`/`CatalogSource` exports; the package effectively becomes `@sentropic/catalog` in role). NO new package in v1 (architecture rule: a package must be activated by real app consumption; the existing one already is). Marketplace *gating* (`@sentropic/marketplace`, §15) stays a separate future package.
- **D-MIGRATION (schema/migration)** → **none required in v1**. Catalog-agents are templates (code/in-memory); no new DB table. `agent_definitions` (`schema.ts:840`) is untouched. A migration is only needed if D-AGENTS-SCOPE later expands to DB-backed catalog agents or MCP-source persistence — out of v1.
- **D-NO-HTTP** → keep the catalog server-side via the chat tool loop (§1.4); do NOT add a public catalog HTTP endpoint in v1 unless build-app CLI needs it (then a follow-up). Avoids new surface/RBAC scope.
- **D-RETIRE-19B** → retire `feat/mcp-tool-catalog-br19b`; its scope is absorbed by §3.3. No-op cleanup (branch has no code/PR/plan; absent from origin).

---

## 5. Scope / paths + lots outline (LEAN)

**Characterization-first**: the foundation-bundle → `StaticCatalogSource` refactor touches live tool resolution (`adapter.ts`, `catalog.ts`, the chat loop). It MUST be covered by a characterization test that pins today's resolved tool set (the 16 foundation skills + `search_skills`, per authz) BEFORE refactoring — no behaviour change allowed in the composite refactor.

**Allowed paths (anticipated for the implementation branch, NOT this scoping branch):**
- `packages/skills/src/**` (new `CatalogSource`/`CatalogEntry`/composite registry; `McpCatalogSource`), `packages/skills/tests/**`.
- `api/src/services/skills/catalog.ts` (wire the composite + MCP source config).
- `api/package.json` (add `@modelcontextprotocol/sdk` via `make install-api`).

**Forbidden / out of scope**: canvas runtime (`SPEC_EVOL_CHAT_CANVAS`), marketplace gating engine (`@sentropic/marketplace` §15), per-workspace DB-agent projection, public HTTP catalog endpoint, any `Makefile`/`docker-compose*` change, BR-43 Google provider.

**Lots outline (mono-branch + cherry-pick; gate after Lot 1):**
- **Lot 0 — Characterization** (tests only): pin current resolved-tool behaviour of `SkillsToolRegistry` + `resolveFoundationChatTools`.
- **Lot 1 — CatalogSource seam (no behaviour change)**: introduce `CatalogEntry`/`CatalogSource`, wrap foundation bundle as `StaticCatalogSource`, composite registry; keep `search_skills`-first contract. Green char tests = gate.
- **Lot 2 — `+agents` entry kind**: add `agent`-kind `CatalogEntry` over the §14 `AgentRuntime`/`AgentDefinition` template shape (`ports.ts:132-160`); list/search/get parity tests. (D-AGENTS-SCOPE = templates.)
- **Lot 3 — MCP CatalogSource**: `McpCatalogSource` (tools/list → entries, namespaced; call → handler); per-source config; absorbs br19b. Integration test against a stub MCP server.
- **Lot 4 — `+canvas` entry kind** — **GATED on D-CANVAS**: if C1, add `canvas`-kind entry (template metadata + `LiveDocumentRef` starter) only; if C3, skip this lot.
- **Lot 5 — Google marketplace source** — **DEFERRED** (design only here; D-SRC). Not in v1 unless user elevates.

---

## 6. Open blockers / asks for conductor → user

1. **D-CANVAS** (§2.2 / §4.1) — the single user-blocking fork: register `CanvasTemplate` kind now (C1), pull canvas runtime in (C2, over-scope), or defer canvas entirely from 42b (C3). Default preconisation **C1**, pending the carved-out `SPEC_EVOL_CHAT_CANVAS`.
2. Confirm **D-SRC** (MCP v1, marketplace deferred) and **D-AGENTS-SCOPE** (templates not DB rows) — preconised, proceed unless the user objects.

No technical blocker prevents Lots 0-3 from being planned now. The 19-mcp stub retirement is confirmed clean (no code on origin).
